import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTempDir } from '../../helpers/removeTempDir'
import type { ConversationThread } from '../../../shared/types/thread'
import type { ThreadPaneSource } from '../../../shared/types/thread-places'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as object }))
class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, handler: Handler): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.5.2', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))
hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain as FakeIpcMain

const { openInMemoryDatabase } = await import('../../../electron/main/db/index')
const { registerThreadIpc } = await import('../../../electron/main/ipc/thread.ipc')
const { createOxeApi } = await import('../../../electron/preload/api')
const { activeWritersInFolder } = await import('../../../electron/main/services/conversation/thread-active-writers')

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
  ipc.handlers.clear()
})

function makeThread(id: string, title: string, overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id,
    workspaceId: 'thread:p1',
    projectId: 'p1',
    rootPath: '/repos/app',
    provider: 'claude',
    nativeSessionId: null,
    title,
    pinned: false,
    status: 'running',
    access: 'workspace-write',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('OXE-189 AG-07 active writers lookup (CA-5)', () => {
  it('active writers lookup matches normalized paths across threads and Code panes excluding read-only sessions', async () => {
    const base = mkdtempSync(join(tmpdir(), 'oxe-ag07-'))
    cleanups.push(() => removeTempDir(base))
    const repoDir = join(base, 'MyRepo')
    const worktreeDir = join(base, 'MyRepo-wt-fix')
    const otherDir = join(base, 'OtherRepo')
    mkdirSync(repoDir, { recursive: true })
    mkdirSync(worktreeDir, { recursive: true })
    mkdirSync(otherDir, { recursive: true })

    // Variant spellings of repoDir: trailing slash, opposite slashes, and different case on Windows.
    const queryRepo = process.platform === 'win32'
      ? `${repoDir.toLowerCase().replace(/\\/g, '/')}/`
      : `${repoDir}/`
    const mixedRepo = `${repoDir.replace(/\//g, '\\')}\\`

    const threads: ConversationThread[] = [
      makeThread('t-write', 'Refactor login', { rootPath: mixedRepo, status: 'running', access: 'full-access' }),
      makeThread('t-readonly', 'Audit code', { rootPath: repoDir, status: 'running', access: 'read-only' }),
      makeThread('t-idle', 'Finished task', { rootPath: repoDir, status: 'idle', access: 'full-access' }),
      makeThread('t-archived', 'Old task', { rootPath: repoDir, status: 'running', access: 'full-access', archived: true }),
      makeThread('t-worktree', 'Isolated fix', {
        rootPath: repoDir,
        ownedWorktree: { path: worktreeDir, branch: 'fix/auth', projectRoot: repoDir, baseSha: '0'.repeat(40), createdAt: 1 },
        status: 'running',
        access: 'workspace-write'
      }),
      makeThread('t-other', 'Other project', { rootPath: otherDir, status: 'running', access: 'full-access' })
    ]

    const panes: ThreadPaneSource[] = [
      { paneId: 'pane-active', title: 'Claude Code', workspaceId: 'ws1', launchDir: otherDir, agentCwd: mixedRepo, agent: true, working: true },
      { paneId: 'pane-idle', title: 'Idle Codex', workspaceId: 'ws1', launchDir: repoDir, agent: true, working: false },
      { paneId: 'pane-shell', title: 'PowerShell', workspaceId: 'ws1', launchDir: repoDir, agent: false, working: true },
      { paneId: 'pane-ro', title: 'Readonly Agent', workspaceId: 'ws1', launchDir: repoDir, agent: true, working: true, readOnly: true },
      { paneId: 'pane-wt', title: 'Worktree Agent', workspaceId: 'ws1', launchDir: `${worktreeDir}/`, agent: true, working: true }
    ]

    // Pure lookup on repoDir: matches write thread + working agent pane; excludes read-only, idle, archived, shell, and worktree-owned thread.
    expect(activeWritersInFolder(queryRepo, { threads, panes })).toEqual([
      { id: 't-write', title: 'Refactor login', kind: 'thread' },
      { id: 'pane-active', title: 'Claude Code', kind: 'pane' }
    ])

    // Pure lookup on ownedWorktree path: matches thread owning that worktree + pane working in it.
    const queryWorktree = process.platform === 'win32'
      ? `${worktreeDir.toUpperCase().replace(/\\/g, '/')}/`
      : `${worktreeDir}/`
    expect(activeWritersInFolder(queryWorktree, { threads, panes })).toEqual([
      { id: 't-worktree', title: 'Isolated fix', kind: 'thread' },
      { id: 'pane-wt', title: 'Worktree Agent', kind: 'pane' }
    ])

    // End-to-end IPC + preload + ThreadManager lookup on in-memory DB.
    const db = openInMemoryDatabase()
    cleanups.push(() => db.close())
    const runtime = registerThreadIpc(db, {
      bridge: join(base, 'bridge.cjs'),
      prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }),
      end: () => {}
    })
    cleanups.push(() => runtime.stop())
    const manager = await runtime.manager

    const writer = manager.create({ workspaceId: 'thread:p1', projectId: 'p1', rootPath: repoDir, provider: 'claude', access: 'full-access' })
    writer.thread.title = 'Live thread'
    writer.thread.status = 'running'
    ;(manager as unknown as { save(value: unknown, options: { eventsFrom: number }): void }).save(writer, { eventsFrom: 0 })

    const readonlyThread = manager.create({ workspaceId: 'thread:p1', projectId: 'p1', rootPath: repoDir, provider: 'codex', access: 'read-only' })
    readonlyThread.thread.title = 'Readonly thread'
    readonlyThread.thread.status = 'running'
    ;(manager as unknown as { save(value: unknown, options: { eventsFrom: number }): void }).save(readonlyThread, { eventsFrom: 0 })

    manager.configurePanes(() => [
      { paneId: 'code-1', title: 'Code Pane', workspaceId: 'ws1', launchDir: repoDir, agent: true, working: true },
      { paneId: 'code-idle', title: 'Idle Pane', workspaceId: 'ws1', launchDir: repoDir, agent: true, working: false }
    ])

    const api = createOxeApi({
      invoke: (channel, ...args) => ipc.handlers.get(channel)!({ sender: {}, senderFrame: {} }, ...args) as Promise<unknown>,
      on: () => {},
      removeListener: () => {}
    })

    expect(IPC_CHANNELS.thread.activeWriters).toBe('thread:active-writers')
    const found = await api.thread.activeWriters!(queryRepo)
    expect(found).toEqual([
      { id: writer.thread.id, title: 'Live thread', kind: 'thread' },
      { id: 'code-1', title: 'Code Pane', kind: 'pane' }
    ])
  })
})
