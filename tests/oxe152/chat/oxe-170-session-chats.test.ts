// @vitest-environment node
// Frozen acceptance test for 1.5.2 OxeChat F3 "backend now" (OXE program oxespace-152-chat, phase F3, Jira OXE-170, OXC-5).
// Written by the planner; the executor must not edit it. Card: OXE-170 (OXC-5 parallel chats), the brand target's shared
// model ("a session is one folder (or a worktree of it) plus one agent's main chat, and its parallel chats") and the
// brand's answer of 15/11 on persistence (parallel chats persist across restarts; existing sessions stay valid with only
// their main chat, with no migration).
// Today (main 48a2c4a06) a conversation is a single thread: nothing groups threads into a session, so every case that
// calls the session API below is red.
//
// Contract (the main-process model; ThreadManager is the boundary, the work may live in a new module behind it):
// - A session is identified by its main chat's id: every conversation that exists today, and every conversation created
//   the usual way (thread.create), is a session with only its main chat. A parallel chat is a conversation of its own
//   (its own id, transcript, state, native session and agent) that belongs to exactly one session.
// - manager.readSession(sessionId) and manager.listSessions() return the session view (SessionView below): `chats` holds
//   the main chat first (main: true, its id = the session id) and then the parallel chats in the order they were created,
//   stable even when they were created in the same millisecond; `openChatId` is the chat the window shows (the main chat
//   until another is opened); `changes` sums `+N` and `-N` of every chat of the session (OXE-170 CA-6), each chat's own
//   `changes` being the additions and deletions of the completed file changes its tool events carry. listSessions() lists
//   every session once (archived ones too, with archived: true) and never lists a parallel chat as a session.
// - manager.createChat(sessionId, { provider }) creates a parallel chat in the session's folder or worktree: the same
//   rootPath, projectId and workspaceId as the main chat, any provider (also another one than the main chat's, CA-2), an
//   empty transcript, status idle, no native session. It never owns the session's worktree (ownedWorktree stays on the main
//   chat), so ending a chat never removes the session's folder. Creating it starts no agent process: the chat connects on
//   its first message, like any new conversation. It refuses an unknown id, a parallel chat's id (chats do not nest) and an
//   archived session.
// - manager.openChat(sessionId, chatId) records which chat is open and returns the session; it refuses a chat of another
//   session or one that no longer exists.
// - Archiving the session (the main chat's /archive confirm) archives all its chats and stops any of them still working
//   (RN-3); deleting the session deletes all its chats. Archiving or deleting one parallel chat leaves the main chat as it
//   was; a deleted chat leaves the session, and when it was the open one, the main chat is open again.
// - Persistence across restarts and the conversations of older builds (A8) are frozen in oxe-170-session-restart.test.ts.
// How it is read: the real ThreadManager over an in-memory database with a fake provider adapter (no live provider, no user
// data, temp folders only); the session API is reached through the SessionApi view below, so the test needs no new import.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { threadsInWorktree } from '../../../electron/main/services/conversation/thread-worktree'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent, ThreadProvider, ThreadSnapshot } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

interface SessionChatView { id: string; provider: ThreadProvider; main: boolean; status: ConversationThread['status']; changes: { additions: number; deletions: number } }
interface SessionView { id: string; rootPath: string; chats: SessionChatView[]; openChatId: string; archived: boolean; changes: { additions: number; deletions: number } }
interface SessionApi {
  readSession(sessionId: string): SessionView
  listSessions(): SessionView[]
  createChat(sessionId: string, input: { provider: ThreadProvider }): ThreadSnapshot
  openChat(sessionId: string, chatId: string): SessionView
}
const api = (manager: ThreadManager): SessionApi => manager as unknown as SessionApi

const cleanups: (() => unknown)[] = []
afterEach(async () => { for (const step of cleanups.splice(0).reverse()) { try { await step() } catch { /* temp */ } } vi.restoreAllMocks() })

function folder(prefix = 'oxe-170-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  cleanups.push(() => removeTempDir(dir))
  return dir
}

