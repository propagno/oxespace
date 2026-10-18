/**
 * Folds a lead agent's own state with the liveness of the work it spawned
 * (subagents, background shells) into the single state a person should see.
 *
 * The lead can finish its turn while children are still running; showing "done"
 * then is wrong, and a child blocked on a human is the whole session's problem.
 * This is derived on read and never stored.
 */
export type LeadState = 'working' | 'waiting' | 'blocked' | 'done' | 'idle'
export type ChildWorkLiveness = 'none' | 'working' | 'monitoring' | 'waiting'
export type FoldedState = 'working' | 'monitoring' | 'waiting' | 'blocked' | 'done' | 'idle'

export function foldLeadStatus(lead: LeadState, children: ChildWorkLiveness): FoldedState {
  // The lead needing a person always wins.
  if (lead === 'waiting' || lead === 'blocked') return lead
  // A child needing a person surfaces as the session waiting.
  if (children === 'waiting') return 'waiting'
  if (lead === 'working') return 'working'
  if (children === 'working') return 'working'
  if (children === 'monitoring') return 'monitoring'
  return lead
}

/** True when the lead has stopped but children keep the session open. */
export function isHeldOpenByChildWork(lead: LeadState, children: ChildWorkLiveness): boolean {
  return (lead === 'done' || lead === 'idle') && children !== 'none'
}

/** Summarises child states into the liveness the fold needs; settled children do not count. */
export function summarizeChildren(states: ReadonlyArray<'running' | 'completed' | 'failed' | 'interrupted' | 'unknown' | 'waiting' | 'monitoring'>): ChildWorkLiveness {
  if (states.includes('waiting')) return 'waiting'
  if (states.includes('running')) return 'working'
  if (states.includes('monitoring')) return 'monitoring'
  return 'none'
}
