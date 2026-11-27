// @vitest-environment node
// Frozen acceptance test for OXE-449 (A1): Antigravity native session discovery and progressive onPartial streaming.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../../electron/main/db/index'
import { SessionService } from '../../../electron/main/services/session.service'
import { UsageService } from '../../../electron/main/services/usage.service'
import { AntigravityUsageProvider } from '../../../electron/main/services/usage/antigravityProvider'
import { removeTempDir } from '../../helpers/removeTempDir'

const SESS_NEWEST = '11111111-1111-4111-8111-111111111111'
const SESS_MIDDLE = '22222222-2222-4222-8222-222222222222'
const SESS_HISTORY = '33333333-3333-4333-8333-333333333333'
const SESS_FOREIGN = '44444444-4444-4444-8444-444444444444'
const SESS_SIBLING = '55555555-5555-4555-8555-555555555555'
const SESS_SUBAGENT = '66666666-6666-4666-8666-666666666666'
const SESS_DB_ORPHAN = '77777777-7777-4777-8777-777777777777'
const SESS_UNVERIFIED = '88888888-8888-4888-8888-888888888888'
const SESS_LARGE = '99999999-9999-4999-8999-999999999999'

interface SummaryRow {
  id: string
  title?: string
  preview?: string
  stepCount?: number
  lastModifiedTime: string
  workspaceUris: string[]
  parentId?: string
  nestingDepth?: number
}

function createSummaryDb(agyHome: string, rows: SummaryRow[]): void {
  const db = new Database(join(agyHome, 'conversation_summaries.db'))
  db.exec(`CREATE TABLE conversation_summaries (
    conversation_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    step_count INTEGER NOT NULL DEFAULT 0,
    last_modified_time DATETIME NOT NULL,
    workspace_uris TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'CASCADE_RUN_STATUS_IDLE',
    source TEXT NOT NULL DEFAULT '',
    parent_conversation_id TEXT NOT NULL DEFAULT '',
    nesting_depth INTEGER NOT NULL DEFAULT 0,
    last_user_input_time DATETIME NOT NULL DEFAULT '0001-01-01 00:00:00+00:00'
  )`)
  const insert = db.prepare(`INSERT INTO conversation_summaries
    (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, parent_conversation_id, nesting_depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const row of rows) {
    insert.run(
      row.id,
      row.title ?? '',
      row.preview ?? '',
      row.stepCount ?? 2,
      row.lastModifiedTime,
      JSON.stringify(row.workspaceUris),
      row.parentId ?? '',
      row.nestingDepth ?? 0
    )
  }
  db.close()
}

function writeBrainTranscript(agyHome: string, id: string, lines: object[], mtimeDate?: Date): void {
  const logsDir = join(agyHome, 'brain', id, '.system_generated', 'logs')
  mkdirSync(logsDir, { recursive: true })
  const file = join(logsDir, 'transcript.jsonl')
  writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8')
  if (mtimeDate) {
    utimesSync(file, mtimeDate, mtimeDate)
    utimesSync(join(agyHome, 'brain', id), mtimeDate, mtimeDate)
  }
}

function makeFakeDb(): AppDatabase {
  return { prepare: () => ({ all: () => [] }) } as unknown as AppDatabase
}

function variantWorkspaceUri(rootPath: string): string {
  const uri = pathToFileURL(rootPath).href
  if (process.platform === 'win32') {
    // Flip drive letter case and add trailing slash to test Windows case-insensitive sameRoot normalization.
    return uri.replace(/^file:\/\/\/([A-Za-z]):/, (_m, drive: string) =>
      `file:///${drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()}:`
    ) + '/'
  }
  return `${uri}/`
}

let root = ''
let agyHome = ''
let ws = ''
let wsSibling = ''
let wsOther = ''
const originalEnv = process.env.ANTIGRAVITY_HOME

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-449-a1-'))
  agyHome = join(root, 'antigravity-cli')
  ws = join(root, 'MyProject')
  wsSibling = join(root, 'MyProject-v2')
  wsOther = join(root, 'OtherRepo')
  mkdirSync(agyHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
  mkdirSync(wsSibling, { recursive: true })
  mkdirSync(wsOther, { recursive: true })
})

afterEach(() => {
  if (originalEnv === undefined) delete process.env.ANTIGRAVITY_HOME
  else process.env.ANTIGRAVITY_HOME = originalEnv
  removeTempDir(root)
})

