// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1): the agent HTTP audit table and its ingest.
// Written by the planner; the executor must not edit it. In-memory database only.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f3/h1-http-audit.native.test.ts
import { beforeAll, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { warmShellParser } from '../../../electron/main/services/conversation/shell-parse'
import { HTTP_AUDIT_MAX_ROWS, HTTP_AUDIT_RETENTION_DAYS, HttpAuditLog } from '../../../electron/main/services/http-audit/store'

beforeAll(async () => { expect(await warmShellParser()).toBe(true) })

const DAY = 86_400_000
const base = { paneId: 'p1', workspaceId: 'ws-1', agent: 'claude-code' as const, sessionId: 's1' }
const post = (command: string, toolUseId: string, stdoutHead = '', extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: toolUseId, session_id: 's1',
  tool_input: { command }, tool_response: { stdoutHead, stderrHead: '', interrupted: false, ...extra }
})
const rows = (db: AppDatabase) => db.prepare('SELECT * FROM agent_http_audit ORDER BY id').all() as Array<Record<string, unknown>>

describe('A59 · agent_http_audit', () => {
  test('A59: migration 094 creates the append-only table with its columns and unique call key', () => {
    const db = openInMemoryDatabase()
    try {
      const columns = (db.prepare('PRAGMA table_info(agent_http_audit)').all() as Array<{ name: string }>).map(column => column.name)
      expect(columns).toEqual(expect.arrayContaining(['id', 'ts', 'actor', 'workspace_id', 'agent', 'session_id', 'source', 'tool_use_id', 'call_index', 'tool', 'method', 'scheme', 'host', 'port', 'path_template', 'query_keys_json', 'header_names_json', 'has_body', 'body_bytes', 'status', 'duration_ms', 'insecure', 'plain_http_external', 'command_redacted', 'output_truncated']))
      new HttpAuditLog(db, () => 1000).ingest({ ...base, at: 1000, record: post('curl https://a.test/x', 'toolu_1') })
      expect(() => db.prepare("UPDATE agent_http_audit SET host = 'evil.test'").run()).toThrow(/append-only/)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'agent_http_audit' AND sql LIKE '%ts%'").all().length).toBeGreaterThan(0)
    } finally { db.close() }
  })

  test('A59: a curl call is stored masked: no header value, no query value, no stdout, and a redacted command of at most 512 characters', () => {
    const db = openInMemoryDatabase()
    try {
      const command = `curl -s -H 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789' 'https://api.example.com/v1/users/42?token=sekret99&page=2' -w '%{http_code}' ${'#'.repeat(700)}`
      const added = new HttpAuditLog(db, () => 5000).ingest({ ...base, at: 5000, record: post(command, 'toolu_2', '{"id":42,"secretOutput":"S3CR3T-OUT"}200') })
      expect(added).toBe(1)
      const [row] = rows(db)
      expect(row).toMatchObject({ actor: 'pane:p1', workspace_id: 'ws-1', agent: 'claude-code', source: 'hook', tool_use_id: 'toolu_2', call_index: 0, tool: 'curl', method: 'GET', scheme: 'https', host: 'api.example.com', port: 443, path_template: '/v1/users/:id', status: 200, has_body: 0, insecure: 0 })
      expect(JSON.parse(String(row.query_keys_json))).toEqual(['token', 'page'])
      expect(JSON.parse(String(row.header_names_json))).toEqual(['•••• (Authorization)'])
      expect(String(row.command_redacted).length).toBeLessThanOrEqual(512)
      const stored = JSON.stringify(row)
      for (const secret of ['ghp_abcdefghijklmnop', 'sekret99', 'S3CR3T-OUT']) expect(stored, secret).not.toContain(secret)
    } finally { db.close() }
  })

  test('A59: the same tool_use_id is stored once, from the hook or the rollout fallback', () => {
    const db = openInMemoryDatabase()
    try {
      const log = new HttpAuditLog(db, () => 1)
      const record = post('curl https://a.test/once', 'toolu_3')
      log.ingest({ ...base, at: 1, record })
      log.ingest({ ...base, at: 2, record })
      log.ingest({ ...base, at: 3, record, source: 'rollout' })
      expect(rows(db)).toHaveLength(1)
    } finally { db.close() }
  })

  test('A59: several calls in one command are separate rows; a non-HTTP command and malformed events add nothing and never throw', () => {
    const db = openInMemoryDatabase()
    try {
      const log = new HttpAuditLog(db, () => 1)
      expect(log.ingest({ ...base, at: 1, record: post('curl https://a.test/1 && curl -k http://example.org/2', 'toolu_4') })).toBe(2)
      expect(rows(db).map(row => [row.call_index, row.host, row.insecure, row.plain_http_external])).toEqual([[0, 'a.test', 0, 0], [1, 'example.org', 1, 1]])
      for (const record of [post('ls -la', 'toolu_5'), {}, { hook_event_name: 'PostToolUse' }, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } }, null as unknown as Record<string, unknown>]) {
        expect(() => log.ingest({ ...base, at: 2, record })).not.toThrow()
      }
      expect(rows(db)).toHaveLength(2)
    } finally { db.close() }
  })

  test('A59: duration comes from the PreToolUse→PostToolUse pair, and a cut output is marked', () => {
    const db = openInMemoryDatabase()
    try {
      const log = new HttpAuditLog(db, () => 1)
      log.ingest({ ...base, at: 1000, record: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_6', tool_input: { command: 'curl https://a.test/slow' } } })
      log.ingest({ ...base, at: 1250, record: post('curl https://a.test/slow', 'toolu_6', 'HTTP/1.1 201 Created\r\n', { truncated: true, keptBytes: 4096, totalBytes: 9000 }) })
      log.ingest({ ...base, at: 2000, record: post('curl https://a.test/lonely', 'toolu_7') })
      expect(rows(db).map(row => [row.tool_use_id, row.duration_ms, row.status, row.output_truncated])).toEqual([['toolu_6', 250, 201, 1], ['toolu_7', null, null, 0]])
    } finally { db.close() }
  })

  test('A59: retention keeps 90 days and at most 50,000 rows, newest first', () => {
    expect(HTTP_AUDIT_RETENTION_DAYS).toBe(90)
    expect(HTTP_AUDIT_MAX_ROWS).toBe(50_000)
    const db = openInMemoryDatabase()
    try {
      const now = 200 * DAY
      const insert = db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, command_redacted, output_truncated) VALUES (?, 'pane:p1', 'ws-1', 'claude-code', 'hook', ?, 0, 'curl', 'GET', 'https', 'a.test', 443, '/', '[]', '[]', 0, 0, 0, 'curl', 0)")
      db.transaction(() => {
        insert.run(now - 91 * DAY, 'old')
        for (let index = 0; index < 50_005; index++) insert.run(now - DAY + index, `t${index}`)
      })()
      new HttpAuditLog(db, () => now).prune()
      const count = (db.prepare('SELECT COUNT(*) AS n FROM agent_http_audit').get() as { n: number }).n
      expect(count).toBe(50_000)
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_http_audit WHERE tool_use_id IN ('old', 't0', 't4')").get()).toEqual({ n: 0 })
      expect(db.prepare("SELECT COUNT(*) AS n FROM agent_http_audit WHERE tool_use_id = 't50004'").get()).toEqual({ n: 1 })
    } finally { db.close() }
  })
})
