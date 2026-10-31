/**
 * S7.1 · The agents read model as it crosses the IPC boundary (docs/design/s7-mission-control.md §3, §5.3, §14).
 * Re-exported by `../ipc`; the channels are `IPC_CHANNELS.agents`.
 *
 * Main aggregates every agent the person has running (panes, conversations, delegations, Agent Work runs) into rows
 * already mapped to the seven states by `shared/agents/agentState.ts`. The window reads the whole overview once, then
 * applies `agents:changed` events with `applyAgentsChange` (`shared/agents/agentsOverview.ts`): main pushes on every
 * source change, never on a timer. Main frame only; never an MCP tool (`agents.central` in shared/mcp-coverage.ts).
 */
import type { AgentKey, AgentKind, AgentMode, AgentState } from '../../agents/agentState'
import type { MainMessage, MessageCode } from '../../messages'
import type { ApprovalRisk } from '../approvals'
import type { ThreadRequest } from '../thread'

/** A request waiting for the person (§5.2 line 3): the first one, with how many wait behind it. */
export interface AgentPendingRequest {
  /** Which answer path opens it: a conversation request (`thread.respond`), or a B10 approval (the approval modal). */
  via: 'thread' | 'approval'
  /** The request's id on that path (`ThreadRequest.id`, `ApprovalRequest.id`). */
  id: string
  /** Conversation requests: the conversation it belongs to. */
  threadId?: string
  /** Built by main (C3), never the agent's own text: `approvals.title.*`, or `agents.request.<kind>`. */
  title: MainMessage
  /** Computed by main (B10). Absent for a conversation request main has not classified. */
  risk?: ApprovalRisk
  /** When it started waiting (epoch ms); the needs-you timer and the row's "waiting for" read it. */
  since: number
  /** Other requests waiting on the same agent ("+2 more"). */
  more: number
}

/** The C3 title of a conversation request, by its kind: main builds it, the agent's own text never becomes the title. */
export const AGENT_REQUEST_TITLE_CODES = {
  approval: 'agents.request.approval',
  question: 'agents.request.question',
  permissions: 'agents.request.permissions',
  elicitation: 'agents.request.elicitation',
  tool: 'agents.request.tool'
} as const satisfies Record<ThreadRequest['kind'], MessageCode>

/** What the agent has cost over its whole life, as the provider reported it (§5.2). Never per day in v1. */
export interface AgentCost {
  usd: number
  /** From token counts, not from the provider's own figure ("Estimated from tokens"). */
  estimated: boolean
}

/** One agent. Desktop only: the phone gets `RemoteAgentRow`, without paths, session ids or cost. */
export interface AgentOverviewRow {
  key: AgentKey
  kind: AgentKind
  /** The source's id: pane id, conversation id, delegation id or work run id. */
  id: string
  workspaceId: string
  /** The agent that started this one (a delegation's origin, a work run's supervising conversation), when listed. */
  parentKey?: AgentKey
  state: AgentState
  /** Delegations blocked on the agent that delegated them: `working`, with the meta "Waiting for its lead" (§3.2). */
  waitingForLead?: true
  /** When it entered this state (epoch ms); for needs-you, when it started waiting. */
  since: number
  /** Display name: pane name, conversation title, delegation objective, run title. Cut to `AGENTS_LIMITS.title`. */
  title: string
  /** Agent manifest or provider id (`claude`, `codex`, …), for the icon; absent when the source has none. */
  provider?: string
  mode: AgentMode
  /** Lifetime total; conversations (and runs, summed) only. Panes have no cost source. */
  cost?: AgentCost
  /** The checkout it works in, when it is not the project root. Desktop only. */
  worktree?: { path: string; branch: string | null }
  pendingRequest?: AgentPendingRequest
  /** Agent Work runs: "3 of 5 tasks" (§3.2; tasks are not rows in v1). */
  tasks?: { done: number; total: number }
  /** The person looked at it since it last finished (§3.4). */
  seen: boolean
  /** The stored `seenAt` for this key, or null when never marked. */
  lastSeenAt: number | null
  /**
   * The source's own sequence for this row: `stateChangeSeq` for panes, a per-source counter otherwise. Increases with
   * every change of the row; a change carrying a lower one than the row on screen is late and ignored (§5.3).
   */
  sourceSeq: number
}

/** Each source answers separately (§5.3): one that fails shows the partial notice, the others keep updating. */
export type AgentSourceStatus = { ok: true } | { ok: false; message: MainMessage }

/** The C3 code of a source that could not be read. */
export const AGENT_SOURCE_UNAVAILABLE_CODES = {
  pane: 'agents.unavailable.pane',
  conversation: 'agents.unavailable.conversation',
  delegation: 'agents.unavailable.delegation',
  work: 'agents.unavailable.work'
} as const satisfies Record<AgentKind, MessageCode>

/** `agents:overview`. */
export interface AgentsOverview {
  rows: AgentOverviewRow[]
  sources: Record<AgentKind, AgentSourceStatus>
  /** Main's publication counter; every `agents:changed` carries the next one. */
  seq: number
}

/**
 * `agents:changed`, pushed within 1 s of a source change. `upsert` replaces rows by key (unless late by `sourceSeq`),
 * `removed` names rows that ended, `sources` the statuses that changed. A gap in `seq` means the window missed an
 * event: it reads `agents:overview` again.
 */
export interface AgentsChange {
  seq: number
  upsert?: AgentOverviewRow[]
  removed?: AgentKey[]
  sources?: Partial<Record<AgentKind, AgentSourceStatus>>
}

/** `agents:mark-seen`: the person opened the row, or chose "Mark as seen". Main stores its own clock as `seenAt`. */
export interface AgentMarkSeenInput { key: AgentKey }

/** Why a mark-seen was refused; each is also a message code (`agents.refused.<reason>`, C3). A refusal stores nothing. */
export const AGENTS_REFUSALS = ['invalid', 'notFound'] as const
export type AgentsRefusal = typeof AGENTS_REFUSALS[number]

/** Idempotent: marking a row already seen stores the newer time and returns its state again. */
export type AgentMarkSeenResult =
  | { ok: true; key: AgentKey; seenAt: number; state: AgentState }
  | { ok: false; refusal: AgentsRefusal; message: MainMessage }

export const AGENTS_LIMITS = {
  /** Characters of a row title. */
  title: 200,
  /** Rows main lists; past it, the oldest idle, stopped and unknown rows are left out. */
  rows: 500,
  /** `seenAt` keys main keeps; the least recently marked go first. */
  seenKeys: 2_000
} as const

/** `window.oxe.agents`; optional while the window may run against an older main. */
export interface AgentsApi {
  overview?(): Promise<AgentsOverview>
  markSeen?(input: AgentMarkSeenInput): Promise<AgentMarkSeenResult>
  onChanged?(listener: (change: AgentsChange) => void): () => void
}
