/**
 * S7.1 · The one mapping from each source's own states to the seven of the central (spec §3.2, CCR #513). Pure and
 * shared: main's read model, the window's lists and badges, and through main the phone, all use it (charter rule 4).
 * When several states hold, the first in AGENT_STATES wins. tests/unit/agent-state.test.ts walks every source state.
 */
import { AGENT_STATES, type AgentState } from '../types/agents'
import type { AgentLifecycleState } from '../types/agent-state'
import type { ThreadProviderObservation, ThreadStatus, ThreadTurn } from '../types/thread'
import type { DelegationState } from '../types/delegation'
import type { WorkRunStatus } from '../types/work'

/** The highest-precedence state among those that hold; `fallback` when none does. */
function first(holds: Partial<Record<AgentState, boolean>>, fallback: AgentState): AgentState {
  return AGENT_STATES.find(state => holds[state]) ?? fallback
}

export interface PaneStateInput {
  lifecycle: AgentLifecycleState
  /** The terminal's own status, when known (`starting`, `error`…). */
  terminal?: string
  /** The person stopped it (not an exit of its own). */
  stoppedByPerson?: boolean
  seen: boolean
}

export function paneAgentState(input: PaneStateInput): AgentState {
  return first({
    'needs-you': input.lifecycle === 'blocked',
    failed: input.terminal === 'error',
    working: input.lifecycle === 'working' || input.terminal === 'starting',
    finished: input.lifecycle === 'done' && !input.seen,
    idle: input.lifecycle === 'idle' || (input.lifecycle === 'done' && input.seen),
    stopped: input.stoppedByPerson === true,
    unknown: input.lifecycle === 'unknown'
  }, 'unknown')
}

export interface ThreadStateInput {
  status: ThreadStatus
  lastTurnStatus?: ThreadTurn['status']
  pendingRequests: number
  backgroundRunning: number
  observation?: ThreadProviderObservation['state']
  seen: boolean
}

export function threadAgentState(input: ThreadStateInput): AgentState {
  return first({
    'needs-you': input.status === 'approval' || input.pendingRequests > 0 || input.observation === 'awaiting-input',
    failed: input.status === 'failed',
    working: input.status === 'running' || input.backgroundRunning > 0,
    finished: input.status === 'idle' && input.lastTurnStatus === 'completed' && !input.seen,
    idle: input.status === 'idle',
    stopped: input.status === 'interrupted'
  }, 'unknown')
}

export interface DelegationStateInput {
  state: DelegationState
  /** The person asked for it (and so answers its review); false when another agent is its lead. */
  requesterIsPerson: boolean
  seen: boolean
}

export function delegationAgentState(input: DelegationStateInput): AgentState {
  const waiting = input.state === 'blocked' || input.state === 'review'
  return first({
    'needs-you': waiting && input.requesterIsPerson,
    failed: input.state === 'failed',
    working: input.state === 'preparing' || input.state === 'starting' || input.state === 'accepted' || (waiting && !input.requesterIsPerson),
    finished: input.state === 'approved' && !input.seen,
    idle: input.state === 'approved' && input.seen,
    stopped: input.state === 'cancelled' || input.state === 'interrupted'
  }, 'unknown')
}

export interface WorkRunStateInput { status: WorkRunStatus; seen: boolean }

export function workRunAgentState(input: WorkRunStateInput): AgentState {
  return first({
    'needs-you': input.status === 'blocked',
    failed: input.status === 'failed',
    working: input.status === 'running',
    finished: input.status === 'succeeded' && !input.seen,
    idle: input.status === 'succeeded' && input.seen,
    stopped: input.status === 'cancelled'
  }, 'unknown')
}

/** Seen: the person looked at it after it last changed. */
export function seenSince(seenAt: number | null, changedAt: number): boolean {
  return seenAt !== null && seenAt >= changedAt
}
