// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1), SECURITY sweep (TECH LEAD S1–S7, HML-695-1):
// with every leak case stored, no secret is in any stored column, in http-audit:list's rows or in agent-activity:detail;
// and an event's stdout/stderr reaches NO table. Written by the planner; the executor must not edit it.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/h1-secret-sweep.native.test.ts
import { request } from 'node:http'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { warmShellParser } from '../../../electron/main/services/conversation/shell-parse'
import { HttpAuditLog } from '../../../electron/main/services/http-audit/store'
import { AgentActivity } from '../../../electron/main/services/agent-activity/read-model'
import { AgentHookServer } from '../../../electron/main/services/agent-hooks/server'
import { hookServerOptionsFor } from '../../../electron/main/services/agent-hooks/hook-pipeline'
import { LEAK_CASES } from './fixtures/http-leak-cases'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })
const open: AppDatabase[] = []
let server: AgentHookServer | null = null
afterEach(() => { server?.stop(); server = null; for (const db of open.splice(0)) db.close() })

/** Every text value in every table of the database, for a full scan. */
function everything(db: AppDatabase): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(row => row.name)
  return tables.map(name => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join('\n')
}
const ALL_SECRETS = LEAK_CASES.flatMap(item => item.secrets)

describe('A59 · SECURITY sweep', () => {
  test('S1–S7: with every leak case stored, no secret is in any column, any list row or any activity detail', () => {
    const db = openInMemoryDatabase(); open.push(db)
    const log = new HttpAuditLog(db, () => 1000, { isProductionHost: () => false })
    LEAK_CASES.forEach((item, index) => {
      log.ingest({ paneId: 'p1', workspaceId: 'ws-1', agent: 'claude-code', sessionId: 's1', at: 1000 + index, record: {
        hook_event_name: 'PostToolUse', tool_name: item.shell === 'powershell' ? 'PowerShell' : 'Bash', tool_use_id: `toolu_${index}`, session_id: 's1',
        tool_input: { command: item.command }, tool_response: { stdoutHead: '', stderrHead: '', interrupted: false }
      } })
    })
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_http_audit').get() as { n: number }).n).toBeGreaterThanOrEqual(LEAK_CASES.length)
    const stored = JSON.stringify(db.prepare('SELECT * FROM agent_http_audit').all())
    const listed = JSON.stringify(log.list({ workspaceId: 'ws-1', limit: 200 }))
    const activity = new AgentActivity(db, { isProductionHost: () => false, pendingFor: () => false, now: () => 2000 })
    const details = JSON.stringify(activity.list({ sources: ['http'], limit: 200 }).rows.map(row => activity.detail(row.id)))
    for (const secret of ALL_SECRETS) {
      expect(stored, `stored: ${secret}`).not.toContain(secret)
      expect(listed, `http-audit:list: ${secret}`).not.toContain(secret)
      expect(details, `agent-activity:detail: ${secret}`).not.toContain(secret)
    }
  })

  test('S5: an event sent through the hook server leaves its stdout and stderr in no table at all', async () => {
    const db = openInMemoryDatabase(); open.push(db)
    server = new AgentHookServer(hookServerOptionsFor({
      db, now: () => 5000,
      authenticate: input => (input.token === 'token-1' ? { paneId: 'p1', workspaceId: 'ws-1' } : null),
      onStatus: () => undefined
    }))
    const port = await server.start()
    const payload = {
      hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_s5', session_id: '11111111-2222-3333-4444-555555555555',
      tool_input: { command: 'curl -s https://a.test/s5' },
      tool_response: { stdoutHead: 'STDOUT-MARKER-S5 {"token":"x"}', stderrHead: 'STDERR-MARKER-S5', interrupted: false }
    }
    const body = JSON.stringify({ executionId: 'exec-1', token: 'token-1', workspaceId: 'ws-1', agent: 'claude-code', payload })
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', () => resolve()) })
      req.on('error', reject); req.end(body)
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect((db.prepare('SELECT COUNT(*) AS n FROM agent_http_audit').get() as { n: number }).n).toBe(1)
    const all = everything(db)
    expect(all).not.toContain('STDOUT-MARKER-S5')
    expect(all).not.toContain('STDERR-MARKER-S5')
  })
})
