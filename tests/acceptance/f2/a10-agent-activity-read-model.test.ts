// Frozen acceptance test for 1.5.0 A10 (OXE program, phase F2). Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-a10-agent-activity-read-model.md. Needs A12 PR 1 (oxepost_audit).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/a10-agent-activity-read-model.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { AgentActivity, parseAgentActivityQuery } from '../../../electron/main/services/agent-activity/read-model'
import { AGENT_ACTIVITY_SOURCES, type AgentActivityQuery, type AgentActivityRow } from '../../../shared/types/agent-activity'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function open(): AppDatabase {
  const db = openInMemoryDatabase(); databases.push(db); return db
}

function change(db: AppDatabase, ts: number, o: Partial<{ actor: string; tool: string; action: string; level: string; text: string; decision: string; outcome: string; workspace: string }> = {}): void {
  db.prepare('INSERT INTO agent_action_audit (ts, actor, workspace_id, tool, action, level, text, decision, outcome, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5)')
    .run(ts, o.actor ?? 'thread:t1', o.workspace ?? 'w1', o.tool ?? 'oxespace_git_change', o.action ?? 'commit', o.level ?? 'write', o.text ?? 'commit -m fix', o.decision ?? 'approved', o.outcome ?? 'ok')
}
function query(db: AppDatabase, ts: number, o: Partial<{ actor: string; tool: string; text: string; decision: string; outcome: string; error: string | null }> = {}): void {
  db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_name, engine, environment, tool, text, decision, outcome, error_code) VALUES (?, ?, 'shop', 'postgres', 'dev', ?, ?, ?, ?, ?)")
    .run(ts, o.actor ?? 'pane:p1', o.tool ?? 'oxespace_db_query', o.text ?? 'SELECT 1', o.decision ?? 'auto', o.outcome ?? 'ok', o.error ?? null)
}
function post(db: AppDatabase, ts: number, o: Partial<{ actor: string; method: string; path: string; decision: string; outcome: string }> = {}): void {
  db.prepare("INSERT INTO oxepost_audit (ts, actor, workspace_id, collection, request_name, environment, method, url_path, status, decision, outcome, duration_ms) VALUES (?, ?, 'w1', 'billing', 'Create invoice', 'staging', ?, ?, 200, ?, ?, 12)")
    .run(ts, o.actor ?? 'agent', o.method ?? 'GET', o.path ?? '/invoices', o.decision ?? 'auto', o.outcome ?? 'ok')
}

/** Every page with the given query, following nextCursor to the end. */
function walk(model: AgentActivity, q: AgentActivityQuery): AgentActivityRow[] {
  const rows: AgentActivityRow[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const page = model.list({ ...q, cursor })
    rows.push(...page.rows)
    if (page.nextCursor === null) return rows
    cursor = page.nextCursor
  }
  throw new Error('paging never ended')
}

const order = (rows: AgentActivityRow[]): Array<[number, string]> => rows.map(row => [row.at, row.source])

