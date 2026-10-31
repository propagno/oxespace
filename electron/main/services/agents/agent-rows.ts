/**
 * S7.1 · From the sources' facts to agent rows, purely: the shared mapping (`agentState`), the ownership rule
 * (`agentOwnership`), the first waiting request per agent, cost and seen. The read model keeps the facts and the
 * per-row bookkeeping (`since`, `rev`); this module only decides what each row says.
 */
import { agentKey, agentMode, agentOwnership, agentState, applyAgentOwnership, compareAgentRows, isSeenSince, parseAgentKey, type AgentKey, type AgentState } from '../../../../shared/agents/agentState'
import { mainMessage } from '../../../../shared/messages'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { ApprovalRequest } from '../../../../shared/types/approvals'
import type { DelegationTask } from '../../../../shared/types/delegation'
import { AGENT_REQUEST_TITLE_CODES, AGENTS_LIMITS, isAgentRequestTitle, type AgentOverviewRow, type AgentPendingRequest } from '../../../../shared/types/ipc/agents'
import type { ConversationThread, ThreadRequest } from '../../../../shared/types/thread'
import type { WorkRunStatus } from '../../../../shared/types/work'
import type { Workspace } from '../../../../shared/types/workspace'

/** `completedAt`: the latest turn's completion time, read at load so a restart keeps the time a turn finished. */
export interface ConversationFacts { thread: ConversationThread; requests: ThreadRequest[]; completedAt?: number }
export interface WorkFacts {
  run: { id: string; supervisorThreadId: string; workspaceId: string; title: string; status: WorkRunStatus; updatedAt: number }
  tasks: { status: string; threadId: string | null }[]
}

export interface AgentFacts {
  panes: ReadonlyMap<string, PaneAgentState>
  /** Panes whose agent left inside a Stop window: kept as Stopped while the pane exists (§3.2, one vocabulary). */
  stoppedPanes?: ReadonlySet<string>
  conversations: ReadonlyMap<string, ConversationFacts>
  delegations: ReadonlyMap<string, DelegationTask>
  work: ReadonlyMap<string, WorkFacts>
  approvals: readonly ApprovalRequest[]
  workspaces: readonly Workspace[]
  /** Agent profile id → provider, for delegation rows. */
  providerOf: (agentProfileId: string) => string | undefined
}

/** What the read model already knows about a row: when it entered its state, and its revision. */
export interface RowHistory { state: AgentState; since: number; rev: number; body: string }

/** A row before the read model stamps `since`, `rev` and the seen fields: `sinceHint` is the source's own time. */
export type DraftRow = Omit<AgentOverviewRow, 'since' | 'rev' | 'seen' | 'lastSeenAt'> & { sinceHint: number }

const titled = (text: string | null | undefined, fallback: string): string => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim() || fallback
  const points = [...value]
  return points.length > AGENTS_LIMITS.title ? `${points.slice(0, AGENTS_LIMITS.title - 1).join('')}…` : value
}

/** The waiting requests of each owner key (`pane:<id>`, `conversation:<id>`), oldest first. */
function requestsByOwner(facts: AgentFacts): Map<AgentKey, AgentPendingRequest[]> {
  const byOwner = new Map<AgentKey, AgentPendingRequest[]>()
  const add = (key: AgentKey, request: AgentPendingRequest) => byOwner.set(key, [...(byOwner.get(key) ?? []), request])
  for (const [threadId, { requests }] of facts.conversations) {
    for (const request of requests) {
      if (request.state !== 'pending') continue
      add(agentKey('conversation', threadId), { via: 'thread', id: request.id, threadId, title: mainMessage(AGENT_REQUEST_TITLE_CODES[request.kind], {}), since: request.createdAt, more: 0 })
    }
  }
  for (const approval of facts.approvals) {
    // B10 names its requester `pane:<id>` or `thread:<id>`; MCP servers and the app own no agent row.
    if (approval.requester.kind !== 'agent') continue
    const [kind, id] = [approval.requester.id.slice(0, approval.requester.id.indexOf(':')), approval.requester.id.slice(approval.requester.id.indexOf(':') + 1)]
    const owner = kind === 'pane' ? agentKey('pane', id) : kind === 'thread' ? agentKey('conversation', id) : null
    if (!owner || !id) continue
    const title = isAgentRequestTitle(approval.title) ? approval.title : mainMessage('approvals.title.agent', {})
    add(owner, { via: 'approval', id: approval.id, ...(kind === 'thread' ? { threadId: id } : {}), title, risk: approval.risk, since: approval.createdAt, more: 0 })
  }
  for (const [key, list] of byOwner) byOwner.set(key, list.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1)))
  return byOwner
}

const first = (list: AgentPendingRequest[] | undefined): AgentPendingRequest | undefined => list?.length ? { ...list[0], more: list.length - 1 } : undefined

