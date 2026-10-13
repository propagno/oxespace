import { AlertCircle, Check } from 'lucide-react'
import type { ThreadEvent, ThreadTurn } from '../../../shared/types/thread'
import { threadTurnPresentation } from './threadTurnPresentation'

/** Outcome, action count, duration and model of a finished turn. */
export function ThreadTurnTiming({ turn, events }: { turn?: ThreadTurn; events: ThreadEvent[] }) {
  const seconds = turn?.startedAt && turn.completedAt ? Math.max(0, Math.round((turn.completedAt - turn.startedAt) / 1000)) : undefined
  const summary = threadTurnPresentation(events)
  const status = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')?.status ?? turn?.status ?? 'interrupted'
  const warning = status === 'completed' && (summary.failedActions > 0 || summary.unconfirmedActions > 0)
  const background = events.filter(event => event.type === 'subagent' && event.state === 'running').length
  return <div className={`thread-turn-timing is-${warning ? 'warning' : status}`}><span className="thread-turn-outcome">{status === 'completed' ? <Check size={12} /> : <AlertCircle size={12} />}{status === 'completed' ? background ? `Turn completed · ${background} background pending` : warning ? 'Completed with warnings' : 'Completed' : status === 'failed' ? 'Failed' : 'Interrupted'}</span>{summary.actionCount > 0 && <span>{summary.actionCount} {summary.actionCount === 1 ? 'action' : 'actions'}{summary.failedActions > 0 ? ` · ${summary.failedActions} failed` : ''}{summary.unconfirmedActions > 0 ? ` · ${summary.unconfirmedActions} unconfirmed` : ''}</span>}{seconds !== undefined && <span>{seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}</span>}{turn?.configuration.model && <span>{turn.configuration.model}{turn.configuration.reasoningEffort ? ` · ${turn.configuration.reasoningEffort}` : ''}</span>}</div>
}