describe('A10 · one Agent activity read model', () => {
  test('the four sources, in this order', () => {
    expect(AGENT_ACTIVITY_SOURCES).toEqual(['changes', 'databases', 'containers', 'post'])
  })

  test('merges the audits into one newest-first list, with source, actor, target, write and summary', () => {
    const db = open()
    change(db, 40)
    query(db, 30)
    query(db, 20, { tool: 'oxespace_container_action', text: 'restart web', actor: 'thread:t2' })
    post(db, 10, { method: 'POST', path: '/invoices' })
    const { rows, nextCursor } = new AgentActivity(db).list({})
    expect(nextCursor).toBeNull()
    expect(order(rows)).toEqual([[40, 'changes'], [30, 'databases'], [20, 'containers'], [10, 'post']])
    expect(rows[0]).toMatchObject({ actor: { kind: 'thread', id: 't1', label: 'thread:t1' }, tool: 'oxespace_git_change', write: true, decision: 'approved', outcome: 'ok', durationMs: 5 })
    expect(rows[0].summary).toBe('commit · commit -m fix')
    expect(rows[1]).toMatchObject({ actor: { kind: 'pane', id: 'p1' }, summary: 'SELECT 1', target: 'shop', write: false, errorCode: null })
    expect(rows[2]).toMatchObject({ actor: { kind: 'thread', id: 't2' }, summary: 'restart web', write: true })
    expect(rows[3]).toMatchObject({ actor: { kind: 'agent', id: null, label: 'agent' }, summary: 'POST /invoices', target: 'billing · staging', write: true })
    expect(new Set(rows.map(row => row.id)).size).toBe(4)
    db.prepare("INSERT INTO oxepost_audit (ts, actor, workspace_id, collection, access_from, access_to, decision, outcome) VALUES (5, 'person', 'w1', 'billing', 'off', 'read', 'auto', 'ok')").run()
    const person = new AgentActivity(db).list({ sources: ['post'] }).rows[1]
    expect(person.actor).toEqual({ kind: 'person', id: null, label: 'person', name: null })
    expect(person).toMatchObject({ summary: '', accessChange: { from: 'off', to: 'read' }, target: 'billing', write: false })
    expect(rows[3]).not.toHaveProperty('accessChange')
    for (const row of rows) expect(row.id.startsWith(`${row.source}:`)).toBe(true)
  })

  test('rows with the same time come out in source order, then newest id first', () => {
    const db = open()
    post(db, 50); query(db, 50); change(db, 50, { text: 'first' }); change(db, 50, { text: 'second' })
    const rows = new AgentActivity(db).list({}).rows
    expect(rows.map(row => row.source)).toEqual(['changes', 'changes', 'databases', 'post'])
    expect(rows[0].summary).toContain('second')
  })

  test('paging with limit 3 returns every row exactly once, in order, also across equal times', () => {
    const db = open()
    for (let i = 0; i < 4; i++) { change(db, 100 - i * 10); query(db, 100 - i * 10); post(db, 95 - i * 10) }
    change(db, 60); change(db, 60)
    const model = new AgentActivity(db)
    const all = model.list({ limit: 200 }).rows
    expect(all).toHaveLength(14)
    const paged = walk(model, { limit: 3 })
    expect(paged.map(row => row.id)).toEqual(all.map(row => row.id))
    expect(model.list({ limit: 3 }).rows).toHaveLength(3)
  })

  test('rows written while paging never appear in later pages and never shift them', () => {
    const db = open()
    for (let i = 0; i < 6; i++) change(db, 100 - i)
    const model = new AgentActivity(db)
    const first = model.list({ limit: 2 })
    change(db, 200); query(db, 200); change(db, 100)
    const rest = walk(model, { limit: 2, cursor: first.nextCursor ?? undefined })
    expect([...first.rows, ...rest].map(row => row.at)).toEqual([100, 99, 98, 97, 96, 95])
  })

  test('filters: sources, writes, problems, actor, since and until', () => {
    const db = open()
    change(db, 90, { level: 'read', tool: 'oxespace_git', action: 'status' })
    change(db, 80, { level: 'confirm', decision: 'denied', outcome: 'skipped', actor: 'pane:p9' })
    query(db, 70, { tool: 'oxespace_db_execute', text: 'UPDATE t SET a = 1', outcome: 'error', error: 'timeout', actor: 'thread:t1' })
    query(db, 60, { tool: 'oxespace_mongo_write', text: 'insertOne' })
    query(db, 50, { tool: 'oxespace_container_logs', text: 'logs web' })
    post(db, 40, { method: 'DELETE', path: '/invoices/7', decision: 'refused', outcome: 'skipped' })
    post(db, 30, { method: 'HEAD' })
    const model = new AgentActivity(db)
    const ats = (q: AgentActivityQuery) => walk(model, q).map(row => row.at)
    expect(ats({ sources: ['databases'] })).toEqual([70, 60])
    expect(ats({ sources: ['containers', 'post'] })).toEqual([50, 40, 30])
    expect(ats({ view: 'writes' })).toEqual([80, 70, 60, 40])
    expect(ats({ view: 'problems' })).toEqual([80, 70, 40])
    expect(ats({ actor: { kind: 'thread', id: 't1' } })).toEqual([90, 70])
    expect(ats({ actor: { kind: 'pane', id: 'p9' } })).toEqual([80])
    expect(ats({ since: 50, until: 80 })).toEqual([70, 60, 50])
    expect(ats({ sources: ['post'], view: 'writes' })).toEqual([40])
  })

  test('refuses an empty or unknown source, an unknown view, a bad actor and a bad cursor', () => {
    const db = open(); change(db, 1)
    const model = new AgentActivity(db)
    expect(() => parseAgentActivityQuery({ sources: [] })).toThrow()
    expect(() => parseAgentActivityQuery({ sources: ['secrets'] })).toThrow()
    expect(() => parseAgentActivityQuery({ view: 'everything' })).toThrow()
    expect(() => parseAgentActivityQuery({ actor: { kind: 'agent', id: 'x' } })).toThrow()
    expect(() => parseAgentActivityQuery({ actor: { kind: 'thread', id: 'x'.repeat(201) } })).toThrow()
    expect(() => parseAgentActivityQuery({ since: Number.NaN })).toThrow()
    expect(() => parseAgentActivityQuery({ cursor: 'c'.repeat(201) })).toThrow()
    expect(() => model.list({ cursor: 'not-a-cursor' })).toThrow()
    expect(() => model.list({ cursor: Buffer.from('v2:1:0:1').toString('base64url') })).toThrow()
    expect(parseAgentActivityQuery({})).toEqual({})
    expect(parseAgentActivityQuery({ sources: ['post'], view: 'problems', limit: 10 })).toMatchObject({ sources: ['post'], view: 'problems', limit: 10 })
  })

  test('the page size clamps to 1..200 with a default of 50, and the summary is cut to 200 characters', () => {
    const db = open()
    for (let i = 0; i < 205; i++) change(db, i)
    change(db, 1000, { text: 'x'.repeat(500) })
    const model = new AgentActivity(db)
    expect(model.list({}).rows).toHaveLength(50)
    expect(model.list({ limit: 1000 }).rows).toHaveLength(200)
    expect(model.list({ limit: 0 }).rows).toHaveLength(1)
    expect(model.list({ limit: 1 }).rows[0].summary.length).toBeLessThanOrEqual(200)
  })

  test('detail returns the full audit row by id, and null for an unknown id', () => {
    const db = open()
    query(db, 10, { text: 'SELECT 2' }); post(db, 20, { method: 'POST' })
    const model = new AgentActivity(db)
    const [postRow, queryRow] = model.list({}).rows
    expect(model.detail(queryRow.id)).toMatchObject({ source: 'databases', connectionName: 'shop', engine: 'postgres', environment: 'dev', text: 'SELECT 2' })
    expect(model.detail(postRow.id)).toMatchObject({ source: 'post', collection: 'billing', requestName: 'Create invoice', environment: 'staging', method: 'POST', status: 200 })
    expect(model.detail('databases:999999')).toBeNull()
    expect(model.detail('nope')).toBeNull()
  })

  test('every page reads each source through its ts index, never a full scan or a whole-table sort', () => {
    const db = open()
    for (let i = 0; i < 10; i++) { change(db, i); query(db, i); query(db, i, { tool: 'oxespace_container_action' }); post(db, i) }
    db.exec('ANALYZE')
    const model = new AgentActivity(db)
    const cursor = model.list({ limit: 3 }).nextCursor ?? undefined
    expect(cursor).toBeDefined()
    for (const q of [{ limit: 3 }, { limit: 3, cursor }, { limit: 3, cursor, view: 'problems' as const, actor: { kind: 'thread' as const, id: 't1' } }]) {
      const { sql, params } = model.listStatement(q)
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(row => row.detail)
      for (const table of ['agent_action_audit', 'oxequery_audit', 'oxepost_audit']) {
        expect(plan.some(line => new RegExp(`^(SCAN|SEARCH) ${table}( AS \\w+)? USING (COVERING )?INDEX idx_${table}_ts\\b`).test(line)), `${table} via its ts index:\n${plan.join('\n')}`).toBe(true)
      }
      expect(plan.filter(line => /^SCAN \w+( AS \w+)?$/.test(line) && !/^SCAN (\(|subquery|unionop)/i.test(line)), plan.join('\n')).toEqual([])
    }
  })

  test('actor names are resolved at read time: thread title, pane display name, null when gone or unnamed', () => {
    const db = open()
    db.pragma('foreign_keys = OFF')
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('w1', 'W', '/w', '{}', 'sp')").run()
    db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES ('t1', 'w1', 'tp', ?), ('t3', 'w1', 'tp', ?)").run(JSON.stringify({ id: 't1', title: 'Fix the login' }), JSON.stringify({ id: 't3', title: 'New thread' }))
    db.prepare("INSERT INTO panes (id, workspace_id, row_index, column_index) VALUES ('p1', 'w1', 0, 0)").run()
    db.prepare("UPDATE panes SET display_name = 'API server' WHERE id = 'p1'").run()
    change(db, 40, { actor: 'thread:t1' }); change(db, 30, { actor: 'pane:p1' }); change(db, 20, { actor: 'thread:gone' }); change(db, 10, { actor: 'thread:t3' })
    const names = new AgentActivity(db).list({}).rows.map(row => [row.actor.label, row.actor.name])
    expect(names).toEqual([['thread:t1', 'Fix the login'], ['pane:p1', 'API server'], ['thread:gone', null], ['thread:t3', null]])
  })

  test('a post row never shows the query string in its summary or target', () => {
    const db = open()
    post(db, 10, { path: '/invoices?token=abcd1234efgh&page=2' })
    const [row] = new AgentActivity(db).list({}).rows
    expect(row.summary).toBe('GET /invoices')
    expect(`${row.summary} ${row.target}`).not.toMatch(/\?|token|abcd1234efgh/)
  })

  test('the preload exposes agentActivity.list and .detail on those channels', () => {
    const preload = readFileSync(join(__dirname, '../../../electron/preload/api.ts'), 'utf8')
    const block = /agentActivity:\s*\{([\s\S]*?)\n\s*\}/.exec(preload)?.[1] ?? ''
    expect(block, 'agentActivity group in electron/preload/api.ts').toMatch(/\blist:[\s\S]*IPC_CHANNELS\.agentActivity\.list\b/)
    expect(block).toMatch(/\bdetail:[\s\S]*IPC_CHANNELS\.agentActivity\.detail\b/)
  })

  test('the IPC channels exist and are excluded from MCP', () => {
    expect(IPC_CHANNELS.agentActivity.list).toBe('agent-activity:list')
    expect(IPC_CHANNELS.agentActivity.detail).toBe('agent-activity:detail')
    for (const channel of ['agentActivity.list', 'agentActivity.detail']) {
      const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(channel) || capability.ipc?.includes('agentActivity.*'))
      expect(claims, channel).toHaveLength(1)
      expect(claims[0]).toHaveProperty('excluded')
    }
  })
})
