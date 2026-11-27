// Frozen acceptance test for OXE-449 (A3): Security boundaries (UUID, traversal, symlink, foreign/unverified workspace) and EN/pt-BR UI copy.
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../../electron/main/db/index'
import { runThreadCommand, type CommandHost } from '../../../electron/main/services/conversation/kernel/command-router'
import { NativeSessionReader } from '../../../electron/main/services/conversation/native-session-history'
import type { SessionSummary } from '../../../shared/types/session'
import type { ConversationThread, ThreadSnapshot } from '../../../shared/types/thread'
import ThreadCommandDialog from '../../../src/components/Threads/ThreadCommandDialog'
import { changeLanguage } from '../../../src/i18n'
import { removeTempDir } from '../../helpers/removeTempDir'

const SESS_FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SESS_UNVERIFIED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SESS_MISSING = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SESS_SYMLINK = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SESS_UI_UNTITLED = '12121212-1212-4121-8121-121212121212'
const SESS_UI_NAMED = '34343434-3434-4343-8343-343434343434'

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
      thread: { ...ctx, id: randomUUID(), nativeSessionId: null, title: '', pinned: false, status: 'idle', createdAt: now, updatedAt: now },
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
    read: id => store.get(id)!,
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
  return { sqlite, store, host, reader, activeId: active.thread.id, activeThread: active.thread }
}

let root = ''
let agyHome = ''
let ws = ''
let wsOther = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oxe-449-a3-'))
  agyHome = join(root, 'antigravity-cli')
  ws = join(root, 'project-a')
  wsOther = join(root, 'project-b')
  mkdirSync(join(agyHome, 'brain'), { recursive: true })
  mkdirSync(ws, { recursive: true })
  mkdirSync(wsOther, { recursive: true })
})

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
  removeTempDir(root)
})

