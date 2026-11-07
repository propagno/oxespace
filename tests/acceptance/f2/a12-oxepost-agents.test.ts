// Frozen acceptance test for 1.5.0 A12 / T64 (OXE program, phase F2). Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-a12-oxepost-agents.md (product: docs/design/t64-oxepost-agent-access.md).
// No network, no vault, no user files: a temp request tree, fake secrets, broker, fetch and DNS.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/a12-oxepost-agents.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { RequestStore } from '../../../electron/main/services/oxepost/store'
import { OxePostAgentGateway } from '../../../electron/main/services/oxepost/agent-gateway'
import { setAgentAccess, setAgentCeiling } from '../../../electron/main/services/oxepost/agent-access'
import type { ApprovalRequest, ApprovalState } from '../../../electron/main/services/agent-actions/approval-broker'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { APPROVAL_KINDS, APPROVAL_KINDS_REMOTE_FORBIDDEN } from '../../../shared/types/approvals'
import type { PostRequest } from '../../../shared/oxepost/types'

const SECRET = 'sk-live-SECRET-9f8e7d'
const actor = { key: 'exec-1', label: 'thread:t1' }

let root: string
let db: AppDatabase
let paths: Record<string, string>
let asked: Array<Omit<ApprovalRequest, 'id' | 'hash' | 'expiresAt'> & { scope: string }>
let answer: ApprovalState
let fetched: Array<{ url: string; init: RequestInit }>
let reply: () => Response
let logs: string[]
let gateway: OxePostAgentGateway

const request = (o: Partial<PostRequest> & Pick<PostRequest, 'name' | 'method' | 'url'>): PostRequest => ({ headers: [], auth: { type: 'none' }, body: '', ...o })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'oxepost-a12-'))
  db = openInMemoryDatabase()
  const store = new RequestStore(root)
  await store.saveEnvironment({ name: 'Staging', production: false, variables: { host: 'https://api.example.com', page: '1' }, secrets: ['API_KEY'] })
  await store.saveEnvironment({ name: 'Production', production: true, variables: { host: 'https://api.example.com', page: '1' }, secrets: ['API_KEY'] })
  await store.saveEnvironment({ name: 'QA', production: false, variables: { host: 'https://api.example.com', page: '1' }, secrets: ['API_KEY'] })
  await store.saveEnvironment({ name: 'Rebind', production: false, variables: { host: 'https://rebind.example.com', page: '1' }, secrets: ['API_KEY'] })
  paths = {
    list: await store.save(undefined, request({ name: 'List invoices', method: 'GET', url: '{{host}}/invoices?page={{page}}', headers: [{ name: 'X-Trace', value: '{{API_KEY}}', enabled: true }] }), 'billing'),
    create: await store.save(undefined, request({ name: 'Create invoice', method: 'POST', url: '{{host}}/invoices', body: '{"amount":1}', headers: [{ name: 'X-Trace', value: '{{API_KEY}}', enabled: true }] }), 'billing'),
    health: await store.save(undefined, request({ name: 'Health', method: 'GET', url: 'http://localhost:3000/health' }), 'local')
  }
  asked = []; answer = { state: 'approved', via: 'once' }; fetched = []; logs = []
  reply = () => new Response(`{"echo":"${SECRET}"}`, { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'sid=abc123456', 'x-echo': SECRET } })
  gateway = new OxePostAgentGateway({
    db,
    rootOf: workspace => (workspace === 'w1' ? root : undefined),
    secrets: { values: async (_root: string, environment: string) => (environment === 'qa' ? {} : { API_KEY: SECRET }) },
    broker: { require: async (_key: string, scope: string, ask: Omit<ApprovalRequest, 'id' | 'hash' | 'expiresAt'>) => { asked.push({ ...ask, scope }); return answer } },
    fetchImpl: (async (url: string | URL, init?: RequestInit) => { fetched.push({ url: String(url), init: init ?? {} }); return reply() }) as typeof fetch,
    lookup: async (host: string) => (host === 'rebind.example.com' ? ['127.0.0.1'] : host === 'localhost' ? ['127.0.0.1'] : ['93.184.216.34']),
    log: (line: string) => { logs.push(line) },
    now: () => 1_000
  })
})
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }) })

const send = (args: Record<string, unknown>) => gateway.handle('oxespace_post', { action: 'send', workspace: 'w1', collection: 'billing', ...args }, actor)
const grant = (collection: string, access: 'off' | 'read' | 'write', environmentId: string | null = 'staging') => setAgentAccess(db, { workspaceId: 'w1', collection, access, environmentId })
/** The agent rows; a person's access changes are checked on their own. */
const audit = () => db.prepare("SELECT * FROM oxepost_audit WHERE actor <> 'person' ORDER BY id").all() as Array<Record<string, unknown>>
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

