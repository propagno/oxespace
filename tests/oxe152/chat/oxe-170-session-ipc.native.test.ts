// @vitest-environment node
// Frozen acceptance test for 1.5.2 OxeChat F3 "backend now" (OXE program oxespace-152-chat, phase F3, Jira OXE-170, OXC-5).
// Written by the planner; the executor must not edit it. Card: OXE-170 (OXC-5 parallel chats) CA-1, CA-2, CA-6, RN-1, RT-2,
// RT-5, and the brand's answer of 15/11 on persistence. The session model itself is frozen in oxe-170-session-chats.test.ts;
// this file freezes what the window reaches of it.
// Today (main 48a2c4a06) no IPC channel, preload call or MCP capability names a session or a parallel chat.
//
// Contract (the window's side):
// - Four invoke channels in the thread group: IPC_CHANNELS.thread.sessions () → every session; thread.session (sessionId) →
//   one session; thread.createChat (sessionId, { provider }) → the new chat's ThreadSnapshot; thread.openChat (sessionId,
//   chatId) → the session with that chat open. The session view is the one oxe-170-session-chats.test.ts describes (id =
//   the main chat's id; chats main first, then the parallel chats in creation order; openChatId; archived; changes).
// - The preload exposes them on window.oxe.thread as sessions(), session(id), createChat(sessionId, input) and
//   openChat(sessionId, chatId), each one invoke on its channel with the arguments as given.
// - thread.createChat validates in main: the session id is a string, the input an object whose provider is claude, codex or
//   antigravity; anything else is refused before the store is touched. A parallel chat the person creates starts with the
//   access chosen in Settings › Agents (like any conversation the person creates, user decision 12/11).
// - Only the app window reaches the four channels (the central sender guard), and no MCP tool does: the capability that
//   claims them in shared/mcp-coverage.ts has no tools (the person's window, like the conversation list).
// - RT-5 / OXC-3 RN-1: creating a session's parallel chats never touches the person's checkout: HEAD, the branch, the
//   working tree status, the branch list and the worktree list of the repository are the same before and after.
// - Brand answer 15/11 (persistence): after a restart (the database closed and opened again, the IPC registered anew) a
//   session keeps its chats, their order and the chat that was open; that case is on its own so a later CR amends only it.
// How it is read: the real registerThreadIpc over a real database file in a temp folder, a fake ipcMain and a temp git
// repository. No provider process starts: nothing here sends a message. No user data, no live account.
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { removeTempDir } from '../../helpers/removeTempDir'

type Handler = (event: unknown, ...args: unknown[]) => unknown

