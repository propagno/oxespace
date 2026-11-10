// Frozen acceptance test for 1.5.0 A10 (OXE program, phase F3): one Agent activity read model over four sources
// (changes, databases, containers, http), paged and filtered in main, with partial failure, plus the R18 badge.
// Written by the planner; the executor must not edit it. Supersedes #650's F2 test (the post source is gone).
// Spec: docs/roadmap-1.5/ccr-h1-http-audit.md §A10 and DESIGN's 1.5.0-f3-design.md "Data each screen needs".
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/a10-agent-activity.native.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { AgentActivity, parseAgentActivityQuery } from '../../../electron/main/services/agent-activity/read-model'
import { AGENT_ACTIVITY_SOURCES, type AgentActivityQuery, type AgentActivityRow } from '../../../shared/types/agent-activity'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'

const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) db.close() })
function database(): AppDatabase { const db = openInMemoryDatabase(); open.push(db); return db }

function change(db: AppDatabase, ts: number, o: Partial<{ actor: string; level: string; decision: string; outcome: string }> = {}): void {
  db.prepare("INSERT INTO agent_action_audit (ts, actor, workspace_id, tool, action, level, text, decision, outcome) VALUES (?, ?, 'ws-1', 'oxespace_git_change', 'commit', ?, 'commit -m fix', ?, ?)")
    .run(ts, o.actor ?? 'thread:t1', o.level ?? 'write', o.decision ?? 'approved', o.outcome ?? 'ok')
}
function query(db: AppDatabase, ts: number, o: Partial<{ tool: string; connection: string; outcome: string }> = {}): void {
  db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (?, 'pane:p1', ?, 'shop', 'postgres', 'dev', ?, 'SELECT 1', 'auto', ?)")
    .run(ts, o.connection ?? 'c-shop', o.tool ?? 'oxespace_db_query', o.outcome ?? 'ok')
}
let http = 0
function call(db: AppDatabase, ts: number, o: Partial<{ method: string; host: string; status: number | null; insecure: number }> = {}): void {
  http++
  db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, status, command_redacted, output_truncated) VALUES (?, 'pane:p1', 'ws-1', 'claude-code', 'hook', ?, 0, 'curl', ?, 'https', ?, 443, '/v1/charges/:id', '[\"page\"]', '[]', 0, ?, 0, ?, 'curl …', 0)")
    .run(ts, `toolu_${http}`, o.method ?? 'GET', o.host ?? 'api.example.com', o.insecure ?? 0, o.status === undefined ? 200 : o.status)
}
function walk(model: AgentActivity, q: AgentActivityQuery): AgentActivityRow[] {
  const rows: AgentActivityRow[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 100; guard++) {
    const page = model.list({ ...q, cursor })
    rows.push(...page.rows)
    if (page.cursor === null) return rows
    cursor = page.cursor
  }
  throw new Error('paging never ended')
}
const deps = (over: Partial<{ isProductionHost: (workspaceId: string, host: string) => boolean; pendingFor: (connectionId: string) => boolean; now: () => number }> = {}) =>
  ({ isProductionHost: () => false, pendingFor: () => false, now: () => 10_000, ...over })