/**
 * Every row, deduplicated and sorted. `seenAt` gives each key's stored mark; `history` the previous row, so a row
 * that keeps its state keeps its `since`.
 */
export function draftRows(facts: AgentFacts): DraftRow[] {
  // Sources are mapped as seen here: whether a settled row is Finished or Idle is the seen store's call (stampRows).
  const requests = requestsByOwner(facts)
  const paneNames = new Map<string, string>()
  for (const workspace of facts.workspaces) for (const pane of workspace.panes) if (pane.displayName) paneNames.set(pane.id, pane.displayName)
  const rows: DraftRow[] = []
  const withRequest = (key: AgentKey, state: AgentState, ...extra: (AgentKey | undefined)[]): { state: AgentState; pendingRequest?: AgentPendingRequest } => {
    // A delegation shows its destination's request, so the dedupe never hides a needs-you request.
    const pendingRequest = first([key, ...extra].flatMap(item => (item ? requests.get(item) ?? [] : [])).sort((a, b) => a.since - b.since))
    return pendingRequest ? { state: 'needs-you', pendingRequest } : { state }
  }

  const livePanes = new Set(facts.workspaces.flatMap(workspace => workspace.panes.map(item => item.id)))
  for (const pane of facts.panes.values()) {
    const key = agentKey('pane', pane.paneId)
    if (!parseAgentKey(key)) continue
    const stopped = facts.stoppedPanes?.has(pane.paneId) === true
    // The person stopped it: Stopped while the pane exists, as the renderer's tone shows it; it ends when the pane closes.
    if (stopped && !livePanes.has(pane.paneId)) continue
    const mapped = stopped ? agentState({ kind: 'pane', lifecycle: null, terminal: 'exited', stoppedByPerson: true, seen: pane.seen })
      : agentState({ kind: 'pane', lifecycle: pane.state, terminal: 'running', seen: pane.seen })
    if (mapped.ended) continue
    rows.push({ key, kind: 'pane', id: pane.paneId, workspaceId: pane.workspaceId, mode: 'code', title: titled(paneNames.get(pane.paneId), pane.agent), provider: pane.agent,
      ...withRequest(key, mapped.state), sinceHint: pane.since })
  }

  for (const [threadId, { thread, completedAt }] of facts.conversations) {
    const key = agentKey('conversation', threadId)
    if (thread.archived || !parseAgentKey(key)) continue
    const pending = requests.get(key)?.length ?? 0
    const mapped = agentState({ kind: 'conversation', status: thread.status, lastTurnStatus: thread.lastTurnStatus, pendingRequests: pending, backgroundRunning: thread.background?.running ?? 0,
      observation: thread.providerObservation?.state, seen: true })
    if (mapped.ended) continue
    const worktree = thread.ownedWorktree?.path ?? thread.observedLocation?.cwd
    rows.push({ key, kind: 'conversation', id: threadId, workspaceId: thread.workspaceId, mode: 'thread', title: titled(thread.title, 'Conversation'), provider: thread.provider,
      ...(thread.costReport ? { cost: { usd: thread.costReport.totalUsd, estimated: thread.costReport.source === 'codex-token-usage' } } : {}),
      ...(worktree ? { worktree: { path: worktree, branch: thread.ownedWorktree?.branch ?? null } } : {}),
      ...withRequest(key, mapped.state), sinceHint: completedAt ?? thread.updatedAt })
  }

  for (const task of facts.delegations.values()) {
    const key = agentKey('delegation', task.id)
    if (!parseAgentKey(key)) continue
    const mapped = agentState({ kind: 'delegation', state: task.state, requester: task.requestedBy === 'person' ? 'person' : 'agent', seen: true })
    if (mapped.ended) continue
    const destination = [task.paneId ? agentKey('pane', task.paneId) : undefined, task.destinationThreadId ? agentKey('conversation', task.destinationThreadId) : undefined]
    const origin = task.originPaneId && facts.panes.has(task.originPaneId) ? agentKey('pane', task.originPaneId) : undefined
    const provider = facts.providerOf(task.agentProfileId)
    rows.push({ key, kind: 'delegation', id: task.id, workspaceId: task.workspaceId, mode: agentMode('delegation', task.surface), title: titled(task.objective, 'Delegation'),
      ...(provider ? { provider } : {}), ...(origin ? { parentKey: origin } : {}), ...(mapped.waitingForLead ? { waitingForLead: true as const } : {}),
      ...(task.path ? { worktree: { path: task.path, branch: task.branch || null } } : {}),
      ...withRequest(key, mapped.state, ...destination), sinceHint: task.updatedAt })
  }

  for (const { run, tasks } of facts.work.values()) {
    const key = agentKey('work', run.id)
    if (!parseAgentKey(key)) continue
    const mapped = agentState({ kind: 'work', status: run.status, seen: true })
    if (mapped.ended) continue
    rows.push({ key, kind: 'work', id: run.id, workspaceId: run.workspaceId, mode: 'thread', title: titled(run.title, 'Agent Work'), parentKey: agentKey('conversation', run.supervisorThreadId),
      tasks: { done: tasks.filter(task => task.status === 'succeeded').length, total: tasks.length }, state: mapped.state, sinceHint: run.updatedAt })
  }

  const ownership = agentOwnership({
    delegations: [...facts.delegations.values()].map(task => ({ id: task.id, paneId: task.paneId, destinationThreadId: task.destinationThreadId })),
    workRuns: [...facts.work.values()].map(({ run, tasks }) => ({ id: run.id, workerThreadIds: tasks.flatMap(task => (task.threadId ? [task.threadId] : [])) }))
  })
  return applyAgentOwnership(rows, ownership)
}

