// @vitest-environment node
// Frozen acceptance test for OXE-449 (A2): Direct ACP /resume <uuid> for Antigravity via NativeSessionReader, command-router, and AntigravityConversationAdapter.
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../../electron/main/db/index'
import { AntigravityConversationAdapter } from '../../../electron/main/services/conversation/antigravity-conversation'
import type { ConversationTransport } from '../../../electron/main/services/conversation/codex-conversation'
import { runThreadCommand, type CommandHost } from '../../../electron/main/services/conversation/kernel/command-router'
import { NativeSessionReader } from '../../../electron/main/services/conversation/native-session-history'
import type { ConversationThread, ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

const SESS_WITH_TRANSCRIPT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SESS_LIVE_ONLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type RpcMsg = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }

function createSummaryDb(agyHome: string, rows: Array<{ id: string; title: string; uris: string[]; updatedAt: string }>): void {
  const db = new Database(join(agyHome, 'conversation_summaries.db'))
  db.exec(`CREATE TABLE conversation_summaries (
    conversation_id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    preview TEXT NOT NULL DEFAULT '',
    step_count INTEGER NOT NULL DEFAULT 0,
    last_modified_time DATETIME NOT NULL,
    workspace_uris TEXT NOT NULL DEFAULT '',
    parent_conversation_id TEXT NOT NULL DEFAULT '',
    nesting_depth INTEGER NOT NULL DEFAULT 0
  )`)
  const stmt = db.prepare('INSERT INTO conversation_summaries (conversation_id, title, preview, step_count, last_modified_time, workspace_uris) VALUES (?, ?, ?, 4, ?, ?)')
  for (const row of rows) stmt.run(row.id, row.title, row.title, row.updatedAt, JSON.stringify(row.uris))
  db.close()
}