function manager(db: AppDatabase) {
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    // Like a real provider, an interrupted turn ends: the adapter reports it as completed with status interrupted.
    let own: ((event: ThreadEvent) => void) | undefined
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { own = emit; callbacks.push(emit); emit({ type: 'session', nativeSessionId: `native-${callbacks.length}` }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => { own?.({ type: 'completed', status: 'interrupted' }) }), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
    adapters.push(adapter); return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const service = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  cleanups.push(() => service.stop())
  return { service, factory, adapters, callbacks }
}

function fixture(root = '/project-A') {
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const app = manager(db)
  const session = (provider: ThreadProvider = 'codex', extra: Partial<Pick<ConversationThread, 'ownedWorktree' | 'rootPath'>> = {}): string =>
    app.service.create({ workspaceId: 'A', projectId: 'project-A', rootPath: extra.rootPath ?? root, provider, ...(extra.ownedWorktree ? { ownedWorktree: extra.ownedWorktree } : {}) }).thread.id
  return { db, root, ...app, session }
}

/** A completed tool event that changed these files, with the line counts its evidence carries. */
const changed = (id: string, files: { path: string; additions: number; deletions: number }[]): ThreadEvent => ({
  type: 'tool', id, name: 'Edit', state: 'completed', detail: files.map(file => file.path).join(' '),
  files: files.map(file => ({ path: file.path, kind: 'update', source: 'native-patch', state: 'completed', additions: file.additions, deletions: file.deletions }))
})

describe('OXE-170 session chats (A7)', () => {
  it('a conversation created the usual way is a session with only its main chat, open', () => {
    const f = fixture()
    const id = f.session()
    const view = api(f.service).readSession(id)
    expect(view.id).toBe(id)
    expect(view.rootPath).toBe(f.root)
    expect(view.chats.map(chat => [chat.id, chat.main])).toEqual([[id, true]])
    expect(view.openChatId).toBe(id)
    expect(view.archived).toBe(false)
    expect(view.changes).toEqual({ additions: 0, deletions: 0 })
  })

  it('a parallel chat works in the session folder, with its own empty transcript, idle state and no native session (CA-1, RN-2)', () => {
    const f = fixture()
    const id = f.session('codex')
    const created = api(f.service).createChat(id, { provider: 'codex' })
    const chat = created.thread
    expect(chat.id).not.toBe(id)
    expect([chat.rootPath, chat.projectId, chat.workspaceId]).toEqual([f.root, 'project-A', 'A'])
    expect(chat.nativeSessionId).toBeNull()
    expect(chat.status).toBe('idle')
    expect(created.events).toEqual([])
    expect(f.service.read(chat.id).thread.id).toBe(chat.id)
    expect(api(f.service).readSession(id).chats.map(item => [item.id, item.main])).toEqual([[id, true], [chat.id, false]])
  })

  it('a parallel chat may use another agent than the main chat (CA-2)', () => {
    const f = fixture()
    const id = f.session('codex')
    const chat = api(f.service).createChat(id, { provider: 'claude' }).thread
    expect(chat.provider).toBe('claude')
    expect(f.service.read(id).thread.provider).toBe('codex')
    expect(api(f.service).readSession(id).chats.map(item => item.provider)).toEqual(['codex', 'claude'])
  })

  it('creating a parallel chat starts no agent process', () => {
    const f = fixture()
    const id = f.session()
    api(f.service).createChat(id, { provider: 'codex' })
    api(f.service).createChat(id, { provider: 'claude' })
    expect(f.factory).not.toHaveBeenCalled()
  })

  it('chats keep their order of creation, also when created in the same millisecond', () => {
    const f = fixture()
    const id = f.session()
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const ids = [api(f.service).createChat(id, { provider: 'claude' }), api(f.service).createChat(id, { provider: 'codex' }), api(f.service).createChat(id, { provider: 'claude' })].map(item => item.thread.id)
    vi.restoreAllMocks()
    expect(api(f.service).readSession(id).chats.map(chat => chat.id)).toEqual([id, ...ids])
  })

  it('transcripts and states stay independent: what one chat does never reaches the other (CA-1)', async () => {
    const f = fixture()
    const id = f.session('codex')
    await f.service.send(id, 'Main chat request')
    f.callbacks[0]({ type: 'message', id: 'main-answer', role: 'assistant', text: 'Main answer' })
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    expect(f.service.read(id).thread.status).toBe('running')
    expect(f.service.read(chat).thread.status).toBe('idle')
    expect(f.service.read(chat).events).toEqual([])
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(f.service.read(id).thread.status).toBe('idle'))
    const mainEvents = JSON.stringify(f.service.read(id).events)
    await f.service.send(chat, 'Parallel request')
    f.callbacks[1]({ type: 'message', id: 'chat-answer', role: 'assistant', text: 'Parallel answer' })
    expect(f.service.read(chat).thread.status).toBe('running')
    expect(f.service.read(id).thread.status).toBe('idle')
    expect(JSON.stringify(f.service.read(id).events)).toBe(mainEvents)
    expect(JSON.stringify(f.service.read(chat).events)).toContain('Parallel answer')
    expect(JSON.stringify(f.service.read(chat).events)).not.toContain('Main answer')
    expect(f.service.read(chat).thread.nativeSessionId).not.toBe(f.service.read(id).thread.nativeSessionId)
    f.callbacks[1]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(api(f.service).readSession(id).chats.map(item => item.status)).toEqual(['idle', 'idle']))
  })

  it('the session line sums +N and -N of all its chats; each chat keeps its own (CA-6)', async () => {
    const f = fixture()
    const id = f.session('codex')
    await f.service.send(id, 'Edit a')
    f.callbacks[0](changed('tool-main', [{ path: '/project-A/a.ts', additions: 3, deletions: 1 }]))
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    const quiet = api(f.service).createChat(id, { provider: 'claude' }).thread.id
    await vi.waitFor(() => expect(f.service.read(id).thread.status).toBe('idle'))
    await f.service.send(chat, 'Edit b and c')
    f.callbacks[1](changed('tool-chat', [{ path: '/project-A/b.ts', additions: 4, deletions: 2 }, { path: '/project-A/c.ts', additions: 1, deletions: 0 }]))
    f.callbacks[1]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(api(f.service).readSession(id).changes).toEqual({ additions: 8, deletions: 3 }))
    const view = api(f.service).readSession(id)
    expect(Object.fromEntries(view.chats.map(item => [item.id, item.changes]))).toEqual({
      [id]: { additions: 3, deletions: 1 }, [chat]: { additions: 5, deletions: 2 }, [quiet]: { additions: 0, deletions: 0 }
    })
    expect(api(f.service).listSessions().find(item => item.id === id)?.changes).toEqual({ additions: 8, deletions: 3 })
  })

  it('opening a chat is recorded; the main chat can be opened again; a chat of another session is refused', () => {
    const f = fixture()
    const id = f.session()
    const other = f.session()
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    const foreign = api(f.service).createChat(other, { provider: 'codex' }).thread.id
    expect(api(f.service).openChat(id, chat).openChatId).toBe(chat)
    expect(api(f.service).readSession(id).openChatId).toBe(chat)
    expect(api(f.service).readSession(other).openChatId).toBe(other)
    expect(() => api(f.service).openChat(id, foreign)).toThrow()
    expect(api(f.service).readSession(id).openChatId).toBe(chat)
    expect(api(f.service).openChat(id, id).openChatId).toBe(id)
  })

  it('a parallel chat belongs to one session: no chat under a chat, none in an unknown or archived session (RN-1)', async () => {
    const f = fixture()
    const id = f.session()
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    expect(() => api(f.service).createChat(chat, { provider: 'codex' })).toThrow()
    expect(() => api(f.service).createChat('00000000-0000-4000-8000-000000000000', { provider: 'codex' })).toThrow()
    await f.service.command(id, '/archive confirm')
    expect(() => api(f.service).createChat(id, { provider: 'codex' })).toThrow()
    expect(api(f.service).readSession(id).chats.map(item => item.id)).toEqual([id, chat])
  })

  it('the session list holds each session once, archived ones too, and never a parallel chat as a session', async () => {
    const f = fixture()
    const id = f.session()
    const archived = f.session()
    const chat = api(f.service).createChat(id, { provider: 'claude' }).thread.id
    await f.service.command(archived, '/archive confirm')
    const sessions = api(f.service).listSessions()
    expect(sessions.map(item => item.id).sort()).toEqual([id, archived].sort())
    expect(sessions.some(item => item.id === chat)).toBe(false)
    expect(sessions.find(item => item.id === archived)?.archived).toBe(true)
    expect(sessions.find(item => item.id === id)?.chats.map(item => item.id)).toEqual([id, chat])
  })

  it('archiving the session archives every chat of it; the session reads archived (CA-6, RN-3)', async () => {
    const f = fixture()
    const id = f.session()
    const chats = [api(f.service).createChat(id, { provider: 'codex' }), api(f.service).createChat(id, { provider: 'claude' })].map(item => item.thread.id)
    await f.service.command(id, '/archive confirm')
    expect(chats.map(chat => f.service.read(chat).thread.archived)).toEqual([true, true])
    expect(api(f.service).readSession(id).archived).toBe(true)
  })

  it('a chat still working stops when its session is archived', async () => {
    const f = fixture()
    const id = f.session()
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    await f.service.send(chat, 'Long task')
    expect(f.service.read(chat).thread.status).toBe('running')
    await f.service.command(id, '/archive confirm')
    expect(f.service.read(chat).thread.archived).toBe(true)
    expect(f.adapters[0].interrupt).toHaveBeenCalled()
    expect(f.adapters[0].dispose).toHaveBeenCalled()
    expect(f.service.read(chat).thread.status).not.toBe('running')
  })

  it('archiving one parallel chat leaves the main chat and the session as they were', async () => {
    const f = fixture()
    const id = f.session()
    const chat = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    await f.service.command(chat, '/archive confirm')
    expect(f.service.read(chat).thread.archived).toBe(true)
    expect(f.service.read(id).thread.archived).toBeFalsy()
    expect(api(f.service).readSession(id).archived).toBe(false)
  })

  it('deleting the session deletes all its chats', async () => {
    const f = fixture()
    const id = f.session()
    const chats = [api(f.service).createChat(id, { provider: 'codex' }), api(f.service).createChat(id, { provider: 'claude' })].map(item => item.thread.id)
    await f.service.command(id, '/delete confirm')
    for (const chat of chats) expect(() => f.service.read(chat)).toThrow()
    expect(api(f.service).listSessions().map(item => item.id)).not.toContain(id)
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM conversation_threads').get()).toEqual({ n: 0 })
  })

  it('a deleted chat leaves its session; when it was open, the main chat is open again', async () => {
    const f = fixture()
    const id = f.session()
    const keep = api(f.service).createChat(id, { provider: 'codex' }).thread.id
    const gone = api(f.service).createChat(id, { provider: 'claude' }).thread.id
    api(f.service).openChat(id, gone)
    await f.service.command(gone, '/delete confirm')
    const view = api(f.service).readSession(id)
    expect(view.chats.map(chat => chat.id)).toEqual([id, keep])
    expect(view.openChatId).toBe(id)
    expect(() => api(f.service).openChat(id, gone)).toThrow()
  })

  it('in a worktree session a chat works in the worktree but never owns it; archiving the session leaves no chat inside it', async () => {
    const worktree = folder('oxe-170-wt-')
    const f = fixture()
    const ownedWorktree = { path: worktree, branch: 'thread/20261115-0900-a1b2', projectRoot: f.root, baseSha: '0'.repeat(40), createdAt: 1 }
    const id = f.session('codex', { rootPath: worktree, ownedWorktree })
    const chat = api(f.service).createChat(id, { provider: 'claude' }).thread
    expect(chat.rootPath).toBe(worktree)
    expect(chat.ownedWorktree).toBeUndefined()
    expect(f.service.read(id).thread.ownedWorktree).toEqual(ownedWorktree)
    expect(threadsInWorktree(f.db, worktree).map(item => item.id).sort()).toEqual([id, chat.id].sort())
    await f.service.command(id, '/archive confirm')
    expect(threadsInWorktree(f.db, worktree)).toEqual([])
  })
})
