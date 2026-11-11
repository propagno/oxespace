/**
 * S7.1 · The agents read model (CCR #513, spec docs/design/s7-mission-control.md §3): every agent the person runs —
 * terminal panes, conversations, delegations and work runs — in one vocabulary, aggregated by main.
 */
import type { MainMessage } from '../messages'
import type { ApprovalRisk } from './approvals'

/** §3.1, in precedence order: when several hold, the first wins, and lists sort by it. */
export const AGENT_STATES = ['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'] as const
export type AgentState = typeof AGENT_STATES[number]

/** `thread` is a conversation (the word ExecutionOwner and #441 use); the window and the phone say "Conversation". */
export const AGENT_KINDS = ['pane', 'thread', 'delegation', 'work'] as const
export type AgentKind = typeof AGENT_KINDS[number]

export interface AgentKey { kind: AgentKind; id: string }

/** A pending request on this agent: main-built, never the agent's own text. */
export interface AgentRequestSummary {
  requestId: string
  kind: 'approval' | 'question'
  /** Main-built title (C3). */
  title: MainMessage
  /** The 4 risk words (DESIGN FINDING M); null when nothing assessed it (a pane's own prompt). */
  risk: ApprovalRisk | null
  /** Whether F7's impact marked the request reversible; null when nothing assessed it. */
  reversible: boolean | null
  /** False when it can't be answered from where it is read (a pane's own prompt is answered in the pane). */
  answerable: boolean
  since: number
}

export type ThreadActivityKind = 'needs-you' | 'question' | 'working' | 'paused' | 'error' | 'ready' | 'done'
export type ThreadActivityVerb =
  | 'read' | 'edit' | 'run' | 'query' | 'http' | 'container' | 'think'
  | 'reading' | 'editing' | 'running' | 'querying' | 'calling' | 'starting'

/** T90 (F6 A19): the conversation's activity values, built in main and worded by the window (C3). */
export interface ThreadActivity {
  kind: ThreadActivityKind
  at: number
  text?: string
  verb?: ThreadActivityVerb
  since?: number
  count?: number
  requestId?: string
  reason?: string
}

export interface AgentRow extends AgentKey {
  state: AgentState
  /** Set only by the window, for a pane state it estimated from timing; main never estimates (§3.2). */
  estimated?: boolean
  provider: 'claude' | 'codex' | 'other'
  /** The surface it lives in: OxeCode (panes, delegations, work runs) or OxeChat (conversations). */
  mode: 'code' | 'thread'
  title: string
  workspaceId: string | null
  /** When it entered `state` (or last changed, when the source keeps no more). */
  since: number
  /** When the person last looked at it (§3.4), or null. */
  seenAt: number | null
  /** The native session id, or null. Desktop only. */
  session: string | null
  /** Its own worktree, if any. Desktop only. */
  worktree: { path: string; branch: string | null } | null
  /** Lifetime cost so far, when its provider reports one. Desktop only. */
  cost: { usd: number } | null
  requests: AgentRequestSummary[]
  /** The agent that started it, for nesting. */
  parent?: AgentKey
  /** T90 (F6 A19): set only on conversation (`thread`) rows. */
  activity?: ThreadActivity
}

/** Each source answers on its own: one that fails never hides the others (§5.7). */
export const AGENT_SOURCES = ['panes', 'threads', 'delegations', 'work'] as const
export type AgentSource = typeof AGENT_SOURCES[number]
export type AgentSourceStatus = { ok: true; seq: number } | { ok: false; reason: MainMessage }

export interface AgentsOverview {
  agents: AgentRow[]
  sources: Record<AgentSource, AgentSourceStatus>
}

/** Pushed on every change. */
export interface AgentsChange {
  upsert: AgentRow[]
  removed: AgentKey[]
  sources: Record<AgentSource, AgentSourceStatus>
}

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}
