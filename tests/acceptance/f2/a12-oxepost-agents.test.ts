// Frozen acceptance test for 1.5.0 A12 / T64 (OXE program, phase F2). Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-a12-oxepost-agents.md (product: docs/design/t64-oxepost-agent-access.md).
// No network, no vault, no user files: a temp request tree, fake secrets, broker, fetch and DNS.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/a12-oxepost-agents.test.ts
import { mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { RequestStore } from '../../../electron/main/services/oxepost/store'
import { OxePostAgentGateway } from '../../../electron/main/services/oxepost/agent-gateway'
import { OXEPOST_AGENT_REFUSALS, confirmAgentAccess, setAgentAccess, setAgentCeiling } from '../../../electron/main/services/oxepost/agent-access'
import { isBlockedAddress } from '../../../electron/main/services/oxepost/address-policy'
import { OxePostService } from '../../../electron/main/services/oxepost/service'
import type { ApprovalRequest, ApprovalState } from '../../../electron/main/services/agent-actions/approval-broker'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { APPROVAL_KINDS, APPROVAL_KINDS_REMOTE_FORBIDDEN } from '../../../shared/types/approvals'
import type { PostRequest } from '../../../shared/oxepost/types'

const SECRET = 'sk-live-SECRET-9f8e7d'
const actor = { key: 'exec-1', label: 'thread:t1' }

let root: string
let db: AppDatabase
let paths: Record<string, string>
let store: RequestStore
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
  store = new RequestStore(root)
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
  gateway = new OxePostAgentGateway(gatewayDeps())
})

/** The fakes every gateway in this file uses; a test overrides one by spreading. */
function gatewayDeps() {
  return {
    db,
    rootOf: (workspace: string) => (workspace === 'w1' ? root : undefined),
    secrets: { values: async (_root: string, environment: string): Promise<Record<string, string>> => (environment === 'qa' ? {} : { API_KEY: SECRET }) },
    broker: { require: async (_key: string, scope: string, ask: Omit<ApprovalRequest, 'id' | 'hash' | 'expiresAt'>) => { asked.push({ ...ask, scope }); return answer } },
    fetchImpl: (async (url: string | URL, init?: RequestInit) => { fetched.push({ url: String(url), init: init ?? {} }); return reply() }) as typeof fetch,
    lookup: async (host: string) => (host === 'rebind.example.com' ? ['127.0.0.1'] : host === 'localhost' ? ['127.0.0.1'] : ['93.184.216.34']),
    log: (line: string) => { logs.push(line) },
    now: () => 1_000
  }
}
afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }) })

const send = (args: Record<string, unknown>) => gateway.handle('oxespace_post', { action: 'send', workspace: 'w1', collection: 'billing', ...args }, actor)
const grant = (collection: string, access: 'off' | 'read' | 'write', environmentId: string | null = 'staging') => setAgentAccess(db, { workspaceId: 'w1', root, collection, access, environmentId })
const folder = (name: string) => join(root, '.oxespace', 'requests', name)
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
/** The agent rows; a person's access changes are checked on their own. */
const audit = () => db.prepare("SELECT * FROM oxepost_audit WHERE actor <> 'person' ORDER BY id").all() as Array<Record<string, unknown>>
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name)