function createCommandHarness(ws: string, agyHome: string) {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE conversation_threads (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    thread_project_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    events_json TEXT NOT NULL
  )`)

  const store = new Map<string, ThreadSnapshot>()
  const save = (snapshot: ThreadSnapshot): void => {
    store.set(snapshot.thread.id, { thread: { ...snapshot.thread }, events: [...snapshot.events] })
    sqlite.prepare(`INSERT OR REPLACE INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)`)
      .run(snapshot.thread.id, snapshot.thread.workspaceId, snapshot.thread.projectId, JSON.stringify(snapshot.thread), JSON.stringify(snapshot.events))
  }
  const create = (ctx: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId'>): ThreadSnapshot => {
    const now = Date.now()
    const snap: ThreadSnapshot = {
      thread: {
        ...ctx,
        id: randomUUID(),
        nativeSessionId: null,
        title: '',
        pinned: false,
        status: 'idle',
        createdAt: now,
        updatedAt: now
      },
      events: []
    }
    save(snap)
    return snap
  }
  const active = create({ workspaceId: 'ws-1', projectId: 'proj-1', rootPath: ws, provider: 'antigravity' })
  const reader = new NativeSessionReader(() => 'agy', { antigravityHome: agyHome } as ConstructorParameters<typeof NativeSessionReader>[1])
  const host: CommandHost = {
    db: sqlite as unknown as AppDatabase,
    history: {} as CommandHost['history'],
    exports: {} as CommandHost['exports'],
    checkpoints: {} as CommandHost['checkpoints'],
    nativeCli: { read: (thread, id, cursor) => reader.read(thread, id, cursor) },
    read: id => {
      const found = store.get(id)
      if (!found) throw Error(`Thread ${id} not found`)
      return { thread: { ...found.thread }, events: [...found.events] }
    },
    save,
    create,
    configure: async () => {},
    interrupt: async () => {},
    send: async () => {},
    connectAdapter: async () => { throw Error('not expected') },
    assertNativeSessionAvailable: () => {},
    adapterCapabilities: () => undefined,
    isBusy: () => false,
    isConfiguring: () => false,
    withConfiguring: async (_id, run) => run(),
    disposeAdapter: async () => {},
    deleteThread: async () => {}
  }

  return { sqlite, store, host, reader, activeId: active.thread.id }
}

function createAcpFixture(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const sent: RpcMsg[] = []
  let receive: (chunk: Uint8Array) => void = () => {}
  const transport: ConversationTransport = {
    write: line => {
      const msg = JSON.parse(line) as RpcMsg
      sent.push(msg)
      if (!msg.method || msg.id === undefined) return
      let reply: RpcMsg
      try {
        const fn = answers[msg.method] ?? (() => ({}))
        reply = { id: msg.id, result: fn(msg.params ?? {}) }
      } catch (error) {
        reply = { id: msg.id, error: { code: -32601, message: (error as Error).message } }
      }
      queueMicrotask(() => receive(Buffer.from(JSON.stringify(reply) + '\n')))
    },
    onData: listener => { receive = listener },
    onClose: () => {},
    close: vi.fn(async () => {})
  }
  const adapter = new AntigravityConversationAdapter(() => transport)
  return { adapter, sent }
}

let root = ''
let agyHome = ''
let ws = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-449-a2-'))
  agyHome = join(root, 'antigravity-cli')
  ws = join(root, 'workspace')
  mkdirSync(agyHome, { recursive: true })
  mkdirSync(ws, { recursive: true })
})

afterEach(() => {
  removeTempDir(root)
})

describe('OXE-449 A2 · Antigravity direct ACP /resume <uuid>', () => {
  it('reads verified Antigravity transcript public messages only, strips private fields, and succeeds cleanly when no transcript exists', async () => {
    createSummaryDb(agyHome, [
      { id: SESS_WITH_TRANSCRIPT, title: 'OXE-449 Resume Flow', uris: [pathToFileURL(ws).href], updatedAt: '2026-11-26 18:00:00+00:00' },
      { id: SESS_LIVE_ONLY, title: 'Live ACP Session', uris: [pathToFileURL(ws).href], updatedAt: '2026-11-26 18:10:00+00:00' }
    ])

    const logsDir = join(agyHome, 'brain', SESS_WITH_TRANSCRIPT, '.system_generated', 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(
      join(logsDir, 'transcript.jsonl'),
      [
        { step_index: 1, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', created_at: '2026-11-26T17:50:00.000Z', content: 'PRIVATE_SYSTEM_PROMPT_SECRET' },
        { step_index: 2, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T17:51:00.000Z', content: 'Continue implementing OXE-449' },
        {
          step_index: 3,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          created_at: '2026-11-26T17:52:00.000Z',
          model: 'gemini-4-carbon-medium',
          thinking: 'PRIVATE_CHAIN_OF_THOUGHT',
          tool_calls: [{ name: 'read_file', args: { Path: 'PRIVATE_TOOL_ARG' } }],
          content: 'Sure, let us inspect UsageService.'
        },
        { step_index: 4, source: 'MODEL', type: 'GENERIC', created_at: '2026-11-26T17:53:00.000Z', content: 'PRIVATE_TOOL_OUTPUT_DUMP' },
        { step_index: 5, source: 'USER_EXPLICIT', type: 'USER_INPUT', created_at: '2026-11-26T17:54:00.000Z', content: 'Great, run the tests now' },
        { step_index: 6, source: 'MODEL', type: 'PLANNER_RESPONSE', created_at: '2026-11-26T17:55:00.000Z', content: 'All tests are passing.' }
      ].map(line => JSON.stringify(line)).join('\n') + '\n',
      'utf8'
    )

    // Session with brain/<uuid> folder but no local transcript yet (state lives in ACP server)
    mkdirSync(join(agyHome, 'brain', SESS_LIVE_ONLY), { recursive: true })

    const reader = new NativeSessionReader(() => 'agy', { antigravityHome: agyHome } as ConstructorParameters<typeof NativeSessionReader>[1])
    const thread = { provider: 'antigravity', rootPath: ws } as ConversationThread

    const withTranscript = await reader.read(thread, SESS_WITH_TRANSCRIPT)
    expect(withTranscript.title).toBe('OXE-449 Resume Flow')
    expect(withTranscript.events).toEqual([
      { type: 'message', id: 'native:step-2', role: 'user', text: 'Continue implementing OXE-449' },
      { type: 'message', id: 'native:step-3', role: 'assistant', text: 'Sure, let us inspect UsageService.' },
      { type: 'message', id: 'native:step-5', role: 'user', text: 'Great, run the tests now' },
      { type: 'message', id: 'native:step-6', role: 'assistant', text: 'All tests are passing.' }
    ])
    const serialized = JSON.stringify(withTranscript)
    expect(serialized).not.toContain('PRIVATE_SYSTEM_PROMPT_SECRET')
    expect(serialized).not.toContain('PRIVATE_CHAIN_OF_THOUGHT')
    expect(serialized).not.toContain('PRIVATE_TOOL_ARG')
    expect(serialized).not.toContain('PRIVATE_TOOL_OUTPUT_DUMP')

    const liveOnly = await reader.read(thread, SESS_LIVE_ONLY)
    expect(liveOnly).toEqual({ events: [], title: 'Live ACP Session' })
  })

  it('links /resume <uuid> via command-router without duplicating archived threads, then resumes via ACP session/resume and session/load fallback', async () => {
    createSummaryDb(agyHome, [
      { id: SESS_WITH_TRANSCRIPT, title: 'OXE-449 Resume Flow', uris: [pathToFileURL(ws).href], updatedAt: '2026-11-26 18:00:00+00:00' }
    ])
    mkdirSync(join(agyHome, 'brain', SESS_WITH_TRANSCRIPT), { recursive: true })

    const harness = createCommandHarness(ws, agyHome)
    try {
      const first = await runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_WITH_TRANSCRIPT}`)
      expect(first.kind).toBe('navigate')
      expect(first.threadId).toBeTruthy()
      const linked = harness.host.read(first.threadId!)
      expect(linked.thread.nativeSessionId).toBe(SESS_WITH_TRANSCRIPT)
      expect(linked.thread.title).toBe('OXE-449 Resume Flow')
      expect(harness.store.size).toBe(2)

      // Archive the linked thread and invoke /resume <uuid> again (uppercase): must unarchive and navigate without duplicating.
      linked.thread.archived = true
      harness.host.save(linked)
      const second = await runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_WITH_TRANSCRIPT.toUpperCase()}`)
      expect(second).toEqual({ kind: 'navigate', threadId: linked.thread.id })
      expect(harness.host.read(linked.thread.id).thread.archived).toBe(false)
      expect(harness.store.size).toBe(2)

      // Verify AntigravityConversationAdapter resumes the linked nativeSessionId via ACP session/resume
      const sessionMeta = {
        models: { currentModelId: 'gemini-4-carbon-medium', availableModels: [] },
        modes: { currentModeId: 'default', availableModes: [{ id: 'default' }] }
      }
      const resumeAcp = createAcpFixture({
        initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'Antigravity ACP', version: '1.5.6' } }),
        'session/resume': () => sessionMeta
      })
      const resumeEvents: ThreadEvent[] = []
      await resumeAcp.adapter.start({ rootPath: ws, nativeSessionId: linked.thread.nativeSessionId, access: 'workspace-write' }, e => resumeEvents.push(e))
      expect(resumeAcp.sent.filter(m => m.method === 'session/resume')[0].params).toMatchObject({ sessionId: SESS_WITH_TRANSCRIPT, cwd: ws })
      expect(resumeAcp.sent.filter(m => m.method === 'session/new')).toEqual([])
      expect(resumeEvents.find(e => e.type === 'session')).toEqual({ type: 'session', nativeSessionId: SESS_WITH_TRANSCRIPT })
      await resumeAcp.adapter.dispose()

      // Verify fallback to ACP session/load on older ACP server
      const loadAcp = createAcpFixture({
        initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'Antigravity ACP', version: '1.5.0' } }),
        'session/resume': () => { throw Error('Method not found') },
        'session/load': () => ({ sessionId: SESS_WITH_TRANSCRIPT, ...sessionMeta })
      })
      await loadAcp.adapter.start({ rootPath: ws, nativeSessionId: linked.thread.nativeSessionId, access: 'workspace-write' }, () => {})
      expect(loadAcp.sent.filter(m => m.method === 'session/load')[0].params).toMatchObject({ sessionId: SESS_WITH_TRANSCRIPT, cwd: ws })
      await loadAcp.adapter.dispose()
    } finally {
      harness.sqlite.close()
    }
  })
})
