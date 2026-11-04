import type { AppDatabase } from '../../db'
import { mainMessage } from '../../../../shared/messages'
import { delegationAgentState, paneAgentState, seenSince, threadAgentState, workRunAgentState } from '../../../../shared/agents/agentState'
import { AGENT_SOURCES, isAgentKind, type AgentKey, type AgentRequestSummary, type AgentRow, type AgentSource, type AgentSourceStatus, type AgentsChange, type AgentsOverview } from '../../../../shared/types/agents'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadRequest } from '../../../../shared/types/thread'
import type { DelegationState, DelegationTask } from '../../../../shared/types/delegation'
import type { WorkRunStatus } from '../../../../shared/types/work'
import { readThreadTitle } from '../conversation/thread-title'
import { AgentSeenStore } from './agent-seen.store'

/** Newest first, per source: the overview is a glance, not a history. */
const SOURCE_LIMIT = 200

export interface AgentsReadModelDeps {
  db: AppDatabase
  /** Every pane's agent state (AgentStateService.list). */
  panes(): PaneAgentState[]
  /** Pending requests of every conversation (ThreadHistory.pendingRequestsAll). */
  threadRequests(): ThreadPendingRequestSummary[]
  /** The pane's own "seen", for the window's pane chips. */
  markPaneSeen?(paneId: string): void
  now?(): number
}

const REQUEST_TITLE = {
  approval: () => mainMessage('agents.request.approval', {}),
  question: () => mainMessage('agents.request.question', {}),
  permissions: () => mainMessage('agents.request.permissions', {}),
  elicitation: () => mainMessage('agents.request.elicitation', {}),
  tool: () => mainMessage('agents.request.tool', {})
} satisfies Record<ThreadRequest['kind'], () => AgentRequestSummary['title']>

const provider = (value: string | undefined): AgentRow['provider'] => value === 'claude' || value === 'codex' ? value : 'other'
const rowKey = (row: AgentKey) => AgentSeenStore.key(row.kind, row.id)

/**
 * S7.1 · The agents read model (spec §3, CCR #513): panes, conversations, delegations and work runs in the seven
 * states, each source read on its own so one that fails never hides the others (§5.7). Reads only; the one write is
 * the person's "seen" mark.
 */
export class AgentsReadModel {
  private readonly seen: AgentSeenStore
  private readonly seq: Record<AgentSource, number> = { panes: 0, threads: 0, delegations: 0, work: 0 }
  private last = new Map<string, string>()

  constructor(private readonly deps: AgentsReadModelDeps) {
    this.seen = new AgentSeenStore(deps.db)
  }

  overview(): AgentsOverview {
    const seen = this.seen.all()
    const sources = {} as Record<AgentSource, AgentSourceStatus>
    const agents: AgentRow[] = []
    const readers: Record<AgentSource, () => AgentRow[]> = {
      panes: () => this.panes(seen),
      threads: () => this.threads(seen),
      delegations: () => this.delegations(seen),
      work: () => this.work(seen)
    }
    for (const source of AGENT_SOURCES) {
      try {
        agents.push(...readers[source]())
        sources[source] = { ok: true, seq: ++this.seq[source] }
      } catch {
        sources[source] = { ok: false, reason: mainMessage('agents.source.unavailable', { source }) }
      }
    }
    return { agents, sources }
  }

  /** The rows that changed since the last call, for the `agents:changed` push; null when nothing did. */
  changes(): AgentsChange | null {
    const { agents, sources } = this.overview()
    const next = new Map(agents.map(row => [rowKey(row), JSON.stringify(row)]))
    const upsert = agents.filter(row => this.last.get(rowKey(row)) !== next.get(rowKey(row)))
    const removed = [...this.last.keys()].filter(key => !next.has(key)).map(key => {
      const [kind, id] = key.split('\u0000')
      return { kind, id } as AgentKey
    })
    const failed = Object.values(sources).some(status => !status.ok)
    this.last = next
    return upsert.length || removed.length || failed ? { upsert, removed, sources } : null
  }

  /** The person looked at it. Refuses anything but a well-formed key. */
  markSeen(key: unknown): boolean {
    if (!key || typeof key !== 'object') return false
    const { kind, id } = key as { kind?: unknown; id?: unknown }
    if (!isAgentKind(kind) || typeof id !== 'string' || !id || id.length > 200) return false
    this.seen.mark({ kind, id }, this.now())
    if (kind === 'pane') this.deps.markPaneSeen?.(id)
    return true
  }

  private now(): number { return this.deps.now?.() ?? Date.now() }

