/**
 * S7.1 · One vocabulary for agent state (docs/design/s7-mission-control.md §3).
 *
 * Every source speaks its own states: the pane lifecycle (5) and the renderer's tones, a conversation's `ThreadStatus`
 * (5), a delegation (9), an Agent Work run (5). Every surface shows these seven instead, mapped here and nowhere else
 * (charter rule 4): main's read model, the agents central, the mode-switch badges, the sidebars, the headers and,
 * already mapped by the desktop, the phone. Labels come from the `agents.state.*` keys of the `common` catalog.
 *
 * Pure and dependency-free, so the renderer, main and the tests share it. Its table is tests/agents-state-contract.
 */
import type { AgentLifecycleState } from '../types/agent-state'
import type { DelegationState, DelegationSurface } from '../types/delegation'
import type { ThreadProviderObservation, ThreadStatus, ThreadTurn } from '../types/thread'
import type { WorkRunStatus } from '../types/work'

/** The seven states. The order is also the precedence when several conditions hold, and the sort order (§5.3). */
export const AGENT_STATES = ['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'] as const
export type AgentState = typeof AGENT_STATES[number]

/** What an agent row is. Plain shell panes and background jobs are not agents (§4). */
export const AGENT_KINDS = ['pane', 'conversation', 'delegation', 'work'] as const
export type AgentKind = typeof AGENT_KINDS[number]

/** The app mode where "Open" lands; the same ids as the mode switch (`NavigationMode`). */
export const AGENT_MODES = ['code', 'thread'] as const
export type AgentMode = typeof AGENT_MODES[number]

/**
 * The `common` catalog key of each state, plus the two words only a terminal has (§7). No other catalog defines these
 * words for an agent's state.
 */
export const AGENT_STATE_LABEL_KEYS = {
  'needs-you': 'agents.state.needsYou',
  failed: 'agents.state.failed',
  working: 'agents.state.working',
  finished: 'agents.state.finished',
  idle: 'agents.state.idle',
  stopped: 'agents.state.stopped',
  unknown: 'agents.state.unknown'
} as const satisfies Record<AgentState, string>
export const AGENT_TERMINAL_LABEL_KEYS = { starting: 'agents.state.starting', exited: 'agents.state.exited' } as const

/** States the mode-switch badge counts (§3.3): needs-you, failed and working. */
export const AGENT_BADGE_STATES: readonly AgentState[] = ['needs-you', 'failed', 'working']

// ---- keys ---------------------------------------------------------------------------------------------------------

/** One agent, across every surface and the phone: `<kind>:<source id>`. Opaque to readers; never a path. */
export type AgentKey = `${AgentKind}:${string}`

/**
 * Characters of a whole key, kind included: the remote gateway's id rule (`^[A-Za-z0-9._:-]{1,200}$`), so a key the
 * desktop builds is always one the phone can send back.
 */
export const AGENT_KEY_MAX = 200
/** The characters a source id may use inside a key (pane, conversation, delegation and run ids are UUIDs). */
export const AGENT_KEY_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

export function agentKey(kind: AgentKind, id: string): AgentKey {
  return `${kind}:${id}`
}

/** The kind and source id of a key, or null for anything that is not one: unknown kind, empty id, other characters, too long. */
export function parseAgentKey(value: unknown): { kind: AgentKind; id: string } | null {
  if (typeof value !== 'string' || value.length > AGENT_KEY_MAX) return null
  const at = value.indexOf(':')
  if (at < 0) return null
  const kind = value.slice(0, at), id = value.slice(at + 1)
  if (!(AGENT_KINDS as readonly string[]).includes(kind) || !AGENT_KEY_ID_PATTERN.test(id)) return null
  return { kind: kind as AgentKind, id }
}

// ---- one owner per agent (M2) -------------------------------------------------------------------------------------

/**
 * The sources overlap: a delegation runs in a pane or a conversation of its own, and every Agent Work task runs in a
 * worker conversation. Each agent has exactly one row, owned like this:
 *
 * - A **delegation owns its destination** pane or conversation: that pane or conversation gets no row of its own;
 *   the delegation row stands for it (state, request, Open). It is listed again on its own once the delegation is gone.
 * - A **work run's worker conversations nest under it**: they keep their own `conversation:` row, with
 *   `parentKey: work:<run id>`. A worker that is also a delegation's destination is owned by the delegation.
 * - Anything else is its own row, with no parent unless its source names one.
 */
