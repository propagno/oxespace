// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../electron/main/db/index'
import { runThreadCommand, type CommandHost } from '../../electron/main/services/conversation/kernel/command-router'
import { NativeSessionReader } from '../../electron/main/services/conversation/native-session-history'
import { SessionService } from '../../electron/main/services/session.service'
import { UsageService } from '../../electron/main/services/usage.service'
import {
  listAntigravitySessions,
  listAntigravitySessionsSync,
  parseAntigravityTimestamp,
  parseWorkspaceUris,
  sameAntigravityRoot,
  verifyAndReadAntigravitySession
} from '../../electron/main/services/usage/antigravity-sessions'
import { AntigravityUsageProvider } from '../../electron/main/services/usage/antigravityProvider'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const ID_1 = '10000000-0000-4000-8000-000000000001'
const ID_2 = '10000000-0000-4000-8000-000000000002'
const ID_FOREIGN = '10000000-0000-4000-8000-000000000003'
const ID_LINK = '10000000-0000-4000-8000-000000000004'

let root = ''
let agyHome = ''
let ws = ''
let otherWs = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-449-int-'))
  agyHome = join(root, 'antigravity-cli')
  ws = join(root, 'repo-main')
  otherWs = join(root, 'repo-other')
  mkdirSync(join(agyHome, 'brain'), { recursive: true })
  mkdirSync(ws, { recursive: true })
  mkdirSync(otherWs, { recursive: true })
})

afterEach(() => {
  removeTempDir(root)
})