describe('A12 · storage (migration)', () => {
  test('three tables; the audit is append-only; production can never be given write', () => {
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
    expect(columns('oxepost_agent_access')).toEqual(expect.arrayContaining(['workspace_id', 'collection', 'access', 'environment_id', 'folder_identity', 'origins_json', 'fingerprint', 'confirmed_at', 'updated_at']))
    expect(columns('oxepost_audit')).toEqual(expect.arrayContaining(['id', 'ts', 'actor', 'workspace_id', 'collection', 'request_name', 'environment', 'method', 'url_path', 'status', 'text_hash', 'decision', 'outcome', 'duration_ms', 'error_code', 'response_excerpt', 'access_from', 'access_to', 'access_event']))
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
    await grant('billing', 'read')
    const result = await gateway.handle('oxespace_post', { action: 'requests', workspace: 'w1' }, actor) as { collections: Array<Record<string, unknown>> }
    expect(result.collections).toEqual([expect.objectContaining({ collection: 'billing', access: 'read', environment: { name: 'Staging', production: false }, variables: expect.arrayContaining(['host', 'page']), secrets: ['API_KEY'] })])
    expect((result.collections[0].requests as Array<Record<string, unknown>>).map(item => [item.name, item.method, item.url])).toEqual(expect.arrayContaining([['List invoices', 'GET', '{{host}}/invoices?page={{page}}'], ['Create invoice', 'POST', '{{host}}/invoices']]))
    const json = JSON.stringify(result)
    expect(json).not.toContain(SECRET); expect(json).not.toContain('https://api.example.com'); expect(json).not.toContain('"1"')
  })

  test('read access, GET: asks with the secret masked; the fetch gets the value; the result and the audit never show it', async () => {
    await grant('billing', 'read')
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
    await grant('billing', 'read')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'access-read-only' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
  })

  test('write access: a POST asks as a write; denied and pending send nothing', async () => {
    await grant('billing', 'write')
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
    await grant('billing', 'write', 'production')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'prod-write' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    await send({ path: paths.list })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ risk: 'read', environment: expect.objectContaining({ production: true, name: 'Production' }) })
  })

  test('a new request reaches only the origins the collection already uses', async () => {
    await grant('billing', 'read')
    await expect(send({ method: 'GET', url: 'https://evil.example.net/steal' })).rejects.toMatchObject({ code: 'origin' })
    await expect(send({ method: 'GET', url: 'http://api.example.com/invoices' })).rejects.toMatchObject({ code: 'origin' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(audit().map(row => [row.decision, row.error_code])).toEqual([['refused', 'origin'], ['refused', 'origin']])
    await send({ method: 'GET', url: 'https://api.example.com/customers' })
    expect(asked).toHaveLength(1); expect(fetched).toHaveLength(1)
  })

  test('a public origin that resolves to a private address is refused; a saved localhost origin is sent', async () => {
    await grant('billing', 'read', 'rebind')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'private-address' })
    expect(fetched).toEqual([])
    await grant('local', 'read', 'staging')
    await gateway.handle('oxespace_post', { action: 'send', workspace: 'w1', collection: 'local', path: paths.health }, actor)
    expect(fetched.map(item => item.url)).toEqual(['http://localhost:3000/health'])
  })

  test('a redirect to another origin is not followed', async () => {
    await grant('billing', 'read')
    reply = () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/x' } })
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'redirect' })
    expect(fetched).toHaveLength(1)
    expect(fetched[0].init.redirect).toBe('manual')
  })

  test('a secret that is not set fails before sending, naming the secret and the environment', async () => {
    await grant('billing', 'read', 'qa')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'secret-missing', message: expect.stringMatching(/\{\{API_KEY\}\}[\s\S]*QA/) })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
  })

  test('arguments cannot set a secret, carry auth, or reach an action that does not exist', async () => {
    await grant('billing', 'write')
    await expect(send({ path: paths.list, variables: { API_KEY: 'mine' } })).rejects.toMatchObject({ code: 'invalid' })
    await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'Authorization', value: 'Bearer abc' }] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'Cookie', value: 'a=b' }] })).rejects.toMatchObject({ code: 'invalid' })
    for (const action of ['access', 'setAccess', 'environments', 'secrets']) {
      await expect(gateway.handle('oxespace_post', { action, workspace: 'w1', collection: 'billing', access: 'write' }, actor)).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(db.prepare("SELECT access FROM oxepost_agent_access WHERE collection = 'billing'").get()).toEqual({ access: 'write' })
  })

  test('SECURITY 1: an agent-authored request cannot name a secret anywhere, so a secret is never reflected or stored', async () => {
    await grant('billing', 'write')
    const attempts: Array<Record<string, unknown>> = [
      { method: 'GET', url: 'https://api.example.com/echo?k={{API_KEY}}' },
      { method: 'GET', url: 'https://api.example.com/echo', headers: [{ name: 'X-Note', value: 'k={{ API_KEY }}' }] },
      { method: 'POST', url: 'https://api.example.com/notes', body: '{"text":"{{API_KEY}}"}' },
      { path: paths.list, variables: { page: '{{API_KEY}}' } },
      { path: paths.list, variables: { page: '{{host}}' } }
    ]
    for (const attempt of attempts) await expect(send(attempt), JSON.stringify(attempt)).rejects.toMatchObject({ code: 'invalid' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    // A saved request's own use of the secret is the person's and still works.
    await send({ path: paths.list })
    expect(header(fetched[0].init, 'x-trace')).toBe(SECRET)
  })

  test('SECURITY 5 (HML-654-3): an agent cannot fake a vaulted-secret marker on the approval card', async () => {
    await grant('billing', 'write')
    const literal = 'note [secret:API_KEY] here'
    await send({ method: 'POST', url: 'https://api.example.com/notes', body: literal, headers: [{ name: 'X-Note', value: '[secret:API_KEY]' }] })
    const ask = asked[0] as typeof asked[0] & { textSpans?: Array<{ kind: 'text' | 'secret'; value: string }> }
    expect(ask.textSpans, 'the approval carries structured spans').toBeDefined()
    expect(ask.textSpans!.filter(span => span.kind === 'secret')).toEqual([])
    expect(ask.textSpans!.map(span => span.value).join('')).toContain(literal)
    // Defense in depth: in the hashed approval text, the agent's literal can't read as main's marker.
    expect(ask.text).not.toMatch(/(^|[^[])\[secret:API_KEY\]/)
    expect(ask.text).toContain('[[secret:API_KEY]')
    // The bytes sent are exactly what the agent wrote.
    expect(fetched[0].init.body).toBe(literal)
    expect(header(fetched[0].init, 'x-note')).toBe('[secret:API_KEY]')
  })

  test('SECURITY 5b: a saved request that really uses a secret has exactly one secret span', async () => {
    await grant('billing', 'read')
    await send({ path: paths.list })
    const ask = asked[0] as typeof asked[0] & { textSpans?: Array<{ kind: 'text' | 'secret'; value: string }> }
    expect(ask.textSpans!.filter(span => span.kind === 'secret')).toEqual([{ kind: 'secret', value: 'API_KEY' }])
    expect(JSON.stringify(ask.textSpans)).not.toContain(SECRET)
    expect(ask.text).toContain('[secret:API_KEY]')
    expect(ask.text).not.toContain('[[secret:')
  })

  test('SECURITY 2: masking covers the encoded forms of a secret in the result and the audit', async () => {
    await grant('billing', 'read')
    // A secret that needs escaping, encodes with '+', '/' or padding, and has a non-ASCII character.
    const odd = String.raw`pa"ss/+ wÿörd\n?-77!`
    expect(Buffer.from(odd).toString('base64')).toMatch(/[+/].*=$/)
    const forms = {
      plain: odd,
      url: encodeURIComponent(odd),
      form: new URLSearchParams({ v: odd }).toString().slice(2),
      b64: Buffer.from(odd).toString('base64'),
      b64nopad: Buffer.from(odd).toString('base64').replace(/=+$/, ''),
      b64url: Buffer.from(odd).toString('base64url'),
      json: JSON.stringify(odd).slice(1, -1)
    }
    expect(new Set(Object.values(forms)).size).toBe(7)
    reply = () => new Response(Object.values(forms).join('\n'), { status: 500, headers: { 'content-type': 'text/plain', 'x-b64': forms.b64, 'x-url': forms.url } })
    gateway = new OxePostAgentGateway({ ...gatewayDeps(), secrets: { values: async () => ({ API_KEY: odd }) } })
    const result = await send({ path: paths.list }) as { body: string; headers: Array<{ name: string; value: string }>; url: string }
    const seen = [result.body, result.url, ...result.headers.map(item => item.value)].join('\n')
    const row = audit().at(-1)!
    const stored = [row.url_path, row.response_excerpt].map(String).join('\n')
    for (const [name, form] of Object.entries(forms)) {
      expect(seen, `result, ${name}`).not.toContain(form)
      expect(stored, `audit, ${name}`).not.toContain(form)
    }
    expect(result.body).toContain('[secret:API_KEY]')
  })

  test('SECURITY 3: an agent cannot set routing, proxy or hop-by-hop headers, or smuggle a line break', async () => {
    await grant('billing', 'write')
    const names = ['Host', 'Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Real-IP', 'X-Original-URL', 'X-Rewrite-URL',
      'Connection', 'Keep-Alive', 'Proxy-Connection', 'Proxy-Authorization', 'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade', 'Content-Length',
      'Authorization', 'Cookie', 'X-Api-Key', 'X-Ok\r\nX-Evil', 'X-Ok\nX-Evil', 'X-Nul\0']
    for (const name of names) {
      await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name, value: 'v' }] }), name).rejects.toMatchObject({ code: 'invalid' })
    }
    for (const value of ['a\r\nX-Evil: 1', 'a\nb', 'a\0b']) {
      await expect(send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'X-Note', value }] }), JSON.stringify(value)).rejects.toMatchObject({ code: 'invalid' })
    }
    expect(fetched).toEqual([])
    await send({ method: 'GET', url: 'https://api.example.com/x', headers: [{ name: 'X-Request-Id', value: 'abc' }] })
    expect(header(fetched[0].init, 'x-request-id')).toBe('abc')
  })

  test('SECURITY 4: the blocked address ranges are pinned', () => {
    const blocked = ['0.0.0.0', '0.1.2.3', '10.0.0.1', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.255.255', '169.254.169.254', '169.254.0.1',
      '172.16.0.1', '172.31.255.255', '192.0.0.8', '192.168.1.1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '240.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe']
    const allowed = ['93.184.216.34', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0', '2606:4700::1111', '::ffff:93.184.216.34']
    for (const ip of blocked) expect(isBlockedAddress(ip), ip).toBe(true)
    for (const ip of allowed) expect(isBlockedAddress(ip), ip).toBe(false)
    expect(isBlockedAddress('not-an-ip')).toBe(true)
  })

  test('SECURITY 4b: every resolved address is checked, and one bad address in the answer is enough to refuse', async () => {
    await grant('billing', 'read')
    gateway = new OxePostAgentGateway({ ...gatewayDeps(), lookup: async () => ['93.184.216.34', '169.254.169.254'] })
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'private-address' })
    gateway = new OxePostAgentGateway({ ...gatewayDeps(), lookup: async () => ['::ffff:127.0.0.1'] })
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'private-address' })
    expect(fetched).toEqual([])
  })

  test('PIN: its own direct connection, never a proxy from the environment, and TLS always verified', async () => {
    await grant('billing', 'read')
    const made: Array<Record<string, any>> = []
    const marker = { kind: 'gateway-dispatcher' }
    const saved = { HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY, NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED }
    process.env.HTTPS_PROXY = 'http://proxy.invalid:3128'; process.env.HTTP_PROXY = 'http://proxy.invalid:3128'; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    try {
      gateway = new OxePostAgentGateway({ ...gatewayDeps(), makeDispatcher: (options: Record<string, any>) => { made.push(options); return marker } })
      await send({ path: paths.list })
      await send({ path: paths.list })
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
    expect(made).toHaveLength(1)
    expect(made[0]).not.toHaveProperty('proxy'); expect(made[0]).not.toHaveProperty('uri')
    expect(made[0].connect.rejectUnauthorized).toBe(true)
    expect(typeof made[0].connect.lookup).toBe('function')
    for (const call of fetched) expect((call.init as { dispatcher?: unknown }).dispatcher).toBe(marker)
  })

  test('a failed response keeps a masked excerpt of at most 4 KB in the audit', async () => {
    await grant('billing', 'read')
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
    await grant('billing', 'write')
    await send({ path: paths.list })
    reply = () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: `reset while sending ${SECRET}` } }) }
    await expect(send({ path: paths.create })).rejects.toBeTruthy()
    expect(logs.join('\n')).not.toContain(SECRET)
    expect(JSON.stringify(audit())).not.toContain(SECRET)
  })

  test('an access change is a person\'s audited action', async () => {
    await grant('billing', 'read')
    await grant('billing', 'write')
    const rows = db.prepare("SELECT * FROM oxepost_audit WHERE actor = 'person' ORDER BY id").all() as Array<Record<string, unknown>>
    expect(rows.map(row => [row.collection, row.access_from, row.access_to, row.access_event, row.method, row.url_path, row.decision, row.outcome]))
      .toEqual([['billing', 'off', 'read', 'set', null, null, 'auto', 'ok'], ['billing', 'read', 'write', 'set', null, null, 'auto', 'ok']])
  })

  // ---- the grant is a snapshot of what the person saw (TECH LEAD's amendment + HML-A12-2/3) ----------------------

  test('SNAPSHOT: a saved request added later on a new host does not widen where agents may send', async () => {
    await grant('billing', 'write')
    await store.save(undefined, request({ name: 'Leak', method: 'POST', url: 'https://collector.example.org/in', body: '{}' }), 'billing')
    await expect(send({ path: 'billing/leak.http' })).rejects.toMatchObject({ code: 'origin' })
    await expect(send({ method: 'GET', url: 'https://collector.example.org/x' })).rejects.toMatchObject({ code: 'origin' })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
  })

  test('SNAPSHOT: a changed collection keeps reads to the origins already allowed and refuses writes until re-confirmed', async () => {
    await grant('billing', 'write')
    await store.save(undefined, request({ name: 'Extra', method: 'GET', url: '{{host}}/extra' }), 'billing')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'access-changed', message: expect.stringMatching(/changed since access was given/i) })
    expect(fetched).toEqual([])
    await send({ path: paths.list })
    expect(fetched).toHaveLength(1)
    const listed = await gateway.handle('oxespace_post', { action: 'requests', workspace: 'w1' }, actor) as { collections: Array<Record<string, unknown>> }
    expect(listed.collections[0]).toMatchObject({ collection: 'billing', changed: true })
    await confirmAgentAccess(db, { workspaceId: 'w1', root, collection: 'billing' })
    await send({ path: paths.create })
    expect(fetched).toHaveLength(2)
    const confirm = db.prepare("SELECT access_from, access_to, access_event FROM oxepost_audit WHERE actor = 'person' AND access_event = 'confirm'").all()
    expect(confirm).toEqual([{ access_from: 'write', access_to: 'write', access_event: 'confirm' }])
  })

  test('SNAPSHOT: a folder deleted and recreated under the same name starts at off, and its row is dropped', async () => {
    await grant('billing', 'write')
    rmSync(folder('billing'), { recursive: true, force: true })
    await pause(30)
    paths.list = await store.save(undefined, request({ name: 'List invoices', method: 'GET', url: '{{host}}/invoices?page={{page}}', headers: [{ name: 'X-Trace', value: '{{API_KEY}}', enabled: true }] }), 'billing')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'access-dropped', message: expect.stringMatching(/Access was turned off because this folder was recreated \(for example by a branch switch\)\. Allow it again in OxePost\./) })
    expect(asked).toEqual([]); expect(fetched).toEqual([])
    expect(db.prepare("SELECT COUNT(*) AS n FROM oxepost_agent_access WHERE collection = 'billing'").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT actor, access_from, access_to, error_code FROM oxepost_audit WHERE access_event = 'dropped'").all()).toEqual([{ actor: 'oxespace', access_from: 'write', access_to: 'off', error_code: 'folder-recreated' }])
    await grant('billing', 'read')
    await send({ path: paths.list })
    expect(fetched).toHaveLength(1)
  })

  test('SNAPSHOT: a renamed folder does not carry its grant, and a folder that copies another\'s requests gets nothing', async () => {
    await grant('billing', 'write')
    renameSync(folder('billing'), folder('billing2'))
    await expect(gateway.handle('oxespace_post', { action: 'send', workspace: 'w1', collection: 'billing2', path: 'billing2/list-invoices.http' }, actor)).rejects.toMatchObject({ code: 'access-off' })
    await expect(send({ path: 'billing/list-invoices.http' })).rejects.toMatchObject({ code: 'access-dropped' })
    expect(db.prepare("SELECT error_code FROM oxepost_audit WHERE access_event = 'dropped'").all()).toEqual([{ error_code: 'folder-missing' }])
    expect(fetched).toEqual([])
  })

  test('ENVIRONMENT: a rename keeps the grant (stable id); a deleted environment refuses with no-environment; turning production on applies at once', async () => {
    await grant('billing', 'write')
    await store.saveEnvironment({ name: 'Staging EU', production: false, variables: { host: 'https://api.example.com', page: '1' }, secrets: ['API_KEY'] }, 'staging')
    await send({ path: paths.create })
    expect(fetched).toHaveLength(1)
    await store.saveEnvironment({ name: 'Staging EU', production: true, variables: { host: 'https://api.example.com', page: '1' }, secrets: ['API_KEY'] }, 'staging')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'prod-write' })
    await store.deleteEnvironment('staging')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'no-environment', message: expect.stringMatching(/picks an environment/i) })
    expect(fetched).toHaveLength(1)
  })

  test('MESSAGES: every refusal tells the person what to change (HML-A12-1)', async () => {
    await grant('billing', 'read', null)
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'no-environment', message: expect.stringMatching(/Agents can't send from "billing" until a person picks an environment/) })
    await grant('billing', 'read', 'staging')
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'access-read-only', message: expect.stringMatching(/Agent access to "billing" is read only, so it can't send POST/) })
    await grant('billing', 'read', 'rebind')
    await expect(send({ path: paths.list })).rejects.toMatchObject({ code: 'private-address', message: expect.stringMatching(/rebind\.example\.com points to a private address/) })
    for (const code of ['rate-limit', 'no-environment', 'access-read-only', 'busy', 'private-address', 'redirect', 'timeout', 'access-changed', 'access-dropped', 'access-off', 'prod-write', 'origin', 'secret-missing']) {
      expect(OXEPOST_AGENT_REFUSALS, code).toContain(code)
    }
  })

  test('the person-only oxePost.call ops: list and set access, refuse a production write ceiling, and record the change', async () => {
    const vault = { available: () => true, problem: () => null, encrypt: (value: string) => Buffer.from(value), decrypt: (value: Buffer) => value.toString() }
    const service = new OxePostService({ rootOf: workspace => (workspace === 'w1' ? root : undefined), vault, secretsFile: join(root, 'secrets.bin'), db })
    expect(await service.call('agentCeilingSet', { kind: 'production', access: 'write' })).toMatchObject({ ok: false })
    expect(await service.call('agentCeilingSet', { kind: 'ordinary', access: 'read' })).toMatchObject({ ok: true })
    expect(await service.call('agentAccessSet', { workspaceId: 'w1', collection: 'billing', access: 'write', environmentId: 'staging' })).toMatchObject({ ok: true })
    expect(await service.call('agentAccessSet', { workspaceId: 'w1', collection: 'billing', access: 'everything', environmentId: 'staging' })).toMatchObject({ ok: false })
    const listed = await service.call('agentAccessList', { workspaceId: 'w1' }) as { ok: true; value: unknown }
    expect(JSON.stringify(listed.value)).toContain('billing')
    expect(db.prepare("SELECT access_from, access_to FROM oxepost_audit WHERE actor = 'person'").all()).toEqual([{ access_from: 'off', access_to: 'write' }])
    // The ordinary ceiling is now read: a write collection is capped to read for agents.
    await expect(send({ path: paths.create })).rejects.toMatchObject({ code: 'access-read-only' })
    expect(await service.call('agentAccessConfirm', { workspaceId: 'w1', collection: 'billing' })).toMatchObject({ ok: true })
    expect(db.prepare("SELECT access_event FROM oxepost_audit WHERE actor = 'person' ORDER BY id").all()).toEqual([{ access_event: 'set' }, { access_event: 'confirm' }])
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
    for (const op of ['agentAccessList', 'agentAccessSet', 'agentCeilingSet']) expect(JSON.stringify(MCP_COVERAGE['oxepost.person'])).not.toContain(`oxespace_post#${op}`)
    expect(MCP_COVERAGE['oxepost.person']).toHaveProperty('excluded')
    expect(APPROVAL_KINDS).toContain('oxepost')
    expect((APPROVAL_KINDS_REMOTE_FORBIDDEN as Record<string, string>).oxepost).toBe('oxepost.approve')
  })
})