describe('A12 · storage (migration)', () => {
  test('three tables; the audit is append-only; production can never be given write', () => {
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
    expect(columns('oxepost_agent_access')).toEqual(expect.arrayContaining(['workspace_id', 'collection', 'access', 'environment_id', 'updated_at']))
    expect(columns('oxepost_audit')).toEqual(expect.arrayContaining(['id', 'ts', 'actor', 'workspace_id', 'collection', 'request_name', 'environment', 'method', 'url_path', 'status', 'text_hash', 'decision', 'outcome', 'duration_ms', 'error_code', 'response_excerpt']))
    expect(db.prepare('SELECT kind, access FROM oxepost_agent_ceiling ORDER BY kind').all()).toEqual([{ kind: 'ordinary', access: 'write' }, { kind: 'production', access: 'read' }])
    expect(() => db.prepare("UPDATE oxepost_agent_ceiling SET access = 'write' WHERE kind = 'production'").run()).toThrow()
    expect(() => setAgentCeiling(db, 'production', 'write')).toThrow()
    expect(() => db.prepare("INSERT INTO oxepost_agent_access (workspace_id, collection, access, updated_at) VALUES ('w1', 'x', 'admin', 1)").run()).toThrow()
    db.prepare("INSERT INTO oxepost_audit (ts, actor, decision, outcome) VALUES (1, 'agent', 'auto', 'ok')").run()
    expect(() => db.prepare("UPDATE oxepost_audit SET outcome = 'error'").run()).toThrow(/append-only/)
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_oxepost_audit_ts'").get() as { name: string } | undefined)?.name).toBe('idx_oxepost_audit_ts')
  })
})

