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
  // A database that ran the draft 089 has no project_coordinators table (ARCHITECT L4): nothing to remove there.
  try { return Boolean(db.prepare('SELECT 1 FROM project_coordinators WHERE thread_id = ?').get(threadId)) } catch { return false }
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

/**
 * Checked on each call (SECURITY L-2): an orchestration or coordinator tool the conversation's plan would not offer
 * now, given its roles and its project's modes, is refused, whatever its session was started with. It does not
 * depend on the in-memory revocation, so a demotion whose notice failed still cannot keep a tool the project turns off.
 */
export async function isToolOffForConversation(db: AppDatabase, threadId: string, tool: string): Promise<boolean> {
  const [{ MCP_TOOL_GROUPS, threadToolRoles }, { projectToolModes, sessionToolPlan }, { loadRepoConfig }] = await Promise.all([
    import('./thread-mcp'), import('./tool-groups'), import('../repo-config/loader')])
  if (!(MCP_TOOL_GROUPS.orchestration as readonly string[]).includes(tool) && !(MCP_TOOL_GROUPS.coordinator as readonly string[]).includes(tool)) return false
  const row = db.prepare("SELECT json_extract(data_json, '$.rootPath') AS root FROM conversation_threads WHERE id = ?").get(threadId) as { root: unknown } | undefined
  if (!row || typeof row.root !== 'string') return false
  // With tool search, every group that is not off is offered: the widest plan the conversation can have.
  const plan = sessionToolPlan(true, threadToolRoles(db, threadId), projectToolModes((await loadRepoConfig(row.root).catch(() => null))?.thread))
  return !plan.tools.includes(tool) && !Object.values(plan.enableable).some(tools => tools?.includes(tool))
}

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
/** What each kind asks of the person, in the agent-facing words of the summary. */
const ASKS: Record<ThreadRequest['kind'], string> = { approval: 'Approve', question: 'Answer a question', permissions: 'Grant permissions', elicitation: 'Answer a server', tool: 'Run a tool' }
/** A tool name as agents and MCP servers spell them; anything else (a sentence, a path) is left out. */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/

/**
 * The request's title as the summary shows it (SECURITY L-1): built from its kind and tool name only. The request's
 * own title is the agent CLI's prompt sentence, which can name a file or a command ("Claude wants to read <path>").
 */
function requestTitle(kind: ThreadRequest['kind'], toolName: unknown): string {
  return typeof toolName === 'string' && TOOL_NAME.test(toolName) ? `${ASKS[kind]}: ${toolName}` : ASKS[kind]
}

/**
 * The pending requests of the coordinator's project: the activity center's own read (`pendingRequestsAll`,
 * which already leaves archived conversations out), narrowed to the coordinator conversation's own thread
 * project. Not to every thread project of the identity: that would trust the stored `thread_projects.identity`,
 * which older databases filled with raw paths, and two thread projects for one repository are rare legacy.
 * Only the kind, a title built from the kind and the tool name, the conversation and the age are returned: never the
 * request's own title (the CLI's prompt sentence, which can name a path or a command), command, argument, path,
 * request id or generation, so nothing here can answer a request or leak what it is about. Empty when the
 * conversation does not coordinate.
 */
export function coordinatorPendingRequests(db: AppDatabase, coordinatorThreadId: string, limit = 30, now = Date.now()) {
  const project = isThreadCoordinator(db, coordinatorThreadId)
    ? (db.prepare('SELECT thread_project_id AS projectId FROM conversation_threads WHERE id = ?').get(coordinatorThreadId) as { projectId: string } | undefined)?.projectId
    : undefined
  const requests = project ? new ThreadHistory(db).pendingRequestsAll(201, { projectId: project }) : []
  const items: CoordinatorPendingRequest[] = requests.map(request => ({
    threadId: request.threadId, threadTitle: line(request.threadTitle, 120),
    kind: KINDS.includes(request.kind) ? request.kind : 'approval', title: requestTitle(KINDS.includes(request.kind) ? request.kind : 'approval', request.toolName),
    ageSeconds: Math.max(0, Math.round((now - (Number.isFinite(request.createdAt) ? request.createdAt : now)) / 1000))
  })).sort((a, b) => b.ageSeconds - a.ageSeconds)
  return { items: items.slice(0, limit), total: items.length, ...(items.length > limit ? { truncated: true } : {}) }
}