export interface AgentOwnershipInput {
  delegations: readonly { id: string; paneId?: string; destinationThreadId?: string }[]
  workRuns: readonly { id: string; workerThreadIds: readonly string[] }[]
}

export interface AgentOwnership {
  /** Keys that get no row: the delegation row stands for them. */
  hidden: Map<AgentKey, AgentKey>
  /** Keys listed under another row. */
  parents: Map<AgentKey, AgentKey>
}

export function agentOwnership(input: AgentOwnershipInput): AgentOwnership {
  const hidden = new Map<AgentKey, AgentKey>()
  const parents = new Map<AgentKey, AgentKey>()
  for (const delegation of input.delegations) {
    const owner = agentKey('delegation', delegation.id)
    if (delegation.paneId) hidden.set(agentKey('pane', delegation.paneId), owner)
    if (delegation.destinationThreadId) hidden.set(agentKey('conversation', delegation.destinationThreadId), owner)
  }
  for (const run of input.workRuns) {
    for (const threadId of run.workerThreadIds) {
      const key = agentKey('conversation', threadId)
      if (!hidden.has(key)) parents.set(key, agentKey('work', run.id))
    }
  }
  return { hidden, parents }
}

/** Rows after the ownership rule: owned rows dropped, nested rows given their parent. */
export function applyAgentOwnership<Row extends { key: AgentKey; parentKey?: AgentKey }>(rows: readonly Row[], ownership: AgentOwnership): Row[] {
  return rows.filter(row => !ownership.hidden.has(row.key)).map(row => {
    const parentKey = ownership.parents.get(row.key)
    return parentKey ? { ...row, parentKey } : row
  })
}

// ---- seen (§3.4: main keeps one mark per agent key in its `agent_seen` table) -------------------------------------

/** "Finished" needs the person not to have looked since it finished: seen when `seenAt` is at or after `finishedAt`. */
export function isSeenSince(seenAt: number | null | undefined, finishedAt: number): boolean {
  return typeof seenAt === 'number' && seenAt >= finishedAt
}

// ---- the mapping (§3.2) -------------------------------------------------------------------------------------------

/** The terminal process status, as the renderer's terminal store and main's PTY know it. */
export type AgentTerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

/**
 * What each source contributes. `seen` is the person's look since the source last finished (§3.4): the pane's own
 * `PaneAgentState.seen`, else `isSeenSince(seenAt, finishedAt)`.
 */
export type AgentStateInput =
  | {
    kind: 'pane'
    /** Main's lifecycle (`PaneAgentState.state`); read only while the terminal runs, as `deriveStatusTone` does. */
    lifecycle: AgentLifecycleState | null
    terminal: AgentTerminalStatus
    /** The person stopped it (Stop, or closing the agent from its pane). An exit nobody asked for ends the row. */
    stoppedByPerson?: boolean
    seen: boolean
  }
  | {
    kind: 'conversation'
    status: ThreadStatus
    lastTurnStatus?: ThreadTurn['status']
    pendingRequests: number
    backgroundRunning: number
    observation?: ThreadProviderObservation['state']
    seen: boolean
  }
  | {
    kind: 'delegation'
    state: DelegationState
    /**
     * Who waits on a blocked or review delegation (coordinator, 2026-10-31): `person` for a delegation created from
     * the window, `agent` for one created through `oxespace_delegate_task`.
     */
    requester: 'person' | 'agent'
    seen: boolean
  }
  | { kind: 'work'; status: WorkRunStatus; seen: boolean }

/**
 * A row's state, or `ended` when the source is gone (terminal exited on its own, §3.2): the central shows "Ended" for
 * 5 s, then "Ended recently" (§5.3). `waitingForLead` is the delegation meta "Waiting for its lead" (§3.2).
 */
export type AgentStateResult = { ended: false; state: AgentState; waitingForLead?: true } | { ended: true }

const state = (value: AgentState): AgentStateResult => ({ ended: false, state: value })

/**
 * Every switch below is exhaustive: a new source state (a 10th DelegationState, a 6th WorkRunStatus…) fails the
 * typecheck here instead of silently showing "Not confirmed". At run time, a value from a newer store is `unknown`.
 */
const unmapped = (_value: never): AgentStateResult => state('unknown')

