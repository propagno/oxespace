// Frozen acceptance test for 1.5.0 H2's data (OXE program, phase F3): the HTTP calls panel and the Network tab read one
// page from main, filtered and summarised per host, with production computed. Written by the planner; the executor must
// not edit it. DESIGN 1.5.0-f3-design.md U3.2. In-memory database only.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/h2-http-list.native.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { HttpAuditLog } from '../../../electron/main/services/http-audit/store'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'

const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) db.close() })
let n = 0
function call(db: AppDatabase, ts: number, host: string, o: Partial<{ path: string; status: number | null; insecure: number; plain: number; workspace: string; actor: string }> = {}): void {
  n++
  db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, status, command_redacted, output_truncated) VALUES (?, ?, ?, 'claude-code', 'hook', ?, 0, 'curl', 'GET', 'https', ?, 443, ?, '[]', '[]', 0, ?, ?, ?, 'curl', 0)")
    .run(ts, o.actor ?? 'pane:p1', o.workspace ?? 'ws-1', `toolu_${n}`, host, o.path ?? '/v1/x', o.insecure ?? 0, o.plain ?? 0, o.status === undefined ? 200 : o.status)
}
function seeded(): HttpAuditLog {
  const db = openInMemoryDatabase(); open.push(db)
  call(db, 6, 'api.stripe.test', { path: '/v1/charges/:id', status: 402 })
  call(db, 5, 'api.stripe.test', { path: '/v1/customers' })
  call(db, 4, 'db.prod.test', { status: null })
  call(db, 3, 'legacy.test', { insecure: 1 })
  call(db, 1, 'plain.test', { plain: 1, actor: 'thread:t9' })
  call(db, 2, 'api.stripe.test', { workspace: 'ws-2' })
  return new HttpAuditLog(db, () => 100, { isProductionHost: (workspaceId, host) => workspaceId === 'ws-1' && host === 'db.prod.test' })
}

describe('H2 · the HTTP calls list', () => {
  test('H2: one workspace\'s calls, newest first, with a per-host summary and production computed', () => {
    const page = seeded().list({ workspaceId: 'ws-1' })
    expect(page.rows.map(row => [row.at, row.host])).toEqual([[6, 'api.stripe.test'], [5, 'api.stripe.test'], [4, 'db.prod.test'], [3, 'legacy.test'], [1, 'plain.test']])
    expect(page.hosts).toEqual([
      { host: 'api.stripe.test', count: 2, production: false },
      { host: 'db.prod.test', count: 1, production: true },
      { host: 'legacy.test', count: 1, production: false },
      { host: 'plain.test', count: 1, production: false }
    ])
    expect(page.rows.find(row => row.host === 'db.prod.test')).toMatchObject({ production: true, status: null })
    expect(page.cursor).toBeNull()
  })

  test('H2: Errors is no status or 400+, Flagged is production, TLS not checked or not encrypted, and the filter matches host or path', () => {
    const log = seeded()
    expect(log.list({ workspaceId: 'ws-1', view: 'errors' }).rows.map(row => row.at)).toEqual([6, 4])
    expect(log.list({ workspaceId: 'ws-1', view: 'flagged' }).rows.map(row => row.at)).toEqual([4, 3, 1])
    expect(log.list({ workspaceId: 'ws-1', filter: 'CUSTOMERS' }).rows.map(row => row.at)).toEqual([5])
    expect(log.list({ workspaceId: 'ws-1', filter: 'legacy' }).rows.map(row => row.at)).toEqual([3])
  })

  test('H2: the Network tab filters to one actor in main (DESIGN M5)', () => {
    const log = seeded()
    expect(log.list({ workspaceId: 'ws-1', actor: 'thread:t9' }).rows.map(row => [row.at, row.host])).toEqual([[1, 'plain.test']])
    expect(log.list({ workspaceId: 'ws-1', actor: 'thread:t9' }).hosts).toEqual([{ host: 'plain.test', count: 1, production: false }])
    expect(log.list({ workspaceId: 'ws-1', actor: 'pane:p1' }).rows.map(row => row.at)).toEqual([6, 5, 4, 3])
    expect(log.list({ workspaceId: 'ws-1', actor: 'pane:nobody' }).rows).toEqual([])
    expect(() => log.list({ workspaceId: 'ws-1', actor: 'x'.repeat(300) })).toThrow()
  })

  test('H2: pages of 50 with a cursor, and refusals for unknown views', () => {
    const db = openInMemoryDatabase(); open.push(db)
    for (let index = 0; index < 55; index++) call(db, 1000 - index, 'a.test')
    const log = new HttpAuditLog(db, () => 2000, { isProductionHost: () => false })
    const first = log.list({ workspaceId: 'ws-1' })
    expect(first.rows).toHaveLength(50)
    const second = log.list({ workspaceId: 'ws-1', cursor: first.cursor ?? undefined })
    expect(second.rows).toHaveLength(5)
    expect(second.cursor).toBeNull()
    expect(() => log.list({ workspaceId: 'ws-1', view: 'everything' as never })).toThrow()
  })

  test('H2: http-audit:list is an IPC channel excluded from MCP', () => {
    expect(IPC_CHANNELS.httpAudit).toEqual({ list: 'http-audit:list' })
    const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes('httpAudit.list') || capability.ipc?.includes('httpAudit.*'))
    expect(claims).toHaveLength(1)
    expect(claims[0]).toHaveProperty('excluded')
  })
})
