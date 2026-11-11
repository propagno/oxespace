// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1-5): Codex's HTTP calls are read from its session
// rollout after the turn, with the same masking as the hook path, and never duplicated. Written by the planner; the
// executor must not edit it. The rollout is SYNTHETIC, written from Codex's published rollout JSONL shape (session_meta,
// response_item function_call / function_call_output, and local_shell_call): no live Codex run, no user files.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/h1-codex-rollout.native.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { warmShellParser } from '../../../electron/main/services/conversation/shell-parse'
import { HttpAuditLog } from '../../../electron/main/services/http-audit/store'
import { ingestCodexRollout } from '../../../electron/main/services/http-audit/codex-rollout'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })
let dir: string
let db: AppDatabase
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'oxe-rollout-')); db = openInMemoryDatabase() })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

const line = (value: unknown) => JSON.stringify(value)
function rollout(): string {
  const file = join(dir, 'rollout-2026-11-08T10-00-00-0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl')
  writeFileSync(file, [
    line({ timestamp: '2026-11-08T10:00:00.000Z', type: 'session_meta', payload: { id: '0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee', cwd: '/repo' } }),
    line({ timestamp: '2026-11-08T10:00:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'call_1', arguments: JSON.stringify({ command: ['bash', '-lc', "curl -s -H 'Authorization: Bearer SKR1bearer' 'https://api.test/v1/users/42?token=SKR2query' -w '%{http_code}'"], workdir: '/repo' }) } }),
    line({ timestamp: '2026-11-08T10:00:01.500Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: JSON.stringify({ output: '{"secret":"SKR3stdout"}200', metadata: { exit_code: 0, duration_seconds: 0.5 } }) } }),
    line({ timestamp: '2026-11-08T10:00:02.000Z', type: 'response_item', payload: { type: 'local_shell_call', call_id: 'call_2', status: 'completed', action: { type: 'exec', command: ['curl', '-d', 'pw=SKR4body', 'https://api.test/login'] } } }),
    line({ timestamp: '2026-11-08T10:00:03.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'call_3', arguments: JSON.stringify({ command: ['ls', '-la'] }) } }),
    'not json at all',
    line({ timestamp: '2026-11-08T10:00:04.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'curl https://not.a.call.test' }] } })
  ].join('\n') + '\n')
  return file
}
const rows = () => db.prepare('SELECT * FROM agent_http_audit ORDER BY ts, call_index').all() as Array<Record<string, unknown>>
const target = { paneId: 'p1', workspaceId: 'ws-1', sessionId: '0199aaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }

describe('H1-5 · the Codex rollout fallback', () => {
  test('H1-5: shell and local_shell calls become rows with source rollout, status and duration; other lines are ignored', async () => {
    const added = await ingestCodexRollout(new HttpAuditLog(db, () => 1), { file: rollout(), ...target })
    expect(added).toBe(2)
    expect(rows().map(row => [row.tool_use_id, row.source, row.agent, row.host, row.method, row.path_template, row.status, row.duration_ms])).toEqual([
      ['call_1', 'rollout', 'codex', 'api.test', 'GET', '/v1/users/:id', 200, 500],
      ['call_2', 'rollout', 'codex', 'api.test', 'POST', '/login', null, null]
    ])
  })

  test('H1-5: the same masking applies: no header, query, body or output value is stored', async () => {
    await ingestCodexRollout(new HttpAuditLog(db, () => 1), { file: rollout(), ...target })
    const stored = JSON.stringify(rows())
    for (const secret of ['SKR1bearer', 'SKR2query', 'SKR3stdout', 'SKR4body']) expect(stored, secret).not.toContain(secret)
  })

  test('H1-5: reading the rollout again, or after the hook stored a call, adds nothing', async () => {
    const log = new HttpAuditLog(db, () => 1)
    log.ingest({ paneId: 'p1', workspaceId: 'ws-1', agent: 'codex', sessionId: target.sessionId, at: 1, record: { hook_event_name: 'PostToolUse', tool_name: 'shell', tool_use_id: 'call_1', tool_input: { command: 'curl -s https://api.test/v1/users/42' }, tool_response: { stdoutHead: '', stderrHead: '', interrupted: false } } })
    const file = rollout()
    expect(await ingestCodexRollout(log, { file, ...target })).toBe(1)
    expect(await ingestCodexRollout(log, { file, ...target })).toBe(0)
    expect(rows()).toHaveLength(2)
  })

  test('H1-5: a missing or unreadable rollout adds nothing and never throws', async () => {
    const log = new HttpAuditLog(db, () => 1)
    await expect(ingestCodexRollout(log, { file: join(dir, 'missing.jsonl'), ...target })).resolves.toBe(0)
    // A folder in place of the file is unreadable as a rollout.
    await expect(ingestCodexRollout(log, { file: dir, ...target })).resolves.toBe(0)
    // The path is live: a real rollout with the same target does add its calls.
    expect(await ingestCodexRollout(log, { file: rollout(), ...target })).toBeGreaterThan(0)
  })
})