export function agentState(input: AgentStateInput): AgentStateResult {
  switch (input.kind) {
    case 'pane': {
      if (input.terminal === 'exited') return input.stoppedByPerson ? state('stopped') : { ended: true }
      // needs-you outranks failed, but a lifecycle report says nothing about a process that is not running.
      if (input.terminal === 'error') return state('failed')
      if (input.terminal === 'starting') return state('working')
      if (input.terminal !== 'running') return state('unknown')
      switch (input.lifecycle) {
        case 'blocked': return state('needs-you')
        case 'working': return state('working')
        case 'done': return state(input.seen ? 'idle' : 'finished')
        case 'idle': return state('idle')
        case 'unknown':
        case null: return state('unknown')
        default: return unmapped(input.lifecycle)
      }
    }
    case 'conversation': {
      if (input.status === 'approval' || input.pendingRequests > 0 || input.observation === 'awaiting-input') return state('needs-you')
      if (input.status === 'failed') return state('failed')
      if (input.status === 'running' || input.backgroundRunning > 0) return state('working')
      if (input.status === 'interrupted') return state('stopped')
      if (input.status !== 'idle') return unmapped(input.status)
      return state(input.lastTurnStatus === 'completed' && !input.seen ? 'finished' : 'idle')
    }
    case 'delegation': {
      switch (input.state) {
        case 'blocked':
        case 'review': return input.requester === 'person' ? state('needs-you') : { ended: false, state: 'working', waitingForLead: true }
        case 'failed': return state('failed')
        case 'preparing':
        case 'starting':
        case 'accepted': return state('working')
        case 'approved': return state(input.seen ? 'idle' : 'finished')
        case 'cancelled':
        case 'interrupted': return state('stopped')
        default: return unmapped(input.state)
      }
    }
    case 'work': {
      // A local, so the exhaustive check narrows the status and not the whole input.
      const status = input.status
      switch (status) {
        case 'blocked': return state('needs-you')
        case 'failed': return state('failed')
        case 'running': return state('working')
        case 'succeeded': return state(input.seen ? 'idle' : 'finished')
        case 'cancelled': return state('stopped')
        default: return unmapped(status)
      }
    }
    default: return unmapped(input)
  }
}

/**
 * The desktop's pane path (§3.2 "Estimated pane states"): the central uses the sidebar's tone (`deriveStatusTone`),
 * so the two never disagree, and keeps an estimated tone weaker. Main and the phone use `agentState` on the lifecycle
 * alone, where an estimate is `unknown`; the difference is deliberate and tested.
 */
export type AgentPaneTone = 'thinking' | 'needs-decision' | 'awaiting' | 'idle' | 'error' | 'exited' | 'starting'

export function paneToneState(tone: AgentPaneTone, input: { seen: boolean; stoppedByPerson?: boolean; estimated?: boolean }): AgentStateResult & { estimated?: true } {
  const estimated = input.estimated && (tone === 'thinking' || tone === 'awaiting') ? { estimated: true as const } : {}
  switch (tone) {
    case 'needs-decision': return state('needs-you')
    case 'error': return state('failed')
    case 'thinking':
    case 'starting': return { ...state('working'), ...estimated }
    case 'awaiting': return { ...state(input.seen ? 'idle' : 'finished'), ...estimated }
    case 'idle': return state('idle')
    case 'exited': return input.stoppedByPerson ? state('stopped') : { ended: true }
    default: return unmapped(tone)
  }
}

/** Where each kind opens. A delegation opens on its surface; an Agent Work run in its supervising conversation. */
export function agentMode(kind: AgentKind, surface?: DelegationSurface): AgentMode {
  if (kind === 'pane') return 'code'
  if (kind === 'delegation') return surface === 'terminal' ? 'code' : 'thread'
  return 'thread'
}

// ---- order (§5.3) -------------------------------------------------------------------------------------------------

const PRIORITY = new Map<AgentState, number>(AGENT_STATES.map((value, index) => [value, index]))

/** 0 for needs-you … 6 for unknown. */
export function agentStatePriority(value: AgentState): number {
  return PRIORITY.get(value) ?? AGENT_STATES.length
}

/**
 * Rows within a group: by state, then needs-you and working by the longest wait or run (oldest `since` first), the
 * others newest first, then by key so the order is total.
 */
export function compareAgentRows(a: { state: AgentState; since: number; key: string }, b: { state: AgentState; since: number; key: string }): number {
  const byState = agentStatePriority(a.state) - agentStatePriority(b.state)
  if (byState !== 0) return byState
  const oldestFirst = a.state === 'needs-you' || a.state === 'working'
  const bySince = oldestFirst ? a.since - b.since : b.since - a.since
  if (bySince !== 0) return bySince
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}