describe('OXE-449 A3 · Security rejections and EN/pt-BR UI copy', () => {
  it('rejects invalid UUIDs, path traversal, symlinks escaping brainRoot, missing sessions, unverified workspaces, and foreign workspaces without creating threads', async () => {
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
    db.prepare('INSERT INTO conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris) VALUES (?, ?, ?, ?, ?)')
      .run(SESS_FOREIGN, 'Other project work', 'Other project work', '2026-11-26 12:00:00+00:00', JSON.stringify([pathToFileURL(wsOther).href]))
    db.prepare('INSERT INTO conversation_summaries (conversation_id, title, preview, last_modified_time, workspace_uris) VALUES (?, ?, ?, ?, ?)')
      .run(SESS_SYMLINK, 'Escaping symlink', 'Escaping symlink', '2026-11-26 12:00:00+00:00', JSON.stringify([pathToFileURL(ws).href]))
    db.close()

    mkdirSync(join(agyHome, 'brain', SESS_FOREIGN), { recursive: true })
    mkdirSync(join(agyHome, 'brain', SESS_UNVERIFIED), { recursive: true })
    const outsideTarget = join(root, 'outside-secret-dir')
    mkdirSync(outsideTarget, { recursive: true })
    writeFileSync(join(outsideTarget, 'metadata.json'), JSON.stringify({ workspace: ws }))
    symlinkSync(outsideTarget, join(agyHome, 'brain', SESS_SYMLINK), process.platform === 'win32' ? 'junction' : 'dir')

    const harness = createCommandHarness(ws, agyHome)
    try {
      await expect(runThreadCommand(harness.host, harness.activeId, '/resume ../secret')).rejects.toThrow(/UUID/i)
      await expect(runThreadCommand(harness.host, harness.activeId, '/resume not-a-uuid')).rejects.toThrow(/UUID/i)
      await expect(harness.reader.read(harness.activeThread, '../secret')).rejects.toThrow(/identifier/i)
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_MISSING}`)).rejects.toThrow(/not found/i)
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_FOREIGN}`)).rejects.toThrow(/different project/i)
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_UNVERIFIED}`)).rejects.toThrow(/could not be verified/i)
      await expect(runThreadCommand(harness.host, harness.activeId, `/resume ${SESS_SYMLINK}`)).rejects.toThrow(/symlink|escapes|outside|not found/i)
      expect(harness.store.size).toBe(1)
    } finally {
      harness.sqlite.close()
    }
  })

  it('renders Antigravity heading, Antigravity fallback session label, and EN/pt-BR exactHint including Claude, Codex, and Antigravity', async () => {
    const thread = { id: 't-agy', title: 'Current', provider: 'antigravity', rootPath: ws, workspaceId: 'ws-1' } as unknown as ConversationThread
    const snapshot = { thread, events: [] } as unknown as ThreadSnapshot
    const nativeSessions: SessionSummary[] = [
      {
        sessionId: SESS_UI_NAMED,
        provider: 'antigravity',
        modelId: 'gemini-4-carbon-medium',
        requestCount: 3,
        lastUpdatedMs: Date.parse('2026-11-26T18:00:00.000Z'),
        sessionStartedAtMs: Date.parse('2026-11-26T17:30:00.000Z'),
        totalTokens: 0,
        estimatedCostUsd: 0,
        filePath: null,
        isFork: false,
        parentSessionId: null,
        label: null,
        firstMessagePreview: 'Inspect ACP resume flow',
        workspaceRootPath: ws
      },
      {
        sessionId: SESS_UI_UNTITLED,
        provider: 'antigravity',
        modelId: null,
        requestCount: 0,
        lastUpdatedMs: Date.parse('2026-11-26T17:00:00.000Z'),
        sessionStartedAtMs: Date.parse('2026-11-26T16:50:00.000Z'),
        totalTokens: 0,
        estimatedCostUsd: 0,
        filePath: null,
        isFork: false,
        parentSessionId: null,
        label: null,
        firstMessagePreview: null,
        workspaceRootPath: ws
      }
    ]
    const panel = {
      kind: 'panel' as const,
      surface: 'sessions' as const,
      title: 'resume',
      resume: { tasks: [], notice: '', nativeSessions, nativeNotice: '' }
    }

    window.oxe = { thread: {}, session: {} } as unknown as typeof window.oxe

    // EN check
    await changeLanguage('en')
    const view = render(createElement(ThreadCommandDialog, {
      panel,
      snapshot,
      pending: false,
      error: '',
      onClose: vi.fn(),
      onError: vi.fn(),
      action: vi.fn(async (run: () => Promise<unknown>) => { await run() }),
      runCommand: vi.fn(async () => {})
    }))

    expect(screen.getByText(/Antigravity sessions in this directory/i)).toBeInTheDocument()
    expect(screen.getByText('Inspect ACP resume flow')).toBeInTheDocument()
    expect(screen.getByText('Antigravity session')).toBeInTheDocument()
    expect(screen.queryByText('Claude session')).toBeNull()
    expect(screen.getByText(/Use a Claude, Codex or Antigravity session ID from this directory/i)).toBeInTheDocument()

    view.unmount()

    // pt-BR check
    await changeLanguage('pt-BR')
    render(createElement(ThreadCommandDialog, {
      panel,
      snapshot,
      pending: false,
      error: '',
      onClose: vi.fn(),
      onError: vi.fn(),
      action: vi.fn(async (run: () => Promise<unknown>) => { await run() }),
      runCommand: vi.fn(async () => {})
    }))

    expect(screen.getByText(/Sessões do Antigravity neste diretório/i)).toBeInTheDocument()
    expect(screen.getByText('Sessão do Antigravity')).toBeInTheDocument()
    expect(screen.queryByText('Sessão do Claude')).toBeNull()
    expect(screen.getByText(/Use o ID de uma sessão do Claude, do Codex ou do Antigravity deste diretório/i)).toBeInTheDocument()
  })
})