describe('OXE-449 A1 · Antigravity native session discovery and progressive onPartial streaming', () => {
  it('lists only top-level sessions for workspaceRootPath newest-first, emits progressive onPartial, and excludes foreign/sibling/subagent/invalid folders', async () => {
    const wsUri = pathToFileURL(ws).href
    const wsVariantUri = variantWorkspaceUri(ws)
    createSummaryDb(agyHome, [
      {
        id: SESS_NEWEST,
        title: 'Refactor ACP resume flow',
        preview: 'Refactor ACP resume flow',
        lastModifiedTime: '2026-11-26 15:30:00.1234567+00:00',
        workspaceUris: [wsUri]
      },
      {
        id: SESS_MIDDLE,
        title: '',
        preview: '',
        lastModifiedTime: '2026-11-26 14:15:00.000000+00:00',
        workspaceUris: [wsVariantUri]
      },
      {
        id: SESS_FOREIGN,
        title: 'Foreign project session',
        lastModifiedTime: '2026-11-26 16:00:00.000000+00:00',
        workspaceUris: [pathToFileURL(wsOther).href]
      },
      {
        id: SESS_SIBLING,
        title: 'Sibling prefix project session',
        lastModifiedTime: '2026-11-26 16:05:00.000000+00:00',
        workspaceUris: [pathToFileURL(wsSibling).href]
      },
      {
        id: SESS_SUBAGENT,
        title: '',
        lastModifiedTime: '2026-11-26 16:10:00.000000+00:00',
        workspaceUris: [wsUri],
        parentId: SESS_NEWEST,
        nestingDepth: 1
      },
      {
        id: SESS_DB_ORPHAN,
        title: 'Deleted brain folder orphan',
        lastModifiedTime: '2026-11-26 16:20:00.000000+00:00',
        workspaceUris: [wsUri]
      }
    ])

    writeBrainTranscript(agyHome, SESS_NEWEST, [
      { step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T15:00:00.000Z', content: 'Refactor ACP resume flow' },
      { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T15:30:00.000Z', model: 'gemini-4-carbon-medium', content: 'Updated.' }
    ], new Date('2026-11-26T15:30:00.000Z'))

    writeBrainTranscript(agyHome, SESS_MIDDLE, [
      { step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: '2026-11-26T14:00:00.000Z', content: 'Internal boot notice' },
      { step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T14:01:00.000Z', content: 'Inspect native   session\nscanner' },
      { step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T14:15:00.000Z', model: 'gemini-4-argon-high', content: 'Checked.' }
    ], new Date('2026-11-26T14:15:00.000Z'))

    // Session indexed only via history.jsonl (not in SQLite DB)
    writeBrainTranscript(agyHome, SESS_HISTORY, [
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T12:00:00.000Z', model: 'claude-sonnet-5-5-medium', content: 'Fixed.' }
    ], new Date('2026-11-26T12:00:00.000Z'))
    writeFileSync(
      join(agyHome, 'history.jsonl'),
      JSON.stringify({ conversationId: SESS_HISTORY, workspace: ws, display: 'Fix terminal reconnect', timestamp: Date.parse('2026-11-26T11:55:00.000Z') }) + '\n',
      'utf8'
    )

    // Excluded directories that exist on disk
    writeBrainTranscript(agyHome, SESS_FOREIGN, [{ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T16:00:00.000Z', content: 'Foreign' }])
    writeBrainTranscript(agyHome, SESS_SIBLING, [{ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T16:05:00.000Z', content: 'Sibling' }])
    writeBrainTranscript(agyHome, SESS_SUBAGENT, [{ step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: '2026-11-26T16:10:00.000Z', content: 'Subagent task' }])
    writeBrainTranscript(agyHome, SESS_UNVERIFIED, [{ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T16:12:00.000Z', content: 'No workspace recorded' }])
    mkdirSync(join(agyHome, 'brain', 'not-a-valid-uuid'), { recursive: true })
    writeFileSync(join(agyHome, 'brain', 'not-a-valid-uuid', 'metadata.json'), JSON.stringify({ workspace: ws }))

    const provider = new (AntigravityUsageProvider as unknown as new (home?: string) => AntigravityUsageProvider)(agyHome)
    const service = new SessionService(makeFakeDb(), new UsageService([provider]))
    const partials: string[][] = []
    const sessions = await service.listSessions('ws-1', ws, 'antigravity', batch => {
      partials.push(batch.map(item => item.sessionId))
    })

    expect(sessions.map(item => item.sessionId)).toEqual([SESS_NEWEST, SESS_MIDDLE, SESS_HISTORY])
    expect(partials).toHaveLength(3)
    partials.forEach((partial, idx) => {
      expect(partial).toEqual(sessions.slice(0, idx + 1).map(item => item.sessionId))
    })

    expect(sessions[0]).toMatchObject({
      sessionId: SESS_NEWEST,
      provider: 'antigravity',
      modelId: 'gemini-4-carbon-medium',
      firstMessagePreview: 'Refactor ACP resume flow'
    })
    expect(sessions[0].sessionStartedAtMs).toBe(Date.parse('2026-11-26T15:00:00.000Z'))
    expect(sessions[0].lastUpdatedMs).toBeGreaterThanOrEqual(sessions[0].sessionStartedAtMs)

    expect(sessions[1]).toMatchObject({
      sessionId: SESS_MIDDLE,
      provider: 'antigravity',
      modelId: 'gemini-4-argon-high',
      firstMessagePreview: 'Inspect native session scanner'
    })

    expect(sessions[2]).toMatchObject({
      sessionId: SESS_HISTORY,
      provider: 'antigravity',
      modelId: 'claude-sonnet-5-5-medium',
      firstMessagePreview: 'Fix terminal reconnect'
    })
  })

  it('bounds huge transcripts without blocking the event loop, truncates long previews, and handles missing antigravityHome cleanly', async () => {
    const longPrompt = 'Investigate memory usage ' + 'details '.repeat(40)
    const logsDir = join(agyHome, 'brain', SESS_LARGE, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(
      join(agyHome, 'brain', SESS_LARGE, 'metadata.json'),
      JSON.stringify({ workspace: ws }),
      'utf8'
    )
    writeFileSync(
      join(logsDir, 'transcript.jsonl'),
      [
        JSON.stringify({ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T10:00:00.000Z', content: longPrompt }),
        JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', created_at: '2026-11-26T10:01:00.000Z', content: 'x'.repeat(2 * 1024 * 1024) }),
        JSON.stringify({ step_index: 3, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T10:02:00.000Z', model: 'gemini-4-carbon-high', content: 'Summary' })
      ].join('\n') + '\n',
      'utf8'
    )

    const provider = new (AntigravityUsageProvider as unknown as new (home?: string) => AntigravityUsageProvider)(agyHome)
    const service = new SessionService(makeFakeDb(), new UsageService([provider]))

    let eventLoopYielded = false
    const timer = setImmediate(() => { eventLoopYielded = true })
    const sessions = await service.listSessions('ws-1', ws, 'antigravity')
    clearImmediate(timer)

    expect(eventLoopYielded).toBe(true)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe(SESS_LARGE)
    expect(sessions[0].modelId).toBe('gemini-4-carbon-high')
    expect(sessions[0].firstMessagePreview).toBeTruthy()
    expect(sessions[0].firstMessagePreview!.length).toBeLessThanOrEqual(120)

    const missingProvider = new (AntigravityUsageProvider as unknown as new (home?: string) => AntigravityUsageProvider)(join(root, 'does-not-exist'))
    const empty = await new SessionService(makeFakeDb(), new UsageService([missingProvider])).listSessions('ws-1', ws, 'antigravity')
    expect(empty).toEqual([])
  })

  it('uses process.env.ANTIGRAVITY_HOME by default when no custom home is injected', async () => {
    writeFileSync(
      join(agyHome, 'history.jsonl'),
      JSON.stringify({ conversationId: SESS_NEWEST, workspace: ws, display: 'Env home session', timestamp: Date.parse('2026-11-26T09:00:00.000Z') }) + '\n',
      'utf8'
    )
    writeBrainTranscript(agyHome, SESS_NEWEST, [
      { step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T09:00:00.000Z', content: 'Env home session' }
    ])

    process.env.ANTIGRAVITY_HOME = agyHome
    const usage = new UsageService([new AntigravityUsageProvider()])
    const sessions = await usage.listSessionsForAsync('antigravity', ws)
    expect(sessions.map(item => item.sessionId)).toEqual([SESS_NEWEST])
  })
})
