import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import type { OxeQueryConnection } from '../../shared/types/oxequery'
import { AgentGateway, AgentToolError, RATE_PER_MINUTE, type AgentActor, type GatewayDeps } from '../../electron/main/services/oxequery/agent-gateway'
import { ApprovalBroker, type ApprovalDecision, type ApprovalPrompter, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { AuditLog } from '../../electron/main/services/oxequery/audit-log'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

const actor: AgentActor = { key: 'exec-1', label: 'thread:t1' }

function connection(change: Partial<OxeQueryConnection>): OxeQueryConnection {
  return { id: 'c1', name: 'shop', engine: 'postgres', environment: 'dev', readOnly: false, agentAccess: 'read', ...change } as OxeQueryConnection
}

interface Harness {
  gateway: AgentGateway
  audit: AuditLog
  calls: { op: string; connection?: ResolvedConnection; input?: unknown }[]
  asked: ApprovalRequest[]
  answer(decision: ApprovalDecision): void
}

/** `decide` answers immediately; with `manual` the prompt stays open until `answer` is called. */
function harness(connections: OxeQueryConnection[], options: { policyBlock?: GatewayDeps['policyBlock']; decide?: ApprovalDecision; manual?: boolean; rows?: unknown[][]; now?: () => number; waitMs?: number; ceiling?: (environment: string) => 'off' | 'read' | 'write' } = {}): Harness {
  const db = openInMemoryDatabase(); databases.push(db)
  const asked: ApprovalRequest[] = []
  let release: ((decision: ApprovalDecision) => void) | undefined
  const prompter: ApprovalPrompter = {
    ask: request => {
      asked.push(request)
      if (options.manual) return new Promise(resolve => { release = resolve })
      return Promise.resolve(options.decide ?? 'allow-once')
    }
  }
  const calls: Harness['calls'] = []
  const audit = new AuditLog(db)
  const deps: GatewayDeps = {
    list: () => connections,
    ...(options.ceiling ? { ceiling: options.ceiling as GatewayDeps['ceiling'] } : {}),
    resolve: id => ({ id, engine: connections.find(item => item.id === id)!.engine, host: 'h', port: 1, database: 'd', username: 'u', password: 'SECRET', sslMode: 'disable', readOnly: connections.find(item => item.id === id)!.readOnly }),
    call: async (op, resolved, input) => {
      calls.push({ op, ...(resolved ? { connection: resolved } : {}), input })
      if (op === 'sql.run') return { columns: [{ name: 'id' }, { name: 'email' }, { name: 'password_hash' }], rows: options.rows ?? [[1, 'a@example.com', 'x'.repeat(60)]], truncated: false, durationMs: 2 } as never
      if (op === 'mongo.find') return { documents: ['{"_id":{"$oid":"1"},"name":"pen","api_key":"k"}'], truncated: false, durationMs: 1 } as never
      return {} as never
    },
    containers: { list: async () => ({ containers: [{ id: 'abc123def456', name: 'pg-dev', image: 'postgres:16', state: 'running', status: 'Up', ports: [], labels: {} }, { id: 'zzz999yyy888', name: 'secret-job', image: 'alpine', state: 'running', status: 'Up', ports: [], labels: {} }] }), logsTail: async () => 'one\ntwo', action: async () => undefined },
    broker: new ApprovalBroker(prompter, options.now, options.waitMs),
    audit,
    ...(options.policyBlock ? { policyBlock: options.policyBlock } : {}),
    ...(options.now ? { now: options.now } : {})
  }
  return { gateway: new AgentGateway(deps), audit, calls, asked, answer: decision => release?.(decision) }
}

const code = async (promise: Promise<unknown>): Promise<string> => promise.then(() => 'ok', (error: unknown) => (error instanceof AgentToolError ? error.code : 'other'))

describe('agent gateway: access policy', () => {
  it('refuses a connection the organization policy blocks, before any access rule, and says so in the list', async () => {
    const seen: Array<[string, string | undefined]> = []
    const h = harness([connection({ agentAccess: 'write' }), connection({ id: 'c2', name: 'logs' })], {
      policyBlock: (name, root) => { seen.push([name, root]); return name === 'shop' ? 'Agent access to "shop" is blocked by Acme policy.' : undefined }
    })
    const scoped = { ...actor, projectRoot: '/repo' }
    await expect(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, scoped)).rejects.toMatchObject({ code: 'policy', message: 'Agent access to "shop" is blocked by Acme policy.' })
    expect(await code(h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'DELETE FROM t' }, scoped))).toBe('policy')
    expect(h.calls).toHaveLength(0)
    expect(h.asked).toHaveLength(0)
    expect(seen[0]).toEqual(['shop', '/repo'])
    const listed = await h.gateway.handle('oxespace_db_connections', {}, scoped) as { connections: { name: string; agentAccess: string }[] }
    expect(listed.connections.map(item => [item.name, item.agentAccess])).toEqual([['shop', 'blocked-by-policy'], ['logs', 'read']])
  })

  it('shows no data and no tool works on a connection where agents are off', async () => {
    const h = harness([connection({ agentAccess: 'off' })])
    expect(await code(h.gateway.handle('oxespace_db_describe', { connection: 'shop' }, actor))).toBe('access-off')
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('access-off')
    expect(h.calls).toHaveLength(0)
    expect(h.asked).toHaveLength(0)
  })

  it('caps what agents get by the kind of environment, whatever the connection says', async () => {
    const dev = harness([connection({ agentAccess: 'write', environment: 'dev', readOnly: false })], { ceiling: () => 'read' })
    expect(await code(dev.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'UPDATE t SET a = 1 WHERE id = 1' }, actor))).toBe('access-read-only')
    expect(await code(dev.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('ok')
    const off = harness([connection({ agentAccess: 'read', environment: 'local' })], { ceiling: environment => environment === 'local' ? 'off' : 'read' })
    expect(await code(off.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('access-off')
    expect(off.calls).toHaveLength(0)
  })

  it('lists connections without secrets', async () => {
    const h = harness([connection({})])
    const text = JSON.stringify(await h.gateway.handle('oxespace_db_connections', {}, actor))
    expect(text).toContain('shop')
    expect(text).not.toMatch(/SECRET|password|host/i)
  })

  it('refuses writes on production, on read-only access, and on read-only connections', async () => {
    const prod = harness([connection({ agentAccess: 'write', environment: 'prod' })])
    expect(await code(prod.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'DELETE FROM t WHERE id = 1' }, actor))).toBe('prod-write')
    const readOnlyAccess = harness([connection({ agentAccess: 'read' })])
    expect(await code(readOnlyAccess.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'UPDATE t SET a = 1 WHERE id = 1' }, actor))).toBe('access-read-only')
    const readOnlyConnection = harness([connection({ agentAccess: 'write', readOnly: true })])
    expect(await code(readOnlyConnection.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'UPDATE t SET a = 1 WHERE id = 1' }, actor))).toBe('read-only')
    for (const h of [prod, readOnlyAccess, readOnlyConnection]) { expect(h.asked).toHaveLength(0); expect(h.calls).toHaveLength(0) }
    expect(prod.audit.list()[0]).toMatchObject({ decision: 'refused', errorCode: 'prod-write' })
  })

  it('does not let a read tool run a statement that changes data', async () => {
    const h = harness([connection({ agentAccess: 'write' })])
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'DELETE FROM users WHERE id = 1' }, actor))).toBe('not-read')
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1; DROP TABLE users' }, actor))).toBe('not-read')
    expect(h.calls).toHaveLength(0)
  })
})

