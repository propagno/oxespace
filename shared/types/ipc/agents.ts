/**
 * S7.1 · The agents read model as it crosses the IPC boundary (docs/design/s7-mission-control.md §3, §5.3, §14).
 * Re-exported by `../ipc`; the channels are `IPC_CHANNELS.agents`.
 *
 * Main aggregates every agent the person has running (panes, conversations, delegations, Agent Work runs) into rows
 * already mapped to the seven states by `shared/agents/agentState.ts`, one row per agent (`agentOwnership`). Main pushes
 * on every source change, never on a timer. Main frame only; never an MCP tool (`agents.central` in mcp-coverage).
 *
 * Reader order: **subscribe first, then read.** Call `onChanged` and buffer what arrives, call `overview`, then apply
 * the buffered changes with `applyAgentsChange` (`shared/agents/agentsOverview.ts`): those already in the overview are
 * skipped by `seq`, the rest apply. Reading first can lose the events in between and loop through re-reads under load.
 */
import type { AgentKey, AgentKind, AgentMode, AgentState } from '../../agents/agentState'
import type { MainMessage, MessageCode, MessageParams } from '../../messages'
import type { ApprovalRisk } from '../approvals'
import type { ThreadRequest } from '../thread'
import type { AgentNudgeChoice } from '../../agents/agentTimers'

/** A request waiting for the person (§5.2 line 3): the first one, with how many wait behind it. */
export interface AgentPendingRequest {
  /** Which answer path opens it: a conversation request (`thread.respond`), or a B10 approval (the approval modal). */
  via: 'thread' | 'approval'
  /** The request's id on that path (`ThreadRequest.id`, `ApprovalRequest.id`). */
  id: string
  /** Conversation requests: the conversation it belongs to. */
  threadId?: string
  /** Built by main (C3), never the agent's own text: a parameterless `approvals.title.*` or `agents.request.<kind>`. */
  title: AgentRequestTitle
  /** Computed by main (B10). Absent for a conversation request main has not classified. */
  risk?: ApprovalRisk
  /** When it started waiting (epoch ms); the needs-you timer and the row's "waiting for" read it. */
  since: number
  /** Other requests waiting on the same agent ("+2 more"). */
  more: number
}

/** The codes a row's request title may use: titles only, none of which carries a parameter, so no agent text rides along. */
export const AGENT_REQUEST_TITLE_CODE_LIST = [
  'approvals.title.agent', 'approvals.title.oxequery', 'approvals.title.previewAutomation', 'approvals.title.crash',
  'agents.request.approval', 'agents.request.question', 'agents.request.permissions', 'agents.request.elicitation', 'agents.request.tool'
] as const satisfies readonly MessageCode[]
export type AgentRequestTitleCode = typeof AGENT_REQUEST_TITLE_CODE_LIST[number]
/** A request title: one of those codes, with no parameters (the type refuses a code that takes any). */
export type AgentRequestTitle = { [Code in AgentRequestTitleCode]: MessageParams[Code] extends Record<string, never> ? { code: Code; params: Record<string, never> } : never }[AgentRequestTitleCode]

/** Run-time check of the same rule, for values read back from another process. */
export function isAgentRequestTitle(value: unknown): value is AgentRequestTitle {
  if (!value || typeof value !== 'object') return false
  const { code, params } = value as { code?: unknown; params?: unknown }
  return (AGENT_REQUEST_TITLE_CODE_LIST as readonly unknown[]).includes(code) && !!params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length === 0
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
  /**
   * Lifetime total, conversations only in v1 (spec §5.2). Panes have no cost source, and Agent Work run rows carry
   * no cost in v1: a run cost needs an aggregation rule (its workers are listed under it), which moves to 1.5.
   */
  cost?: AgentCost
  /** The checkout it works in, when it is not the project root. Desktop only. */
  worktree?: { path: string; branch: string | null }
  pendingRequest?: AgentPendingRequest
  /** Agent Work runs: "3 of 5 tasks" (§3.2; tasks are not rows in v1). */
  tasks?: { done: number; total: number }
  /** The person looked at it since it last finished (§3.4; main keeps the marks in the `agent_seen` table). */
  seen: boolean
  /** The stored `seenAt` for this key, or null when never marked. */
  lastSeenAt: number | null
  /**
   * The row's revision, owned by the read model: it grows on **any** change to the row, whatever input caused it (a
   * source report, a terminal exit, a Stop, a B10 approval, a mark-seen). Source counters such as a pane's
   * `stateChangeSeq` are inputs only. A change carrying a revision no higher than the row on screen is late and ignored.
   */
  rev: number
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
 * `agents:changed`, pushed within 1 s of a source change. `upsert` replaces rows by key (unless late by `rev`),
 * `removed` names rows that ended, `sources` the statuses that changed. A gap in `seq` means the window missed an
 * event: it reads `agents:overview` again.
 */
export interface AgentsChange {
  seq: number
  upsert?: AgentOverviewRow[]
  removed?: AgentKey[]
  sources?: Partial<Record<AgentKind, AgentSourceStatus>>
}

/**
 * `agents:mark-seen`: the person opened the row, or chose "Mark as seen". `observedSince` is the `since` of the row the
 * person looked at. When the row finished again after it (`since > observedSince`), main stores `observedSince` and the
 * row stays Finished: a late or repeated mark never hides a newer result. Without it, main stores its own clock.
 */
export interface AgentMarkSeenInput { key: AgentKey; observedSince?: number }

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
  /** `seenAt` keys main keeps; the least recently marked go first. A key's mark is deleted with its source. */
  seenKeys: 2_000
} as const

/** `window.oxe.agents`; optional while the window may run against an older main. */
/**
 * `agents:activate`, pushed when the person clicks the needs-you notification (§5.10): the window opens Respond (the
 * B10 modal) for `requestId` on that agent, or the agent's row when there is no request. Main sends it only for that
 * click; the window never infers it from focus.
 */
export interface AgentActivateEvent { agentId: AgentKey; requestId?: string }

/**
 * The needs-you nudge delay (§5.10, Settings › Notifications): one of `AGENT_NUDGE_CHOICES_MS` (off, 1, 2 or 5 min),
 * 2 min by default. Main keeps it; a change reschedules every waiting request's timer and gives the phone a fresh
 * snapshot. `agents:set-nudge-setting` refuses any other value (it throws, and nothing is stored).
 */
export interface AgentNudgeSetting { afterMs: AgentNudgeChoice }

export interface AgentsApi {
  overview?(): Promise<AgentsOverview>
  markSeen?(input: AgentMarkSeenInput): Promise<AgentMarkSeenResult>
  onChanged?(listener: (change: AgentsChange) => void): () => void
  onActivate?(listener: (event: AgentActivateEvent) => void): () => void
  nudgeSetting?(): Promise<AgentNudgeSetting>
  setNudgeSetting?(input: AgentNudgeSetting): Promise<AgentNudgeSetting>
}
