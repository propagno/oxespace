import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import Database from 'better-sqlite3'

import { ContextUsageService } from '../../electron/main/services/contextUsage'
import { readCopilotContext } from '../../electron/main/services/contextUsage/copilotContext'
import { UsageService } from '../../electron/main/services/usage.service'
import { ClaudeUsageProvider } from '../../electron/main/services/usage/claudeProvider'
import { CodexUsageProvider } from '../../electron/main/services/usage/codexProvider'

function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

// ── Claude / Codex via the reused UsageService ────────────────────────────────

describe('ContextUsageService — Claude/Codex (lastTurn ÷ contextLimit)', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ctx-usage-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  test('claude: context % from the last turn of the newest transcript', async () => {
    const ws = join(root, 'eduardo.carvalho@seedz.ag', 'repo-with-dashes')
    mkdirSync(ws, { recursive: true })
    const projectsRoot = join(root, 'claude-projects')
    const projectDir = join(projectsRoot, encodePath(ws))
    mkdirSync(projectDir, { recursive: true })
    const line = (u: object) => JSON.stringify({ message: { model: 'claude-sonnet-4-6', usage: u } })
    writeFileSync(join(projectDir, 'sess-1.jsonl'), [
      line({ input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 5 }),
      // last turn = current context fill: 2 + 3000 + 380000 + 5000 = 388002
      line({ input_tokens: 2, cache_creation_input_tokens: 3000, cache_read_input_tokens: 380000, output_tokens: 5000 })
    ].join('\n'))

    const usage = new UsageService([new ClaudeUsageProvider(projectsRoot)])
    const chip = new ContextUsageService(usage).get('claude', ws, undefined, true)
    expect(chip.available).toBe(true)
    expect(chip.usedTokens).toBe(388002)
    expect(chip.limitTokens).toBe(1_000_000)
    expect(chip.usedPct).toBe(39) // round(38.8%)
    expect(chip.modelId).toBe('claude-sonnet-4-6')
  })

  test('codex: context % uses last_token_usage ÷ model_context_window', async () => {
    const ws = join(root, 'cdx')
    mkdirSync(ws, { recursive: true })
    const sessionsRoot = join(root, 'codex-sessions')
    const dayDir = join(sessionsRoot, '2026', '06', '03')
    mkdirSync(dayDir, { recursive: true })
    const nativeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const meta = JSON.stringify({ type: 'session_meta', payload: { id: nativeId, cwd: ws, model: 'gpt-5', base_instructions: 'x'.repeat(12_000) } })
    const tok = JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: { input_tokens: 50000, cached_input_tokens: 10000, output_tokens: 2000 },
          last_token_usage: { input_tokens: 60000, cached_input_tokens: 4000, output_tokens: 1000 },
          model_context_window: 200000
        }
      }
    })
    const sessionFile = join(dayDir, `rollout-2026-06-03T10-00-00-${nativeId}.jsonl`)
    writeFileSync(sessionFile, [meta, JSON.stringify({ type: 'response_item', payload: { type: 'fixture', content: 'x'.repeat(5 * 1024 * 1024) } }), tok].join('\n'))
    writeFileSync(join(root, 'history.jsonl'), JSON.stringify({ session_id: nativeId, ts: 1, text: 'Analyze the native resume picker' }) + '\n')

    const usage = new UsageService([new CodexUsageProvider(sessionsRoot)])
    const chip = new ContextUsageService(usage).get('codex', ws, undefined, true)
    expect(chip.available).toBe(true)
    // last input + cacheRead + output = 60000 + 4000 + 1000 = 65000
    expect(chip.usedTokens).toBe(65000)
    expect(chip.limitTokens).toBe(200000)
    expect(chip.usedPct).toBe(33) // round(32.5%)
    const sessions = usage.listSessionsFor('codex', ws)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sessionId: nativeId, modelId: 'gpt-5', summary: 'Analyze the native resume picker' })
  })

  test('codex: resume discovery includes sessions older than fourteen days', () => {
    const ws = join(root, 'historic-cdx')
    const sessionsRoot = join(root, 'codex-history')
    const dayDir = join(sessionsRoot, '2025', '01', '03')
    mkdirSync(dayDir, { recursive: true })
    const file = join(dayDir, 'rollout-2025-01-03T10-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl')
    writeFileSync(file, [
      JSON.stringify({ type: 'session_meta', payload: { cwd: ws, model: 'gpt-5' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 4 }, last_token_usage: { input_tokens: 4 } } } })
    ].join('\n'))
    utimesSync(file, new Date('2025-01-03T10:00:00Z'), new Date('2025-01-03T10:00:00Z'))

    expect(new CodexUsageProvider(sessionsRoot).listSessions(ws).map(session => session.sessionId))
      .toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  test('codex: resume discovery mirrors the native SQLite picker even when rollouts cannot be read', () => {
    const ws = join(root, 'indexed-cdx')
    const codexHome = join(root, '.codex')
    const sessionsRoot = join(codexHome, 'sessions')
    mkdirSync(sessionsRoot, { recursive: true })
    const database = new Database(join(codexHome, 'state_5.sqlite'))
    database.exec(`CREATE TABLE threads (
      id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', first_user_message TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '', name TEXT, model TEXT, created_at INTEGER NOT NULL, created_at_ms INTEGER,
      updated_at INTEGER NOT NULL, updated_at_ms INTEGER, archived INTEGER NOT NULL DEFAULT 0
    )`)
    const insert = database.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', process.platform === 'win32' ? `\\\\?\\${ws}` : ws,
      'Native picker title', '', '', null, 'gpt-5.6-sol', 100, 100_123, 200, 200_456, 0)
    insert.run('bbbbbbbb-cccc-dddd-eeee-ffffffffffff', ws, 'Archived session', '', '', null, 'gpt-5', 100, 100_000, 300, 300_000, 1)
    insert.run('cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa', ws, '', '', '', null, 'gpt-5', 100, 100_000, 400, 400_000, 0)
    database.close()

    expect(new CodexUsageProvider(sessionsRoot).listSessions(ws)).toEqual([
      expect.objectContaining({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', modelId: 'gpt-5.6-sol',
        summary: 'Native picker title', sessionStartedAtMs: 100_123, lastUpdatedMs: 200_456 })
    ])
  })

  test('unsupported provider → unavailable', () => {
    const chip = new ContextUsageService(new UsageService([])).get('antigravity', root, undefined, true)
    expect(chip.available).toBe(false)
  })
})

