/**
 * OXE-170 (OXC-5): sessions and their parallel chats, in the main process.
 *
 * A session is identified by its main chat's id. Every conversation without `parentThreadId` is a main chat, so a
 * conversation stored by an older build is a session with only its main chat, read as stored (no migration). A parallel
 * chat is a conversation of its own whose `parentThreadId` names its session's main chat and whose `childOrder` keeps the
 * order of creation. The main chat records the open chat in `openChatId`. Reading a session never writes a row.
 */
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadEvent, ThreadProvider, ThreadSnapshot } from '../../../../shared/types/thread'
import type { SessionChanges, SessionChatView, SessionView } from '../../../../shared/types/thread-session'
import { MainRefusal } from '../main-refusal'
import type { ThreadHistoryWriteOptions } from './thread-history'
import { parseThreadRow } from './thread-title'

const PROVIDERS: readonly ThreadProvider[] = ['claude', 'codex', 'antigravity']

/** What creating a parallel chat passes to the orchestrator's create. */
export type SessionChatContext = Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId' | 'access' | 'parentThreadId' | 'childOrder'>

export interface SessionHost {
  readonly db: AppDatabase
  /** The snapshot the orchestrator holds in memory, newer than the row while a turn runs. */
  cached(id: string): ThreadSnapshot | undefined
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options: ThreadHistoryWriteOptions): void
  create(context: SessionChatContext): ThreadSnapshot
}

interface ThreadRow { id: string; data_json: string; events_json: string; history_version: number }
const SELECT_ROWS = 'SELECT id, data_json, events_json, history_version FROM conversation_threads'

const threadOf = (host: SessionHost, row: ThreadRow): ConversationThread => host.cached(row.id)?.thread ?? parseThreadRow<ConversationThread>(row.data_json)

function eventsOf(host: SessionHost, row: ThreadRow): ThreadEvent[] {
  const cached = host.cached(row.id)
  if (cached) return cached.events
  if (!row.history_version) return JSON.parse(row.events_json) as ThreadEvent[]
  return (host.db.prepare("SELECT data_json FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'tool' ORDER BY seq").all(row.id) as { data_json: string }[])
    .map(value => JSON.parse(value.data_json) as ThreadEvent)
}

/** Additions and deletions of the completed file changes the chat's tool events carry (CA-6). */
function changesOf(host: SessionHost, row: ThreadRow): SessionChanges {
  const total = { additions: 0, deletions: 0 }
  for (const event of eventsOf(host, row)) {
    if (event.type !== 'tool') continue
    for (const file of event.files ?? []) {
      if (file.state !== 'completed') continue
      total.additions += file.additions ?? 0
      total.deletions += file.deletions ?? 0
    }
  }
  return total
}

/** The parallel chats of a session, in the order they were created (childOrder, stable within one millisecond). */
function chatsOf(host: SessionHost, sessionId: string): { row: ThreadRow; thread: ConversationThread }[] {
  return (host.db.prepare(`${SELECT_ROWS} WHERE json_extract(data_json, '$.parentThreadId') = ?`).all(sessionId) as ThreadRow[])
    .map(row => ({ row, thread: threadOf(host, row) }))
    .sort((a, b) => (a.thread.childOrder ?? 0) - (b.thread.childOrder ?? 0) || a.thread.createdAt - b.thread.createdAt || a.thread.id.localeCompare(b.thread.id))
}

function chatView(host: SessionHost, row: ThreadRow, thread: ConversationThread, main: boolean): SessionChatView {
  return { id: thread.id, provider: thread.provider, main, title: thread.title, status: thread.status, archived: Boolean(thread.archived), changes: changesOf(host, row) }
}

function viewOf(host: SessionHost, row: ThreadRow): SessionView {
  const main = threadOf(host, row)
  const chats = [chatView(host, row, main, true), ...chatsOf(host, main.id).map(chat => chatView(host, chat.row, chat.thread, false))]
  const openChatId = main.openChatId && chats.some(chat => chat.id === main.openChatId) ? main.openChatId : main.id
  const changes = chats.reduce((sum, chat) => ({ additions: sum.additions + chat.changes.additions, deletions: sum.deletions + chat.changes.deletions }), { additions: 0, deletions: 0 })
  return { id: main.id, workspaceId: main.workspaceId, projectId: main.projectId, rootPath: main.rootPath, title: main.title, chats, openChatId, archived: Boolean(main.archived), changes }
}

/** The main chat's row; refuses an unknown id and a parallel chat's id (chats do not nest). */
function sessionRow(host: SessionHost, sessionId: unknown): ThreadRow {
  if (typeof sessionId !== 'string' || !sessionId) throw new MainRefusal('thread.invalidInput', {})
  const row = host.db.prepare(`${SELECT_ROWS} WHERE id = ?`).get(sessionId) as ThreadRow | undefined
  if (!row) throw new MainRefusal('thread.notFound', {})
  if (threadOf(host, row).parentThreadId) throw new MainRefusal('thread.invalidInput', {})
  return row
}

export function readSession(host: SessionHost, sessionId: string): SessionView { return viewOf(host, sessionRow(host, sessionId)) }

/** Every session once, archived ones too; a parallel chat is never listed as a session. */
export function listSessions(host: SessionHost): SessionView[] {
  return (host.db.prepare(`${SELECT_ROWS} WHERE json_extract(data_json, '$.parentThreadId') IS NULL`).all() as ThreadRow[]).map(row => viewOf(host, row))
}

/** The ids of a session's parallel chats, in order; none for a parallel chat or an unknown id. */
export function sessionChatIds(host: SessionHost, sessionId: string): string[] { return chatsOf(host, sessionId).map(chat => chat.thread.id) }

/**
 * A parallel chat in the session's folder or worktree (CA-1, CA-2): same root, project and workspace, any provider,
 * empty and idle, no native session, never the owner of the session's worktree. It starts no agent process.
 */
export function createChat(host: SessionHost, sessionId: string, input: { provider: ThreadProvider }): ThreadSnapshot {
  const main = threadOf(host, sessionRow(host, sessionId))
  if (!input || !PROVIDERS.includes(input.provider)) throw new MainRefusal('thread.invalidInput', {})
  if (main.archived) throw new MainRefusal('thread.invalidInput', {})
  const order = chatsOf(host, main.id).reduce((max, chat) => Math.max(max, chat.thread.childOrder ?? 0), 0) + 1
  return host.create({ workspaceId: main.workspaceId, projectId: main.projectId, rootPath: main.rootPath, provider: input.provider,
    ...(main.access ? { access: main.access } : {}), ...(main.agentProfileId && input.provider === main.provider ? { agentProfileId: main.agentProfileId } : {}),
    parentThreadId: main.id, childOrder: order })
}

/** Records which chat the window shows; refuses a chat of another session or one that no longer exists. */
export function openChat(host: SessionHost, sessionId: string, chatId: string): SessionView {
  const view = readSession(host, sessionId)
  if (typeof chatId !== 'string' || !view.chats.some(chat => chat.id === chatId)) throw new MainRefusal('thread.notFound', {})
  const snapshot = host.read(view.id)
  if ((snapshot.thread.openChatId ?? view.id) !== chatId) {
    if (chatId === view.id) delete snapshot.thread.openChatId
    else snapshot.thread.openChatId = chatId
    host.save(snapshot, { eventsFrom: snapshot.events.length })
  }
  return readSession(host, view.id)
}
