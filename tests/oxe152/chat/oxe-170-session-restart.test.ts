// @vitest-environment node
// Frozen acceptance test for 1.5.2 OxeChat F3 "backend now" (OXE program oxespace-152-chat, phase F3, Jira OXE-170, OXC-5).
// Written by the planner; the executor must not edit it. Source: the brand's answer of 15/11 on OXC-5 persistence, given
// through the coordinator: parallel chats PERSIST across restarts; after a restart a session keeps its chats, their order
// and the chat that was open; existing sessions stay valid with only their main chat, with no migration (OXE-170 RT-2).
// The session model and its API (readSession, listSessions, createChat, openChat on ThreadManager) are described in the
// header of oxe-170-session-chats.test.ts (A7); this file only adds what a restart must keep.
// Today (main 48a2c4a06) no session API exists, so both cases are red.
//
// Contract (A8):
// - A new ThreadManager over the same database (an app restart) reads the same chats, in the same order (also when they
//   were created in the same millisecond), with the same providers and the same open chat; the list holds the session once.
// - A conversation stored by an older build (the 1.5.1 creation shape, no session data at all, archived or not) reads as a
//   session with only its main chat, open, with its archived flag; reading the session or the list writes nothing to its
//   row; a parallel chat can then be created in it. No migration: the stored rows are read as they are.
// How it is read: the real ThreadManager over an in-memory database with a fake provider adapter (no live provider, no user
// data). The brand answer may come back amended: a later CR changes only this file.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { threadCapabilityManifest } from '../../../electron/main/services/conversation/thread-capabilities'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent, ThreadProvider, ThreadSnapshot } from '../../../shared/types/thread'

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


describe('OXE-170 sessions after a restart (A8)', () => {
  // Brand answer 15/11 (OXC-5 persistence): parallel chats persist across restarts; existing sessions stay valid with only
  // their main chat, with no migration. A later CR amends only this describe.
  it('a session keeps its chats, their order and the chat that was open', async () => {
    const db = openInMemoryDatabase()
    cleanups.push(() => db.close())
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
    const before = manager(db)
    const id = before.service.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'codex' }).thread.id
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const chats = [api(before.service).createChat(id, { provider: 'claude' }), api(before.service).createChat(id, { provider: 'codex' }), api(before.service).createChat(id, { provider: 'claude' })].map(item => item.thread.id)
    vi.restoreAllMocks()
    api(before.service).openChat(id, chats[1])
    await before.service.stop()

    const after = manager(db)
    const view = api(after.service).readSession(id)
    expect(view.chats.map(chat => [chat.id, chat.provider, chat.main])).toEqual([[id, 'codex', true], [chats[0], 'claude', false], [chats[1], 'codex', false], [chats[2], 'claude', false]])
    expect(view.openChatId).toBe(chats[1])
    expect(api(after.service).listSessions().map(item => item.id)).toEqual([id])
    expect(after.service.read(chats[2]).thread.provider).toBe('claude')
  })

  it('a conversation stored by an older build reads as a session with only its main chat, and reading writes nothing', async () => {
    const db = openInMemoryDatabase()
    cleanups.push(() => db.close())
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
    const now = 1_790_000_000_000
    db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('project-A', '/project-A', '/project-A', 'project-A', now, now)
    db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('project-A', '/project-A')
    // The shape a 1.5.1 build writes at creation (orchestrator create on main 48a2c4a06), with no session data at all.
    const legacy = (id: string, archived: boolean) => ({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'codex', access: 'full-access',
      id, nativeSessionId: null, title: `Old ${id.slice(0, 4)}`, pinned: false, status: 'idle', createdAt: now, updatedAt: now, generation: 1, queue: [],
      capabilities: threadCapabilityManifest('codex'), connection: { state: 'closed', attempt: 0, changedAt: now }, ...(archived ? { archived: true } : {}) })
    const ids = ['1a1a1a1a-0000-4000-8000-000000000001', '2b2b2b2b-0000-4000-8000-000000000002']
    ids.forEach((id, index) => db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'A', 'project-A', JSON.stringify(legacy(id, index === 1)), '[]'))
    const stored = (): unknown[] => (db.prepare('SELECT id, data_json, events_json FROM conversation_threads ORDER BY id').all())

    const app = manager(db)
    const before = stored()
    const [open, archived] = ids.map(id => api(app.service).readSession(id))
    expect(open.chats.map(chat => [chat.id, chat.main])).toEqual([[ids[0], true]])
    expect(open.openChatId).toBe(ids[0])
    expect(open.archived).toBe(false)
    expect(archived.archived).toBe(true)
    expect(api(app.service).listSessions().map(item => item.id).sort()).toEqual([...ids].sort())
    expect(stored()).toEqual(before)
    expect(new ThreadHistory(db).read(ids[0]).thread.id).toBe(ids[0])

    const chat = api(app.service).createChat(ids[0], { provider: 'claude' }).thread.id
    expect(api(app.service).readSession(ids[0]).chats.map(item => item.id)).toEqual([ids[0], chat])
  })
})