// ── Copilot via process-log parsing ───────────────────────────────────────────

describe('readCopilotContext — Copilot process logs', () => {
  let root: string
  let copilotRoot: string
  let ws: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ctx-copilot-'))
    copilotRoot = join(root, '.copilot')
    ws = join(root, 'repo')
    mkdirSync(join(copilotRoot, 'logs'), { recursive: true })
    mkdirSync(ws, { recursive: true })
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  function writeSession(sessionId: string, cwd: string): void {
    const dir = join(copilotRoot, 'session-state', sessionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workspace.yaml'), `id: ${sessionId}\ncwd: ${cwd}\nbranch: main\n`)
  }
  function writeLog(name: string, sessionId: string, utilLine: string): void {
    writeFileSync(join(copilotRoot, 'logs', name), [
      `2026-06-03T10:05:06.502Z [INFO] Registering foreground session: ${sessionId}`,
      utilLine
    ].join('\n'))
  }

  test('parses the last Utilization line of the workspace-scoped log', () => {
    const sid = '04f863e5-6591-40a9-9f58-d8ae14bb8edc'
    writeSession(sid, ws)
    writeLog('process-1-1.log', sid,
      '2026-06-03T10:10:00Z [INFO] CompactionProcessor: Utilization 28.8% (36901/128000 tokens) below threshold 80%')

    const reading = readCopilotContext(ws, copilotRoot)
    expect(reading).not.toBeNull()
    expect(reading!.usedTokens).toBe(36901)
    expect(reading!.limitTokens).toBe(128000)
    expect(reading!.usedPct).toBe(29) // round(28.83%)
    expect(reading!.modelId).toBe('GitHub Copilot')
  })

  test('prefers the log whose session cwd matches the workspace', () => {
    const mine = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    writeSession(other, join(root, 'elsewhere'))
    writeSession(mine, ws)
    // Newer log belongs to another workspace; older one is ours.
    writeLog('process-2-new.log', other,
      '[INFO] CompactionProcessor: Utilization 90.0% (115200/128000 tokens) above threshold 80%')
    writeLog('process-1-old.log', mine,
      '[INFO] CompactionProcessor: Utilization 12.0% (15360/128000 tokens) below threshold 80%')

    const reading = readCopilotContext(ws, copilotRoot)
    expect(reading!.usedTokens).toBe(15360) // our session, not the 90% one
  })

  test('returns null when no log has a Utilization line', () => {
    const sid = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    writeSession(sid, ws)
    writeFileSync(join(copilotRoot, 'logs', 'process-3.log'), `[INFO] Registering foreground session: ${sid}\n[INFO] Starting up\n`)
    expect(readCopilotContext(ws, copilotRoot)).toBeNull()
  })
})