  private panes(seen: Map<string, number>): AgentRow[] {
    return this.deps.panes().map(pane => {
      const seenAt = seen.get(AgentSeenStore.key('pane', pane.paneId)) ?? null
      const state = paneAgentState({ lifecycle: pane.state, seen: pane.seen || seenSince(seenAt, pane.since) })
      const requests: AgentRequestSummary[] = pane.state === 'blocked'
        ? [{ requestId: `pane:${pane.paneId}:${pane.stateChangeSeq}`, title: mainMessage('agents.request.pane', {}), risk: null, answerable: false, since: pane.since }]
        : []
      return {
        kind: 'pane', id: pane.paneId, state, provider: provider(pane.agent), mode: 'code', title: pane.agent,
        workspaceId: pane.workspaceId, since: pane.since, seenAt, session: null, worktree: null, cost: null, requests
      }
    })
  }

  private threads(seen: Map<string, number>): AgentRow[] {
    const requests = new Map<string, ThreadPendingRequestSummary[]>()
    for (const request of this.deps.threadRequests()) requests.set(request.threadId, [...requests.get(request.threadId) ?? [], request])
    const rows = this.deps.db.prepare(`SELECT id, data_json FROM conversation_threads
      WHERE COALESCE(json_extract(data_json, '$.archived'), 0) = 0
      ORDER BY json_extract(data_json, '$.updatedAt') DESC LIMIT ?`).all(SOURCE_LIMIT) as { id: string; data_json: string }[]
    return rows.flatMap(row => {
      let thread: ConversationThread
      try { thread = JSON.parse(row.data_json) as ConversationThread } catch { return [] }
      const pending = requests.get(row.id) ?? []
      const since = thread.updatedAt ?? 0
      const seenAt = seen.get(AgentSeenStore.key('thread', row.id)) ?? null
      const state = threadAgentState({
        status: thread.status, lastTurnStatus: thread.lastTurnStatus, pendingRequests: pending.length,
        backgroundRunning: thread.background?.running ?? 0, observation: thread.providerObservation?.state, seen: seenSince(seenAt, since)
      })
      return [{
        kind: 'thread' as const, id: row.id, state, provider: provider(thread.provider), mode: 'thread' as const,
        title: readThreadTitle(thread.title), workspaceId: thread.workspaceId ?? null, since, seenAt,
        session: thread.nativeSessionId ?? null,
        worktree: thread.ownedWorktree ? { path: thread.ownedWorktree.path, branch: thread.ownedWorktree.branch ?? null } : null,
        cost: typeof thread.costReport?.totalUsd === 'number' ? { usd: thread.costReport.totalUsd } : null,
        requests: pending.map(request => ({ requestId: request.requestId, title: REQUEST_TITLE[request.kind]?.() ?? REQUEST_TITLE.approval(), risk: null, answerable: true, since: request.createdAt }))
      }]
    })
  }

  private delegations(seen: Map<string, number>): AgentRow[] {
    const rows = this.deps.db.prepare(`SELECT d.id, d.payload, i.state, i.updated_at FROM delegations d
      LEFT JOIN delegation_task_index i ON i.task_id = d.id
      ORDER BY COALESCE(i.updated_at, 0) DESC LIMIT ?`).all(SOURCE_LIMIT) as { id: string; payload: string; state: string | null; updated_at: number | null }[]
    return rows.flatMap(row => {
      let task: DelegationTask
      try { task = JSON.parse(row.payload) as DelegationTask } catch { return [] }
      const since = row.updated_at ?? task.updatedAt ?? 0
      const seenAt = seen.get(AgentSeenStore.key('delegation', row.id)) ?? null
      // Its review is the person's: an agent asks for the work, the person accepts the result (B-series delegation flow).
      const state = delegationAgentState({ state: (row.state ?? task.state) as DelegationState, requesterIsPerson: true, seen: seenSince(seenAt, since) })
      return [{
        kind: 'delegation' as const, id: row.id, state, provider: provider(task.agentProfileId), mode: 'code' as const,
        title: task.objective ?? '', workspaceId: task.workspaceId ?? null, since, seenAt,
        session: task.nativeSession?.nativeSessionId ?? null,
        worktree: task.path ? { path: task.path, branch: task.branch || null } : null,
        cost: null, requests: [],
        ...(task.originPaneId ? { parent: { kind: 'pane' as const, id: task.originPaneId } } : {})
      }]
    })
  }

  private work(seen: Map<string, number>): AgentRow[] {
    const rows = this.deps.db.prepare('SELECT id, supervisor_thread_id, workspace_id, title, status, updated_at FROM work_runs ORDER BY updated_at DESC LIMIT ?')
      .all(SOURCE_LIMIT) as { id: string; supervisor_thread_id: string; workspace_id: string; title: string; status: WorkRunStatus; updated_at: number }[]
    return rows.map(row => {
      const seenAt = seen.get(AgentSeenStore.key('work', row.id)) ?? null
      return {
        kind: 'work', id: row.id, state: workRunAgentState({ status: row.status, seen: seenSince(seenAt, row.updated_at) }),
        provider: 'other', mode: 'code', title: row.title, workspaceId: row.workspace_id, since: row.updated_at, seenAt,
        session: null, worktree: null, cost: null, requests: [], parent: { kind: 'thread', id: row.supervisor_thread_id }
      }
    })
  }
}