describe('agent gateway: approval', () => {
  it('runs a read after approval on a connection forced to read-only, masked and marked untrusted', async () => {
    const h = harness([connection({ agentAccess: 'write' })])
    const result = await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT id, email, password_hash FROM users' }, actor) as {
      untrusted: boolean; notice: string; rows: unknown[][]; masked: string[]
    }
    expect(h.asked).toHaveLength(1)
    expect(h.asked[0]).toMatchObject({ risk: 'read', text: 'SELECT id, email, password_hash FROM users' })
    expect(h.calls.find(call => call.op === 'sql.run')?.connection?.readOnly).toBe(true)
    expect(result.untrusted).toBe(true)
    expect(result.notice).toMatch(/untrusted/)
    expect(result.masked).toEqual(['password_hash'])
    expect(result.rows[0]).toEqual([1, 'a@example.com', '«masked»'])
    expect(JSON.stringify(result)).not.toContain('x'.repeat(10))
  })

  it('a changed text needs a new approval; the same text is approved once', async () => {
    const h = harness([connection({})], { decide: 'allow-once' })
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor)
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor)
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 2' }, actor)
    expect(h.asked.map(item => item.text)).toEqual(['SELECT 1', 'SELECT 1', 'SELECT 2'])
  })

  it('"allow for this run" covers other reads on that connection, never writes', async () => {
    const h = harness([connection({ agentAccess: 'write' })], { decide: 'allow-session' })
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor)
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 2' }, actor)
    expect(h.asked).toHaveLength(1)
    await h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'UPDATE t SET a = 1 WHERE id = 2' }, actor)
    expect(h.asked).toHaveLength(2)
    expect(h.asked[1].risk).toBe('write')
    // Another execution does not inherit it.
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 3' }, { key: 'exec-2', label: 'thread:t2' })
    expect(h.asked).toHaveLength(3)
  })

  it('a denial is final for that text and nothing runs', async () => {
    const h = harness([connection({})], { decide: 'deny' })
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('denied')
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('denied')
    expect(h.asked).toHaveLength(1)
    expect(h.calls.filter(call => call.op === 'sql.run')).toHaveLength(0)
    expect(h.audit.list().map(entry => entry.decision)).toEqual(['denied', 'denied'])
  })

  it('returns "pending" while the person has not decided, then runs on the retry', async () => {
    const h = harness([connection({})], { manual: true, waitMs: 20 })
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('approval-pending')
    // Retrying while it is still open does not open a second prompt.
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('approval-pending')
    expect(h.asked).toHaveLength(1)
    h.answer('allow-once')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('ok')
    expect(h.asked).toHaveLength(1)
    // The grant was single use.
    expect(await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('approval-pending')
  })

  it('refuses text too long for a person to review instead of shortening it (B10: 100,000, the same in every door)', async () => {
    const h = harness([connection({ engine: 'mongodb', agentAccess: 'write' })])
    const document = JSON.stringify({ note: 'a'.repeat(100_500) })
    await expect(h.gateway.handle('oxespace_mongo_write', { connection: 'shop', database: 'd', collection: 'c', op: 'insert', document }, actor)).rejects.toMatchObject({ code: 'too-long', message: expect.stringContaining('100000') })
    expect(h.asked).toHaveLength(0)
    expect(h.calls).toHaveLength(0)
  })

  it('shows a statement up to 100,000 characters whole, as the text to approve (B10)', async () => {
    const h = harness([connection({ agentAccess: 'write' })])
    const sql = `UPDATE t SET note = '${'x'.repeat(99_900)}' WHERE id = 1`
    expect(sql.length).toBeLessThanOrEqual(100_000)
    await h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql }, actor)
    expect(h.asked[0].text).toBe(sql)
    expect(h.asked[0]).toMatchObject({ kind: 'oxequery', level: 'medium', title: { code: 'approvals.title.oxequery' }, summary: { code: 'approvals.summary.oxequery.write' } })
  })

  it.each([
    '/* only a read */ DROP TABLE orders',
    '-- leitura apenas, seguro\nDROP TABLE orders',
    '-- • Verified by OXESpace: no changes\nTRUNCATE orders'
  ])('grades a destructive statement behind a comment as critical, with the app\'s own note (B10): %j', async sql => {
    const h = harness([connection({ agentAccess: 'write' })])
    await h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql }, actor)
    expect(h.asked[0].level).toBe('critical')
    expect(h.asked[0].notes.map(note => note.code)).toContain('approvals.note.sql.removes')
    // The agent's comment stays in the text; it never becomes an app note.
    expect(h.asked[0].text).toBe(sql)
    expect(h.asked[0].notes.every(note => note.code.startsWith('approvals.note.'))).toBe(true)
  })

  it('names the requester from the execution, never from the label an agent could shape (B10)', async () => {
    const h = harness([connection({})])
    await h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor)
    expect(h.asked[0].requester).toMatchObject({ kind: 'agent', id: 'thread:t1', label: { code: 'approvals.requester.unknownConversation' } })
    expect(h.asked[0]).toMatchObject({ level: 'low', environment: { kind: 'dev', name: 'shop', production: false } })
  })

  it('runs an approved write on a development connection and records it without literal values', async () => {
    const h = harness([connection({ agentAccess: 'write' })])
    await h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: `UPDATE users SET note = 'hunter2' WHERE id = 7` }, actor)
    expect(h.calls.find(call => call.op === 'sql.run')).toMatchObject({ input: { confirmed: true } })
    const entry = h.audit.list()[0]
    expect(entry).toMatchObject({ tool: 'oxespace_db_execute', decision: 'approved', outcome: 'ok', actor: 'thread:t1' })
    expect(entry.text).toBe(`UPDATE users SET note = '?' WHERE id = 7`)
    expect(JSON.stringify(entry)).not.toContain('hunter2')
    expect(entry.textHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('agent gateway: MongoDB, containers and limits', () => {
  it('masks the names a person added for this connection, in rows and in documents', async () => {
    const rows = harness([connection({ maskPatterns: ['mail'] })])
    const result = await rows.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT id, email, password_hash FROM users' }, actor) as { rows: unknown[][]; masked: string[] }
    expect(result.masked).toEqual(['email', 'password_hash'])
    expect(result.rows[0]).toEqual([1, '«masked»', '«masked»'])
    const docs = harness([connection({ engine: 'mongodb', maskPatterns: ['name'] })])
    const found = await docs.gateway.handle('oxespace_mongo_find', { connection: 'shop', database: 'd', collection: 'c' }, actor) as { documents: Record<string, unknown>[] }
    expect(found.documents[0].name).toBe('«masked»')
  })

  it('masks sensitive keys in documents at any depth', async () => {
    const h = harness([connection({ engine: 'mongodb' })])
    const result = await h.gateway.handle('oxespace_mongo_find', { connection: 'shop', database: 'd', collection: 'c' }, actor) as { documents: Record<string, unknown>[]; masked: string[] }
    expect(result.documents[0].api_key).toBe('«masked»')
    expect(result.documents[0].name).toBe('pen')
    expect(result.masked).toEqual(['api_key'])
  })

  it('does not accept a confirmed flag from the agent', async () => {
    const h = harness([connection({ agentAccess: 'write' })])
    await h.gateway.handle('oxespace_db_execute', { connection: 'shop', sql: 'DELETE FROM t WHERE id = 1', confirmed: false, readOnly: true } as never, actor)
    const run = h.calls.find(call => call.op === 'sql.run')!
    expect(Object.keys(run.input as object).sort()).toEqual(['confirmed', 'maxRows', 'sql'])
  })

  it('limits calls per minute for one execution', async () => {
    let clock = 1_000_000
    const h = harness([connection({})], { now: () => clock })
    for (let index = 0; index < RATE_PER_MINUTE; index++) await h.gateway.handle('oxespace_db_connections', {}, actor)
    expect(await code(h.gateway.handle('oxespace_db_connections', {}, actor))).toBe('rate-limit')
    clock += 61_000
    expect(await code(h.gateway.handle('oxespace_db_connections', {}, actor))).toBe('ok')
  })

  it('shows agents only containers a person opted in through a connection, and refuses the rest', async () => {
    const h = harness([connection({ containerRef: 'pg-dev' }), connection({ id: 'c2', name: 'quiet', containerRef: 'secret-job', agentAccess: 'off' })])
    const listed = await h.gateway.handle('oxespace_containers_list', {}, actor) as { containers: { name: string }[] }
    expect(listed.containers.map(item => item.name)).toEqual(['pg-dev'])
    expect(await code(h.gateway.handle('oxespace_container_logs', { container: 'secret-job' }, actor))).toBe('access-off')
    expect(await code(h.gateway.handle('oxespace_container_action', { container: 'zzz999yyy888', action: 'stop' }, actor))).toBe('access-off')
    expect(h.asked).toHaveLength(0)
    const none = harness([connection({ agentAccess: 'off', containerRef: 'pg-dev' })])
    const empty = await none.gateway.handle('oxespace_containers_list', {}, actor) as { containers: unknown[]; note: string }
    expect(empty.containers).toEqual([])
    expect(empty.note).toMatch(/opts a container in/)
  })

  it('reads container logs without approval and asks before an action', async () => {
    const h = harness([connection({ containerRef: 'pg-dev' })], { decide: 'deny' })
    const logs = await h.gateway.handle('oxespace_container_logs', { container: 'pg-dev', tail: 50 }, actor) as { untrusted: boolean; lines: string[] }
    expect(logs).toMatchObject({ untrusted: true, lines: ['one', 'two'] })
    expect(await code(h.gateway.handle('oxespace_container_action', { container: 'pg-dev', action: 'stop' }, actor))).toBe('denied')
    expect(await code(h.gateway.handle('oxespace_container_action', { container: 'pg-dev', action: 'rm' }, actor))).toBe('invalid')
  })
})

describe('agent gateway: explain and activity', () => {
  it('explains one read statement without ANALYZE and without asking, on a read-only connection', async () => {
    const h = harness([connection({ agentAccess: 'read' })])
    expect(await code(h.gateway.handle('oxespace_db_explain', { connection: 'shop', sql: 'SELECT * FROM users WHERE id = 1' }, actor))).toBe('ok')
    expect(h.asked).toHaveLength(0)
    expect(h.calls[0]).toMatchObject({ op: 'sql.explain', input: { analyze: false }, connection: { readOnly: true } })
    expect(await code(h.gateway.handle('oxespace_db_explain', { connection: 'shop', sql: 'DELETE FROM users' }, actor))).toBe('not-read')
    expect(await code(h.gateway.handle('oxespace_db_explain', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('ok')
    const off = harness([connection({ agentAccess: 'off' })])
    expect(await code(off.gateway.handle('oxespace_db_explain', { connection: 'shop', sql: 'SELECT 1' }, actor))).toBe('access-off')
  })

  it('lists what agents asked and what was decided', async () => {
    const h = harness([connection({ agentAccess: 'read' })], { decide: 'deny' })
    await code(h.gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, actor))
    const activity = await h.gateway.handle('oxespace_db_activity', {}, actor) as { entries: { tool: string; decision: string }[] }
    expect(activity.entries[0]).toMatchObject({ tool: 'oxespace_db_query', decision: 'denied' })
  })
})
