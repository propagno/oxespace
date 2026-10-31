import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadRequest } from '../../../../shared/types/thread'
import { ThreadHistory } from './thread-history'
import { EFFECTIVE_COORDINATORS, IS_EFFECTIVE_COORDINATOR } from './coordinator-authority'

/**
 * The project's coordinator conversation (B1.4 · S7.5): one concept with the Team's coordinator. A project identity
 * (a repository and its worktrees) has at most one, kept in `project_coordinators`; the person chooses it here or in
 * the Team, through ProjectCoordinatorService. It is offered the orchestration tools, the project's memory and a
 * read-only summary of the requests waiting in its project's conversations. It never answers one: approvals stay
 * with the person. Every reader below goes through the authority check in coordinator-authority.ts.
 */

/** Roles that a domain action can be kept for (see DomainAction.role). */
export type ThreadActionRole = 'coordinator'

export function isThreadCoordinator(db: Pick<AppDatabase, 'prepare'>, threadId: string): boolean {
  try { return Boolean(db.prepare(IS_EFFECTIVE_COORDINATOR).get(threadId)) } catch { return false }
}

/** The roles a conversation has for role-kept actions; none when the table cannot be read. */
export function threadActionRoles(db: Pick<AppDatabase, 'prepare'>, threadId: string): Set<ThreadActionRole> {
  return new Set(isThreadCoordinator(db, threadId) ? ['coordinator'] : [])
}

/** Ids of every project's coordinator conversation, as the authority check grants it. */
export function coordinatorIds(db: Pick<AppDatabase, 'prepare'>): Set<string> {
  try { return new Set((db.prepare(`SELECT pc.thread_id ${EFFECTIVE_COORDINATORS}`).all() as { thread_id: string }[]).map(row => row.thread_id)) } catch { return new Set() }
}

/** Whether a row names the conversation, granted or not (an archived one keeps it until /archive removes it). */
export function hasCoordinatorRow(db: Pick<AppDatabase, 'prepare'>, threadId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM project_coordinators WHERE thread_id = ?').get(threadId))
}

/** The thread with `coordinator` as the table says, whatever its stored data carries (an imported package, say). */
export function withCoordinator<T extends ConversationThread>(thread: T, ids: ReadonlySet<string>): T {
  const { coordinator: _stored, ...rest } = thread
  return (ids.has(thread.id) ? { ...rest, coordinator: true } : rest) as T
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
 * which already leaves archived conversations out), narrowed to the coordinator conversation's own thread
 * project. Not to every thread project of the identity: that would trust the stored `thread_projects.identity`,
 * which older databases filled with raw paths, and two thread projects for one repository are rare legacy.
 * Only the title, the kind, the conversation and the age are returned: no command, argument, path, request id
 * or generation, so nothing here can answer a request. Empty when the conversation does not coordinate.
 */
export function coordinatorPendingRequests(db: AppDatabase, coordinatorThreadId: string, limit = 30, now = Date.now()) {
  const project = isThreadCoordinator(db, coordinatorThreadId)
    ? (db.prepare('SELECT thread_project_id AS projectId FROM conversation_threads WHERE id = ?').get(coordinatorThreadId) as { projectId: string } | undefined)?.projectId
    : undefined
  const requests = project ? new ThreadHistory(db).pendingRequestsAll(201, { projectId: project }) : []
  const items: CoordinatorPendingRequest[] = requests.map(request => ({
    threadId: request.threadId, threadTitle: line(request.threadTitle, 120),
    kind: KINDS.includes(request.kind) ? request.kind : 'approval', title: line(request.title, 160),
    ageSeconds: Math.max(0, Math.round((now - (Number.isFinite(request.createdAt) ? request.createdAt : now)) / 1000))
  })).sort((a, b) => b.ageSeconds - a.ageSeconds)
  return { items: items.slice(0, limit), total: items.length, ...(items.length > limit ? { truncated: true } : {}) }
}
