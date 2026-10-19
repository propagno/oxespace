import { ChevronRight, ListChecks } from 'lucide-react'
import type { ThreadEvent, ThreadTurn } from '../../../shared/types/thread'
import type { ThreadTurnFold } from './threadTimelineModel'

/** `65 s` → `1m 5s`, the same wording as the turn footer. */
export function formatTurnSeconds(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

/**
 * How long a finished turn took, and how much of it was spent waiting for the person (approvals and
 * questions, from each request's creation to its answer). Overlapping requests count once.
 */
export function turnTimes(turn: ThreadTurn | undefined, events: readonly ThreadEvent[] = []): { totalMs: number; waitedMs: number; workedMs: number } | undefined {
  if (typeof turn?.startedAt !== 'number' || typeof turn.completedAt !== 'number') return undefined
  const start = turn.startedAt, end = Math.max(start, turn.completedAt)
  const resolvedAt = new Map<string, number>()
  for (const event of events) if (event.type === 'request-resolved' && typeof event.resolvedAt === 'number') resolvedAt.set(event.id, event.resolvedAt)
  const windows = events.flatMap(event => {
    if (event.type !== 'request') return []
    const from = Math.max(start, event.request.createdAt)
    const to = Math.min(end, event.request.resolvedAt ?? resolvedAt.get(event.id) ?? end)
    return to > from ? [[from, to] as const] : []
  }).sort((a, b) => a[0] - b[0])
  let waitedMs = 0, reach = start
  for (const [from, to] of windows) {
    if (to <= reach) continue
    waitedMs += to - Math.max(from, reach)
    reach = to
  }
  const totalMs = end - start
  return { totalMs, waitedMs, workedMs: totalMs - waitedMs }
}

/** The label of a folded turn: "Completed 7 steps in 1m 3s", counting the agent's time, not the wait for you. */
export function turnFoldLabel(steps: number, turn?: ThreadTurn, events?: readonly ThreadEvent[]): string {
  const times = turnTimes(turn, events)
  const seconds = times ? Math.round(times.workedMs / 1000) : undefined
  return `Completed ${steps} ${steps === 1 ? 'step' : 'steps'}${seconds !== undefined ? ` in ${formatTurnSeconds(seconds)}` : ''}`
}

/**
 * The intermediate work of a finished turn, folded under one line so the conversation reads as questions and
 * answers. It is a real button: the expanded state is announced, and the rows reappear right below it.
 */
export function ThreadTurnFoldRow({ fold, turn, events, onToggle }: { fold: ThreadTurnFold; turn?: ThreadTurn; events?: readonly ThreadEvent[]; onToggle: () => void }) {
  return <button type="button" className="thread-turn-fold" aria-expanded={fold.expanded} onClick={onToggle}
    title={fold.expanded ? 'Hide the steps of this turn' : 'Show every step of this turn'} data-testid="thread-turn-fold">
    <ChevronRight size={14} aria-hidden="true" className="thread-turn-fold-chevron" />
    <ListChecks size={14} aria-hidden="true" />
    <span>{turnFoldLabel(fold.steps, turn, events)}</span>
  </button>
}
