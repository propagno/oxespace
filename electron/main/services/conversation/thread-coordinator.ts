import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadRequest } from '../../../../shared/types/thread'
import { ThreadHistory } from './thread-history'

/**
 * The project's coordinator conversation (B1.4). The person chooses it; a project has at most one, kept in
 * `thread_project_coordinators` (one row per project). It is offered the orchestration tools, the project's
 * memory and a read-only summary of the requests waiting in the project's conversations. It never answers one:
 * approvals stay with the person.
 */

type Database = Pick<AppDatabase, 'prepare' | 'transaction'>

/** Roles that a domain action can be kept for (see DomainAction.role). */
export type ThreadActionRole = 'coordinator'

export function isThreadCoordinator(db: Pick<AppDatabase, 'prepare'>, threadId: string): boolean {
  try { return Boolean(db.prepare('SELECT 1 FROM thread_project_coordinators WHERE thread_id = ?').get(threadId)) } catch { return false }
}

/** The roles a conversation has for role-kept actions; none when the table cannot be read. */
export function threadActionRoles(db: Pick<AppDatabase, 'prepare'>, threadId: string): Set<ThreadActionRole> {
  return new Set(isThreadCoordinator(db, threadId) ? ['coordinator'] : [])
}

/** Ids of every project's coordinator conversation. */
export function coordinatorIds(db: Pick<AppDatabase, 'prepare'>): Set<string> {
  return new Set((db.prepare('SELECT thread_id FROM thread_project_coordinators').all() as { thread_id: string }[]).map(row => row.thread_id))
}

/** The thread with `coordinator` as the table says, whatever its stored data carries (an imported package, say). */
export function withCoordinator<T extends ConversationThread>(thread: T, ids: ReadonlySet<string>): T {
  const { coordinator: _stored, ...rest } = thread
  return (ids.has(thread.id) ? { ...rest, coordinator: true } : rest) as T
}

/**
 * Makes a conversation its project's coordinator, unmarking the previous one, or stops it being one. Returns the
 * conversations whose flag changed, for change notices.
 */
export function setThreadCoordinator(db: Database, threadId: string, coordinator: boolean, now = Date.now()): string[] {
  return db.transaction(() => {
    const row = db.prepare('SELECT thread_project_id AS projectId, json_extract(data_json, \'$.archived\') AS archived FROM conversation_threads WHERE id = ?')
      .get(threadId) as { projectId: string; archived: number | null } | undefined
    if (!row) throw Error('Thread not found')
    if (!coordinator) return db.prepare('DELETE FROM thread_project_coordinators WHERE thread_id = ?').run(threadId).changes ? [threadId] : []
    if (row.archived) throw Error('An archived conversation cannot coordinate its project')
    const previous = (db.prepare('SELECT thread_id FROM thread_project_coordinators WHERE project_id = ?').get(row.projectId) as { thread_id: string } | undefined)?.thread_id
    if (previous === threadId) return []
    // A conversation moved to another project leaves its old project's row first; thread_id is unique.
    db.prepare('DELETE FROM thread_project_coordinators WHERE thread_id = ?').run(threadId)
    db.prepare(`INSERT INTO thread_project_coordinators (project_id, thread_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at`).run(row.projectId, threadId, now)
    return previous ? [previous, threadId] : [threadId]
  })()
}

/**
 * Tools a running session was started with and lost since (the coordinator's, when the conversation stopped
 * being it mid-session). The bridge cannot take a tool back from a session, so the server refuses the call
 * itself until the conversation's next session starts with the right list. Kept in this process, like the
 * sessions themselves.
 */
const revoked = new Map<string, Set<string>>()

export function revokeThreadTools(threadId: string, tools: Iterable<string>): void {
  const set = new Set([...(revoked.get(threadId) ?? []), ...tools])
  if (set.size) revoked.set(threadId, set)
}

/** Called when the conversation's next session starts: it is launched with its current tool list. */
export function clearRevokedThreadTools(threadId: string): void { revoked.delete(threadId) }

export function isRevokedThreadTool(threadId: string, tool: string): boolean { return revoked.get(threadId)?.has(tool) ?? false }

/** One request waiting in the project, as the coordinator sees it: nothing to act on, only who waits and since when. */
export interface CoordinatorPendingRequest {
  threadId: string
  threadTitle: string
  kind: ThreadRequest['kind']
  title: string
  ageSeconds: number
}

const CONTROL = /[\u0000-\u001f\u007f]+/g
const line = (value: unknown, max: number): string => typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
const KINDS: readonly ThreadRequest['kind'][] = ['approval', 'question', 'permissions', 'elicitation', 'tool']

/**
 * The pending requests of the coordinator's project: the activity center's own read (`pendingRequestsAll`,
 * which already leaves archived conversations out), narrowed to the project. Only the title, the kind, the
 * conversation and the age are returned: no command, argument, path, request id or generation, so nothing
 * here can answer a request. Empty when the conversation is not its project's coordinator.
 */
export function coordinatorPendingRequests(db: AppDatabase, coordinatorThreadId: string, limit = 30, now = Date.now()) {
  const project = (db.prepare('SELECT project_id FROM thread_project_coordinators WHERE thread_id = ?').get(coordinatorThreadId) as { project_id: string } | undefined)?.project_id
  const requests = project ? new ThreadHistory(db).pendingRequestsAll(201, { projectId: project }) : []
  const items: CoordinatorPendingRequest[] = requests.map(request => ({
    threadId: request.threadId, threadTitle: line(request.threadTitle, 120),
    kind: KINDS.includes(request.kind) ? request.kind : 'approval', title: line(request.title, 160),
    ageSeconds: Math.max(0, Math.round((now - (Number.isFinite(request.createdAt) ? request.createdAt : now)) / 1000))
  })).sort((a, b) => b.ageSeconds - a.ageSeconds)
  return { items: items.slice(0, limit), total: items.length, ...(items.length > limit ? { truncated: true } : {}) }
}