describe('A10 · one Agent activity read model, four sources', () => {
  test('A10: the sources are changes, databases, containers and http, in this order', () => {
    expect(AGENT_ACTIVITY_SOURCES).toEqual(['changes', 'databases', 'containers', 'http'])
  })

  test('A10: one newest-first list across sources; an http row reads METHOD host/path, targets the host, and is a write unless GET/HEAD/OPTIONS', () => {
    const db = database()
    change(db, 40); query(db, 30); query(db, 20, { tool: 'oxespace_container_action' }); call(db, 10, { method: 'POST' })
    const page = new AgentActivity(db, deps()).list({})
    expect(page.cursor).toBeNull()
    expect(page.failedSources).toEqual([])
    expect(page.rows.map(row => [row.at, row.source])).toEqual([[40, 'changes'], [30, 'databases'], [20, 'containers'], [10, 'http']])
    expect(page.rows[3]).toMatchObject({ summary: 'POST api.example.com/v1/charges/:id', target: 'api.example.com', write: true, outcome: 'ok', agent: 'claude-code', workspaceId: 'ws-1' })
    expect(page.rows[3].id.startsWith('http:')).toBe(true)
  })

  test('A10: an http status of 400 or more is a problem; no status is not', () => {
    const db = database()
    call(db, 3, { status: 503 }); call(db, 2, { status: null }); call(db, 1, { status: 204 })
    const rows = walk(new AgentActivity(db, deps()), { sources: ['http'], view: 'problems' })
    expect(rows.map(row => [row.at, row.outcome])).toEqual([[3, 'error']])
  })

  test('A10: an http row carries its status for the window\'s chip, null when no response was seen (TECH LEAD G-a)', () => {
    const db = database()
    call(db, 3, { status: 503 }); call(db, 2, { status: null }); call(db, 1, { status: 201 })
    change(db, 4)
    const rows = walk(new AgentActivity(db, deps()), {})
    expect(rows.filter(row => row.source === 'http').map(row => [row.at, row.status])).toEqual([[3, 503], [2, null], [1, 201]])
    expect(rows.find(row => row.source === 'changes')).not.toHaveProperty('status')
  })

  test('A10: pages of 50 by default, every row once and in order, with a cursor', () => {
    const db = database()
    for (let index = 0; index < 60; index++) { change(db, 1000 - index); call(db, 1000 - index) }
    const model = new AgentActivity(db, deps())
    const first = model.list({})
    expect(first.rows).toHaveLength(50)
    expect(typeof first.cursor).toBe('string')
    const all = walk(model, {})
    expect(all).toHaveLength(120)
    expect(new Set(all.map(row => row.id)).size).toBe(120)
    for (let index = 1; index < all.length; index++) expect(all[index - 1].at >= all[index].at).toBe(true)
  })

  test('A10: a source that fails is reported in failedSources, and the others still come back', () => {
    const db = database()
    change(db, 2); call(db, 1)
    db.exec('DROP TABLE agent_http_audit')
    const page = new AgentActivity(db, deps()).list({})
    expect(page.failedSources).toEqual(['http'])
    expect(page.rows.map(row => row.source)).toEqual(['changes'])
  })

  test('A10: each source is read by its own bounded statement through its ts index', () => {
    const db = database()
    for (let index = 0; index < 20; index++) { change(db, index); query(db, index); call(db, index) }
    db.exec('ANALYZE')
    const statements = new AgentActivity(db, deps()).listStatements({ limit: 5 })
    expect(statements.map(statement => statement.source).sort()).toEqual(['changes', 'containers', 'databases', 'http'])
    for (const { source, sql, params } of statements) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(row => row.detail)
      expect(plan.some(line => /USING (COVERING )?INDEX idx_[a-z_]+_ts\b/.test(line)), `${source}:\n${plan.join('\n')}`).toBe(true)
      expect(plan.filter(line => /^SCAN [a-z_]+$/.test(line)), source).toEqual([])
      expect(sql).toMatch(/LIMIT/i)
    }
  })

  test('A10: filters by source, agent and workspace, and refuses unknown values', () => {
    const db = database()
    change(db, 3); query(db, 2); call(db, 1)
    const model = new AgentActivity(db, deps())
    expect(walk(model, { sources: ['http'] }).map(row => row.source)).toEqual(['http'])
    expect(walk(model, { agent: 'claude-code' }).map(row => row.source)).toEqual(['http'])
    expect(walk(model, { workspaceId: 'ws-2' })).toEqual([])
    expect(() => parseAgentActivityQuery({ sources: ['post'] })).toThrow()
    expect(() => parseAgentActivityQuery({ sources: [] })).toThrow()
    expect(() => parseAgentActivityQuery({ agent: 'x'.repeat(300) })).toThrow()
  })

  test('A10: detail of an http row has its stored fields and a computed production flag', () => {
    const db = database()
    call(db, 1, { host: 'api.prod.test' })
    const model = new AgentActivity(db, deps({ isProductionHost: (workspaceId, host) => workspaceId === 'ws-1' && host === 'api.prod.test' }))
    const [row] = model.list({}).rows
    expect(model.detail(row.id)).toMatchObject({ source: 'http', method: 'GET', scheme: 'https', host: 'api.prod.test', port: 443, pathTemplate: '/v1/charges/:id', queryKeys: ['page'], headerNames: [], hasBody: false, status: 200, insecure: false, sourceKind: 'hook', production: true })
    expect(model.detail('http:999999')).toBeNull()
  })
})

describe('R18 · the activity badge of a connection', () => {
  test('R18: today counts this connection\'s database and container rows since local midnight, and waiting reflects a pending approval', () => {
    const db = database()
    const now = new Date(2026, 10, 8, 15, 0, 0).getTime()
    const midnight = new Date(2026, 10, 8, 0, 0, 0).getTime()
    query(db, midnight - 1); query(db, midnight + 1); query(db, now - 5); query(db, now - 4, { tool: 'oxespace_container_logs' }); query(db, now - 3, { connection: 'c-other' })
    const model = new AgentActivity(db, deps({ now: () => now, pendingFor: id => id === 'c-shop' }))
    expect(model.badge({ connectionId: 'c-shop' })).toEqual({ today: 3, waiting: true })
    expect(model.badge({ connectionId: 'c-other' })).toEqual({ today: 1, waiting: false })
    expect(model.badge({ connectionId: 'c-none' })).toEqual({ today: 0, waiting: false })
  })
})

describe('A10 · surface', () => {
  test('A10: agent-activity list, detail and badge are IPC channels, excluded from MCP', () => {
    expect(IPC_CHANNELS.agentActivity).toEqual({ list: 'agent-activity:list', detail: 'agent-activity:detail', badge: 'agent-activity:badge' })
    for (const channel of ['agentActivity.list', 'agentActivity.detail', 'agentActivity.badge']) {
      const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(channel) || capability.ipc?.includes('agentActivity.*'))
      expect(claims, channel).toHaveLength(1)
      expect(claims[0]).toHaveProperty('excluded')
    }
  })

  test('A10: the preload API calls each channel with what the window passes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn() } as PreloadIpc)
    const query = { sources: ['http' as const], limit: 10 }
    await api.agentActivity.list(query)
    await api.agentActivity.detail('http:1')
    await api.agentActivity.badge({ connectionId: 'c-shop' })
    expect(invoke.mock.calls).toEqual([[IPC_CHANNELS.agentActivity.list, query], [IPC_CHANNELS.agentActivity.detail, 'http:1'], [IPC_CHANNELS.agentActivity.badge, { connectionId: 'c-shop' }]])
  })
})