/** States that turn into Finished until the person looks (§3.4). */
const FINISHING = new Set<AgentKind>(['conversation', 'delegation', 'work'])
type AgentKind = AgentOverviewRow['kind']

/**
 * The finished rows: a conversation idle after a completed turn, an approved delegation, a succeeded run. Their source
 * mapped them as seen-less; here the stored mark decides between Finished and Idle.
 */
export function finishedCandidate(draft: Pick<DraftRow, 'kind' | 'state' | 'id'>, facts: AgentFacts): boolean {
  if (!FINISHING.has(draft.kind)) return false
  if (draft.state !== 'idle') return false
  if (draft.kind === 'conversation') return facts.conversations.get(draft.id)?.thread.lastTurnStatus === 'completed'
  if (draft.kind === 'delegation') return facts.delegations.get(draft.id)?.state === 'approved'
  return facts.work.get(draft.id)?.run.status === 'succeeded'
}

/**
 * Stamps the read-model fields: Finished vs Idle from the seen mark, `since` kept while the state holds, `rev` raised
 * when anything in the row changed. Rows past `AGENTS_LIMITS.rows` drop the oldest idle, stopped and unknown first.
 */
export function stampRows(drafts: DraftRow[], facts: AgentFacts, seenAt: ReadonlyMap<string, number>, history: ReadonlyMap<string, RowHistory>,
  stuck: ReadonlySet<string>, now: number): { rows: AgentOverviewRow[]; history: Map<string, RowHistory> } {
  const next = new Map<string, RowHistory>()
  const rows: AgentOverviewRow[] = []
  const settled = (state: AgentState | undefined) => state === 'finished' || state === 'idle'
  for (const { sinceHint, ...draft } of drafts) {
    const previous = history.get(draft.key)
    const mark = seenAt.get(draft.key) ?? null
    let state: AgentState = stuck.has(draft.key) ? 'unknown' : draft.state
    // `since` holds while the state holds; Finished and Idle are one settled phase, so marking it seen keeps the time
    // it settled. A row met for the first time takes its source's own time.
    const keep = previous && (previous.state === state || (settled(previous.state) && settled(state)))
    const since = keep ? previous.since : previous ? now : sinceHint
    // Finished from the moment it settled until the person looks after that (§3.4).
    if (state === 'idle' && finishedCandidate(draft, facts) && !isSeenSince(mark, since)) state = 'finished'
    // An approved delegation the person has seen ends (§5.3).
    if (draft.kind === 'delegation' && state === 'idle' && facts.delegations.get(draft.id)?.state === 'approved') continue
    const seen = draft.kind === 'pane' ? facts.panes.get(draft.id)?.seen ?? false : isSeenSince(mark, since)
    const row = { ...draft, state, since, seen, lastSeenAt: mark }
    const body = JSON.stringify(row)
    const rev = previous ? (previous.body === body ? previous.rev : previous.rev + 1) : 1
    next.set(draft.key, { state, since, rev, body })
    rows.push({ ...row, rev })
  }
  rows.sort(compareAgentRows)
  if (rows.length > AGENTS_LIMITS.rows) {
    // Past the cap, the oldest quiet rows go first (idle, stopped, unknown), then the oldest finished and failed ones.
    // Needs-you and working rows are never dropped.
    const rank = (state: AgentState) => (state === 'idle' || state === 'stopped' || state === 'unknown' ? 0 : state === 'finished' || state === 'failed' ? 1 : 2)
    const droppable = rows.filter(row => rank(row.state) < 2).sort((a, b) => rank(a.state) - rank(b.state) || a.since - b.since)
    const drop = new Set<string>(droppable.slice(0, rows.length - AGENTS_LIMITS.rows).map(row => row.key))
    return { rows: rows.filter(row => !drop.has(row.key)), history: new Map([...next].filter(([key]) => !drop.has(key))) }
  }
  return { rows, history: next }
}