describe('A12 · agents send OxePost requests', () => {
  test('off by default: nothing is listed and a send is refused without asking or fetching', async () => {
    expect(await gateway.handle('oxespace_post', { action: 'requests', workspace: 'w1' }, actor)).toMatchObject({ collections: [] })
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'access-off' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(audit()).toEqual([expect.objectContaining({ actor: 'thread:t1', collection: 'billing', decision: 'refused', outcome: 'skipped', error_code: 'access-off' })])
  })

  test('requests lists names of variables and secrets, never a value', async () => {
    grant('billing', 'read')
    const result = await gateway.handle('oxespace_post', { action: 'requests', workspace: 'w1' }, actor) as { collections: Array<Record<string, unknown>> }
    expect(result.collections).toEqual([expect.objectContaining({ collection: 'billing', access: 'read', environment: { name: 'Staging', production: false }, variables: expect.arrayContaining(['host', 'page']), secrets: ['API_KEY'] })])
    expect((result.collections[0].requests as Array<Record<string, unknown>>).map(item => [item.name, item.method, item.url])).toEqual(expect.arrayContaining([['List invoices', 'GET', '{{host}}/invoices?page={{page}}'], ['Create invoice', 'POST', '{{host}}/invoices']]))
    const json = JSON.stringify(result)
    expect(json).not.toContain(SECRET); expect(json).not.toContain('https://api.example.com'); expect(json).not.toContain('"1"')
  })

  test('read access, GET: asks with the secret masked; the fetch gets the value; the result and the audit never show it', async () => {
    grant('billing', 'read')
    const result = await send({ path: paths.list }) as { status: number; headers: Array<{ name: string; value: string }>; body: string; url: string }
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ kind: 'oxepost', risk: 'read', actor: 'thread:t1', tool: 'oxespace_post', scope: 'oxepost:w1:billing' })
    expect(asked[0].text).toContain('GET https://api.example.com/invoices?page=1')
    expect(asked[0].text).toContain('[secret:API_KEY]')
    expect(asked[0].text).not.toContain(SECRET)
    expect(fetched).toHaveLength(1)
    expect(header(fetched[0].init, 'x-trace')).toBe(SECRET)
    expect(result.status).toBe(200)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(result.body).toContain('[secret:API_KEY]')
    expect(result.headers.find(item => item.name === 'set-cookie')?.value).toBe('[redacted]')
    const [row] = audit()
    expect(row).toMatchObject({ decision: 'approved', outcome: 'ok', status: 200, method: 'GET', request_name: 'List invoices', environment: 'Staging', response_excerpt: null })
    expect(String(row.url_path)).toMatch(/^\/invoices/)
    expect(String(row.text_hash)).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(audit())).not.toContain(SECRET)
  })

  test('read access refuses a POST without asking or fetching', async () => {
    grant('billing', 'read')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'access-read-only' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
  })

  test('write access: a POST asks as a write; denied and pending send nothing', async () => {
    grant('billing', 'write')
    answer = { state: 'denied' }
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'denied' })
    expect(asked[0]).toMatchObject({ kind: 'oxepost', risk: 'write' })
    expect(fetched).toEqual([])
    expect(audit().at(-1)).toMatchObject({ decision: 'denied', outcome: 'skipped' })
    answer = { state: 'pending', requestId: 'r1' }
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'approval-pending' })
    expect(fetched).toEqual([])
    answer = { state: 'approved', via: 'once' }
    await send({ path: paths.create })
    expect(fetched).toHaveLength(1)
    expect(fetched[0].init.method).toBe('POST')
  })

  test('production: a write is refused by policy without asking; a read asks with the production flag', async () => {
    grant('billing', 'write', 'production')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'prod-write' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    await send({ path: paths.list })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ risk: 'read', environment: expect.objectContaining({ production: true, name: 'Production' }) })
  })

  test('a new request reaches only the origins the collection already uses', async () => {
    grant('billing', 'read')
    await expect(send({ method: 'GET', url: 'https://evil.example.net/steal' })).rejects.toMatchObject({ code: 'origin' })
    await expect(send({ method: 'GET', url: 'http://api.example.com/invoices' })).rejects.toMatchObject({ code: 'origin' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(audit().map(row => [row.decision, row.error_code])).toEqual([['refused', 'origin'], ['refused', 'origin']])
    await send({ method: 'GET', url: 'https://api.example.com/customers' })
    expect(asked).toHaveLength(1); expect(fetched).toHaveLength(1)
  })

  test('a public origin that resolves to a private address is refused; a saved localhost origin is sent', async () => {
    grant('billing', 'read', 'rebind')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'private-address' })
    expect(fetched).toEqual([])
    grant('local', 'read', 'staging')
    await gateway.handle('oxespace_post', { action: 'send', workspace: 'w1', collection: 'local', path: paths.health }, actor)
    expect(fetched.map(item => item.url)).toEqual(['http://localhost:3000/health'])
  })

  test('a redirect to another origin is not followed', async () => {
    grant('billing', 'read')
    reply = () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/x' } })
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'redirect' })
    expect(fetched).toHaveLength(1)
    expect(fetched[0].init.redirect).toBe('manual')
  })

  test('a secret that is not set fails before sending, naming the secret and the environment', async () => {
    grant('billing', 'read', 'qa')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'secret-missing', message: expect.stringMatching(/\{\{API_KEY\}\}[\s\S]*QA/) })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
  })

  test('arguments cannot set a secret, carry auth, or reach an action that does not exist', async () => {
    grant('billing', 'write')
    await expect(send({ path: paths.list, variables: { API_KEY: 'mine' } })).rejects.toMatchObject({ code: 'invalid' })
    await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'Authorization', value: 'Bearer abc' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'Cookie', value: 'a=b' }] })).rejects.toMatchObject({ code: 'invalid' })
    for (const action of ['access', 'setAccess', 'environments', 'secrets']) {
      await expect(gateway.handle('oxespace_post', { action, workspace: 'w1', collection: 'billing', access: 'write' }, actor)).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(db.prepare("SELECT access FROM oxepost_agent_access WHERE collection = 'billing'").get()).toEqual({ access: 'write' })
  })

  test('a failed response keeps a masked excerpt of at most 4 KB in the audit', async () => {
    grant('billing', 'read')
    reply = () => new Response(`boom ${SECRET} ${'x'.repeat(10_000)}`, { status: 500, headers: { 'content-type': 'text/plain' } })
    const result = await send({ path: paths.list }) as { status: number }
    expect(result.status).toBe(500)
    const row = audit().at(-1)!
    expect(row).toMatchObject({ outcome: 'error', status: 500 })
    const excerpt = String(row.response_excerpt)
    expect(excerpt).toContain('[secret:API_KEY]')
    expect(excerpt).not.toContain(SECRET)
    expect(Buffer.byteLength(excerpt)).toBeLessThanOrEqual(4096)
  })

  test('no log line carries a secret value', async () => {
    grant('billing', 'write')
    await send({ path: paths.list })
    reply = () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: `reset while sending ${SECRET}` } }) }
    await expect(send({ path: paths.create })).rejects.toBeTruthy()
    expect(logs.join('\n')).not.toContain(SECRET)
    expect(JSON.stringify(audit())).not.toContain(SECRET)
  })

  test('an access change is a person\'s audited action', () => {
    grant('billing', 'read')
    grant('billing', 'write')
    const rows = audit().filter(row => row.actor === 'person')
    expect(rows.map(row => [row.collection, row.url_path, row.decision, row.outcome])).toEqual([['billing', 'Access: off → read', 'auto', 'ok'], ['billing', 'Access: read → write', 'auto', 'ok']])
  })
})

describe('A12 · surface', () => {
  test('the tool and its levels, the forbidden access capability, and the approval kind the phone never answers', () => {
    const tools = Object.values(MCP_COVERAGE).flatMap(capability => ('tools' in capability ? Object.entries(capability.tools) : []))
    expect(tools).toEqual(expect.arrayContaining([['oxespace_post#requests', 'read'], ['oxespace_post#send', 'confirm']]))
    expect(tools.filter(([name]) => name.startsWith('oxespace_post')).map(([name]) => name).sort()).toEqual(['oxespace_post#requests', 'oxespace_post#send'])
    expect(FORBIDDEN_CAPABILITIES).toContain('oxepost.agent_access')
    expect(MCP_COVERAGE['oxepost.agent_access']).toHaveProperty('forbidden')
    expect(Object.values(MCP_COVERAGE).some(capability => 'planned' in capability && capability.planned === 'H8')).toBe(false)
    expect(APPROVAL_KINDS).toContain('oxepost')
    expect((APPROVAL_KINDS_REMOTE_FORBIDDEN as Record<string, string>).oxepost).toBe('oxepost.approve')
  })
})
