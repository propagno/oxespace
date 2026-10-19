import { ChevronRight, ListChecks } from 'lucide-react'
import type { ThreadTurn } from '../../../shared/types/thread'
import type { ThreadTurnFold } from './threadTimelineModel'

/** `65 s` → `1m 5s`, the same wording as the turn footer. */
export function formatTurnSeconds(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
}

/** The label of a folded turn: "Completed 7 steps in 1m 3s". */
export function turnFoldLabel(steps: number, turn?: ThreadTurn): string {
  const seconds = typeof turn?.startedAt === 'number' && typeof turn.completedAt === 'number' ? Math.max(0, Math.round((turn.completedAt - turn.startedAt) / 1000)) : undefined
  return `Completed ${steps} ${steps === 1 ? 'step' : 'steps'}${seconds !== undefined ? ` in ${formatTurnSeconds(seconds)}` : ''}`
}

/**
 * The intermediate work of a finished turn, folded under one line so the conversation reads as questions and
 * answers. It is a real button: the expanded state is announced, and the rows reappear right below it.
 */
export function ThreadTurnFoldRow({ fold, turn, onToggle }: { fold: ThreadTurnFold; turn?: ThreadTurn; onToggle: () => void }) {
  return <button type="button" className="thread-turn-fold" aria-expanded={fold.expanded} onClick={onToggle}
    title={fold.expanded ? 'Hide the steps of this turn' : 'Show every step of this turn'} data-testid="thread-turn-fold">
    <ChevronRight size={14} aria-hidden="true" className="thread-turn-fold-chevron" />
    <ListChecks size={14} aria-hidden="true" />
    <span>{turnFoldLabel(fold.steps, turn)}</span>
  </button>
}