function makeHost(workspaceRoot: string, home: string) {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE conversation_threads (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, thread_project_id TEXT NOT NULL, data_json TEXT NOT NULL, events_json TEXT NOT NULL
  )`)
  const store = new Map<string, ThreadSnapshot>()
  const save = (snap: ThreadSnapshot) => {
    store.set(snap.thread.id, { thread: { ...snap.thread }, events: [...snap.events] })
    sqlite.prepare('INSERT OR REPLACE INTO conversation_threads VALUES (?, ?, ?, ?, ?)')
      .run(snap.thread.id, snap.thread.workspaceId, snap.thread.projectId, JSON.stringify(snap.thread), JSON.stringify(snap.events))
  }
  const create = (ctx: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId'>): ThreadSnapshot => {
    const now = Date.now()
    const snap: ThreadSnapshot = {
      thread: { ...ctx, id: randomUUID(), nativeSessionId: null, title: '', pinned: false, status: 'idle', createdAt: now, updatedAt: now },
      events: []
    }
    save(snap)
    return snap
  }
  const active = create({ workspaceId: 'ws-int', projectId: 'proj-int', rootPath: workspaceRoot, provider: 'antigravity' })
  const reader = new NativeSessionReader(() => 'agy', { antigravityHome: home })
  const host: CommandHost = {
    db: sqlite as unknown as AppDatabase,
    history: {} as CommandHost['history'],
    exports: {} as CommandHost['exports'],
    checkpoints: {} as CommandHost['checkpoints'],
    nativeCli: { read: (thread, id, cursor) => reader.read(thread, id, cursor) },
    read: id => store.get(id)!,
    save,
    create,
    configure: async () => {},
    interrupt: async () => {},
    send: async () => {},
    connectAdapter: async () => { throw Error('unexpected') },
    assertNativeSessionAvailable: () => {},
    adapterCapabilities: () => undefined,
    isBusy: () => false,
    isConfiguring: () => false,
    withConfiguring: async (_id, run) => run(),
    disposeAdapter: async () => {},
    deleteThread: async () => {}
  }
  return { sqlite, store, host, activeId: active.thread.id }
}

describe('OXE-449 integration · Antigravity native session discovery and /resume', () => {
  it('parses workspace URIs, Go/ISO timestamps, and root equality deterministically', () => {
    const uri = pathToFileURL(ws).href
    expect(parseWorkspaceUris(JSON.stringify([uri]))).toHaveLength(1)
    expect(sameAntigravityRoot(parseWorkspaceUris(JSON.stringify([uri]))[0], ws)).toBe(true)
    expect(sameAntigravityRoot(`${ws}/`, ws)).toBe(true)
    expect(sameAntigravityRoot(otherWs, ws)).toBe(false)

    expect(parseAntigravityTimestamp('0001-01-01 00:00:00+00:00')).toBeNull()
    expect(parseAntigravityTimestamp('2026-11-27 03:32:04.1269664+00:00')).toBe(Date.parse('2026-11-27T03:32:04.126Z'))
    expect(parseAntigravityTimestamp('2026-11-27T03:32:04.126Z')).toBe(Date.parse('2026-11-27T03:32:04.126Z'))
    expect(parseAntigravityTimestamp(1700000000000)).toBe(1700000000000)
    expect(parseAntigravityTimestamp('invalid')).toBeNull()
  })

  it('matches sync and async discovery, reads transcript-header workspace fallback, and keeps forkSession Claude-only', async () => {
    const dir1 = join(agyHome, 'brain', ID_1, '.system_generated', 'logs')
    const dir2 = join(agyHome, 'brain', ID_2, '.system_generated', 'logs')
    mkdirSync(dir1, { recursive: true })
    mkdirSync(dir2, { recursive: true })

    writeFileSync(join(dir1, 'transcript.jsonl'), [
      JSON.stringify({ type: 'session_meta', cwd: ws, created_at: '2026-11-26T10:00:00.000Z' }),
      JSON.stringify({ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T10:00:05.000Z', content: '<USER_REQUEST>Add Antigravity discovery</USER_REQUEST>' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T10:05:00.000Z', model: 'gemini-4-carbon-medium', content: 'Implemented.' })
    ].join('\n') + '\n', 'utf8')

    writeFileSync(join(agyHome, 'brain', ID_2, 'metadata.json'), JSON.stringify({
      workspace: ws,
      title: 'Metadata-backed session',
      model: 'gemini-4-argon-low',
      startedAt: '2026-11-26T08:00:00.000Z',
      updatedAt: '2026-11-26T08:30:00.000Z'
    }), 'utf8')

    const syncList = listAntigravitySessionsSync(ws, agyHome)
    const asyncList = await listAntigravitySessions(ws, { antigravityHome: agyHome })
    expect(syncList.map(item => item.sessionId)).toEqual([ID_1, ID_2])
    expect(asyncList.map(item => item.sessionId)).toEqual([ID_1, ID_2])
    expect(asyncList[0].firstMessagePreview).toBe('Add Antigravity discovery')
    expect(asyncList[1].firstMessagePreview).toBe('Metadata-backed session')

    const db = { prepare: () => ({ all: () => [] }) } as unknown as AppDatabase
    const sessionService = new SessionService(db, new UsageService([new AntigravityUsageProvider(agyHome)]))
    const summaries = await sessionService.listSessions('ws-int', ws, 'antigravity')
    expect(summaries.map(s => s.sessionId)).toEqual([ID_1, ID_2])
    expect(() => sessionService.forkSession({
      workspaceId: 'ws-int',
      workspaceRootPath: ws,
      provider: 'antigravity',
      parentSessionId: ID_1,
      messageCount: 1
    })).toThrow(/Only Claude/i)
  })

  it('rejects cross-provider duplicate linking, traversal, symlinks, and foreign workspace while allowing valid /resume <uuid>', async () => {
    const dir1 = join(agyHome, 'brain', ID_1, '.system_generated', 'logs')
    const dirForeign = join(agyHome, 'brain', ID_FOREIGN)
    const outside = join(root, 'escaped')
    mkdirSync(dir1, { recursive: true })
    mkdirSync(dirForeign, { recursive: true })
    mkdirSync(outside, { recursive: true })

    writeFileSync(join(agyHome, 'brain', ID_1, 'metadata.json'), JSON.stringify({ workspace: ws }))
    writeFileSync(join(dir1, 'transcript.jsonl'), [
      JSON.stringify({ step_index: 1, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Review changes' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', thinking: 'secret thought', content: 'Reviewed.' })
    ].join('\n') + '\n', 'utf8')
    writeFileSync(join(dirForeign, 'metadata.json'), JSON.stringify({ workspace: otherWs }))
    writeFileSync(join(outside, 'metadata.json'), JSON.stringify({ workspace: ws }))
    symlinkSync(outside, join(agyHome, 'brain', ID_LINK), process.platform === 'win32' ? 'junction' : 'dir')

    const verified = await verifyAndReadAntigravitySession(ws, ID_1, { antigravityHome: agyHome })
    expect(verified.title).toBe('Review changes')
    expect(verified.events).toHaveLength(2)
    expect(JSON.stringify(verified)).not.toContain('secret thought')

    const harness = makeHost(ws, agyHome)
    try {
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${ID_FOREIGN}`)).rejects.toThrow(/different project/i)
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${ID_LINK}`)).rejects.toThrow(/symlink|escapes/i)
      await expect(runThreadCommand(harness.host, harness.activeId, '/resume ..\\..\\etc')).rejects.toThrow(/UUID/i)

      const linked = await runThreadCommand(harness.host, harness.activeId, `/resume ${ID_1}`)
      expect(linked.kind).toBe('navigate')
      expect(harness.host.read(linked.threadId!).thread.nativeSessionId).toBe(ID_1)
    } finally {
      harness.sqlite.close()
    }
  })
})