class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, handler: Handler): void {
    if (this.handlers.has(channel)) throw new Error(`Duplicate handler for '${channel}'`)
    this.handlers.set(channel, handler)
  }
  handleOnce(channel: string, handler: Handler): void {
    this.handle(channel, (event, ...args) => { this.removeHandler(channel); return handler(event, ...args) })
  }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
  async invoke(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for '${channel}'`)
    return await handler(event, ...args)
  }
}

const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as FakeIpcMain }))
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.5.2', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))

hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain

const { openDatabase } = await import('../../../electron/main/db/index')
const { installIpcSenderGuard, trustAppWindow, IPC_SENDER_REFUSED } = await import('../../../electron/main/ipc/ipc-sender-guard')
const { registerThreadIpc } = await import('../../../electron/main/ipc/thread.ipc')
const { createOxeApi } = await import('../../../electron/preload/api')
const { MCP_COVERAGE } = await import('../../../shared/mcp-coverage')
const { IPC_CHANNELS } = await import('../../../shared/types/ipc')

function webContents(type = 'window') {
  return Object.assign(new EventEmitter(), { mainFrame: { name: 'main' }, getType: () => type, isDestroyed: () => false, setWindowOpenHandler: vi.fn() })
}
const appWindow = webContents()
trustAppWindow({ webContents: appWindow as never })
const stranger = webContents('webview')
const fromApp = { sender: appWindow, senderFrame: appWindow.mainFrame }
const fromStranger = { sender: stranger, senderFrame: stranger.mainFrame }

const cleanups: (() => unknown)[] = []
afterEach(async () => {
  try { for (const step of cleanups.splice(0).reverse()) { try { await step() } catch { /* temp */ } } } finally { ipc.handlers.clear(); ipc.removeAllListeners() }
})

type Snapshot = { thread: { id: string; rootPath: string; provider: string; access?: string; ownedWorktree?: unknown } }
type Session = { id: string; rootPath: string; chats: { id: string; provider: string; main: boolean }[]; openChatId: string; archived: boolean; changes: { additions: number; deletions: number } }

const thread = IPC_CHANNELS.thread as unknown as Record<string, string>
const call = (name: string, ...args: unknown[]): Promise<unknown> => ipc.invoke(thread[name] ?? `missing thread.${name} channel`, fromApp, ...args)

function temp(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  cleanups.push(() => removeTempDir(dir))
  return dir
}

/** The app's main process over a database file: start it, or start it again after a restart. */
function boot(databasePath: string) {
  const db = openDatabase(databasePath)
  const runtime = registerThreadIpc(db, { bridge: join(databasePath, '..', 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
  let closed = false
  const shutdown = async (): Promise<void> => {
    if (closed) return
    closed = true
    await runtime.stop()
    db.close()
    ipc.handlers.clear(); ipc.removeAllListeners()
  }
  cleanups.push(shutdown)
  return { db, runtime, shutdown }
}

async function app(project?: string) {
  installIpcSenderGuard(ipc, null)
  const home = temp('oxe-170-ipc-')
  const dir = project ?? join(home, 'project')
  mkdirSync(dir, { recursive: true })
  const databasePath = join(home, 'oxespace.sqlite3')
  const main = boot(databasePath)
  const added = await ipc.invoke(IPC_CHANNELS.thread.addProject, fromApp, dir) as { projectId: string }
  const create = async (provider = 'codex'): Promise<Snapshot> => await ipc.invoke(IPC_CHANNELS.thread.create, fromApp, { projectId: added.projectId, provider }) as Snapshot
  return { dir, databasePath, main, project: added, create }
}

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

describe('OXE-170 sessions over IPC (A9)', () => {
  test('the window reads a session, creates parallel chats with any installed agent and opens one (CA-1, CA-2)', async () => {
    const { create } = await app()
    const main = await create('codex')
    const claude = await call('createChat', main.thread.id, { provider: 'claude' }) as Snapshot
    const codex = await call('createChat', main.thread.id, { provider: 'codex' }) as Snapshot
    expect(claude.thread.provider).toBe('claude')
    expect([claude.thread.rootPath, codex.thread.rootPath]).toEqual([main.thread.rootPath, main.thread.rootPath])
    const session = await call('session', main.thread.id) as Session
    expect(session.chats.map(chat => [chat.id, chat.provider, chat.main])).toEqual([[main.thread.id, 'codex', true], [claude.thread.id, 'claude', false], [codex.thread.id, 'codex', false]])
    expect(session.openChatId).toBe(main.thread.id)
    expect(session.rootPath).toBe(main.thread.rootPath)
    expect((await call('openChat', main.thread.id, codex.thread.id) as Session).openChatId).toBe(codex.thread.id)
    const sessions = await call('sessions') as Session[]
    expect(sessions.map(item => item.id)).toEqual([main.thread.id])
    expect(sessions[0].openChatId).toBe(codex.thread.id)
  })

  test('a parallel chat the person creates starts with the access chosen in Settings', async () => {
    const { create } = await app()
    const main = await create('claude')
    expect((await call('createChat', main.thread.id, { provider: 'codex' }) as Snapshot).thread.access).toBe('full-access')
    await ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromApp, 'read-only')
    expect((await call('createChat', main.thread.id, { provider: 'claude' }) as Snapshot).thread.access).toBe('read-only')
  })

  test('createChat refuses what is not a session id and an agent that does not exist, and stores nothing', async () => {
    const { create, main: process } = await app()
    const main = await create('codex')
    const count = (): unknown => process.db.prepare('SELECT COUNT(*) AS n FROM conversation_threads').get()
    const before = count()
    for (const [id, input] of [[main.thread.id, { provider: 'gpt' }], [main.thread.id, null], [main.thread.id, 'claude'], [main.thread.id, {}], [42, { provider: 'codex' }], ['', { provider: 'codex' }]] as const) {
      await expect(call('createChat', id, input), `${String(id)} ${JSON.stringify(input)}`).rejects.toThrow()
    }
    expect(count()).toEqual(before)
    await expect(call('openChat', main.thread.id, 'not-a-chat')).rejects.toThrow()
    await expect(call('session', 'not-a-session')).rejects.toThrow()
    // The same call with a valid input stores exactly one chat: the refusals above came from validation, not from a missing channel.
    await call('createChat', main.thread.id, { provider: 'antigravity' })
    expect(count()).toEqual({ n: (before as { n: number }).n + 1 })
  })

  test('only the app window reaches the session channels', async () => {
    const { create } = await app()
    const main = await create('codex')
    for (const [name, args] of [['sessions', []], ['session', [main.thread.id]], ['createChat', [main.thread.id, { provider: 'codex' }]], ['openChat', [main.thread.id, main.thread.id]]] as const) {
      await expect(ipc.invoke(thread[name] ?? `missing thread.${name} channel`, fromStranger, ...args), name).rejects.toMatchObject({ code: IPC_SENDER_REFUSED })
    }
  })

  test('creating parallel chats never touches the person\'s checkout: HEAD, branch, status, branches and worktrees stay (RT-5)', async () => {
    const parent = temp('oxe-170-repo-')
    const repo = join(parent, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'e@x'); git(repo, 'config', 'user.name', 'E'); git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'a.txt'), 'a\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init')
    git(repo, 'checkout', '-qb', 'feature/person')
    writeFileSync(join(repo, 'a.txt'), 'edited by the person\n'); writeFileSync(join(repo, 'new.txt'), 'untracked\n')
    const state = (): string[] => [git(repo, 'rev-parse', 'HEAD'), git(repo, 'symbolic-ref', 'HEAD'), git(repo, 'status', '--porcelain'), git(repo, 'branch', '--list'), git(repo, 'worktree', 'list', '--porcelain')]
    const before = state()
    const { create } = await app(repo)
    const main = await create('claude')
    const chats = [await call('createChat', main.thread.id, { provider: 'codex' }) as Snapshot, await call('createChat', main.thread.id, { provider: 'claude' }) as Snapshot]
    await call('openChat', main.thread.id, chats[1].thread.id)
    expect(state()).toEqual(before)
    expect(chats.map(chat => chat.thread.rootPath)).toEqual([main.thread.rootPath, main.thread.rootPath])
    expect(chats.map(chat => chat.thread.ownedWorktree)).toEqual([undefined, undefined])
  })

  test('the preload exposes the four calls, each one invoke on its channel', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn() }).thread as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    for (const name of ['sessions', 'session', 'createChat', 'openChat']) expect(typeof api[name], name).toBe('function')
    await api.sessions()
    await api.session('s1')
    await api.createChat('s1', { provider: 'codex' })
    await api.openChat('s1', 'c1')
    expect(invoke.mock.calls).toEqual([[IPC_CHANNELS.thread.sessions], [IPC_CHANNELS.thread.session, 's1'], [IPC_CHANNELS.thread.createChat, 's1', { provider: 'codex' }], [IPC_CHANNELS.thread.openChat, 's1', 'c1']])
    expect(new Set([IPC_CHANNELS.thread.sessions, IPC_CHANNELS.thread.session, IPC_CHANNELS.thread.createChat, IPC_CHANNELS.thread.openChat].map(value => typeof value === 'string' && value.startsWith('thread:') ? value : 'not a thread channel')).size).toBe(4)
  })

  test('no MCP tool reaches a session: the capability that claims the four channels is the person\'s window', () => {
    const glob = (pattern: string): RegExp => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    for (const name of ['thread.sessions', 'thread.session', 'thread.createChat', 'thread.openChat']) {
      const owners = Object.entries(MCP_COVERAGE).filter(([, capability]) => ((capability as { ipc?: readonly string[] }).ipc ?? []).some(pattern => glob(pattern).test(name)))
      expect(owners.map(([id]) => id), name).toHaveLength(1)
      expect('tools' in owners[0][1], `${name} in ${owners[0][0]}`).toBe(false)
    }
  })
})

describe('OXE-170 sessions over IPC after a restart (A9, brand answer 15/11)', () => {
  // Brand answer 15/11 (OXC-5 persistence): parallel chats persist across restarts, with their order and the open chat;
  // existing sessions stay valid with only their main chat. A later CR amends only this describe.
  test('after the app restarts, a session keeps its chats, their order and the chat that was open', async () => {
    const { create, databasePath, main: first } = await app()
    const main = await create('codex')
    const chats: string[] = []
    for (const provider of ['claude', 'codex', 'claude']) chats.push((await call('createChat', main.thread.id, { provider }) as Snapshot).thread.id)
    await call('openChat', main.thread.id, chats[2])
    await first.shutdown()

    boot(databasePath)
    const session = await call('session', main.thread.id) as Session
    expect(session.chats.map(chat => [chat.id, chat.provider, chat.main])).toEqual([[main.thread.id, 'codex', true], [chats[0], 'claude', false], [chats[1], 'codex', false], [chats[2], 'claude', false]])
    expect(session.openChatId).toBe(chats[2])
    expect((await call('sessions') as Session[]).map(item => item.id)).toEqual([main.thread.id])
    expect((await ipc.invoke(IPC_CHANNELS.thread.read, fromApp, chats[1]) as Snapshot).thread.provider).toBe('codex')
  })

  test('after the app restarts, a conversation that never had a parallel chat is a session with only its main chat', async () => {
    const { create, databasePath, main: first } = await app()
    const lone = await create('claude')
    await first.shutdown()

    boot(databasePath)
    const session = await call('session', lone.thread.id) as Session
    expect(session.chats.map(chat => [chat.id, chat.main])).toEqual([[lone.thread.id, true]])
    expect(session.openChatId).toBe(lone.thread.id)
    expect(session.archived).toBe(false)
  })
})
