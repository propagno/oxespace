import { AlertCircle, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent, ThreadTurn } from '../../../shared/types/thread'
import { threadTurnPresentation } from './threadTurnPresentation'
import { formatTurnSeconds, turnTimes } from './ThreadTurnFold'

/** Outcome, action count, duration and model of a finished turn. */
export function ThreadTurnTiming({ turn, events }: { turn?: ThreadTurn; events: ThreadEvent[] }) {
  const { t } = useTranslation('thread')
  // The time spent waiting for an approval or an answer is the person's, not the agent's.
  const times = turnTimes(turn, events)
  const worked = times ? Math.round(times.workedMs / 1000) : undefined, waited = times ? Math.round(times.waitedMs / 1000) : 0
  const summary = threadTurnPresentation(events)
  const status = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')?.status ?? turn?.status ?? 'interrupted'
  const warning = status === 'completed' && (summary.failedActions > 0 || summary.unconfirmedActions > 0)
  const background = events.filter(event => event.type === 'subagent' && event.state === 'running').length
  const outcome = status === 'completed'
    ? background ? t('turnTiming.completedBackground', { count: background }) : warning ? t('turnTiming.completedWarnings') : t('turnTiming.completed')
    : status === 'failed' ? t('turnTiming.failed') : t('turnTiming.interrupted')
  return <div className={`thread-turn-timing is-${warning ? 'warning' : status}`}><span className="thread-turn-outcome">{status === 'completed' ? <Check size={12} /> : <AlertCircle size={12} />}{outcome}</span>{summary.actionCount > 0 && <span>{t('turnTiming.actions', { count: summary.actionCount })}{summary.failedActions > 0 ? t('turnTiming.failedCount', { count: summary.failedActions }) : ''}{summary.unconfirmedActions > 0 ? t('turnTiming.unconfirmedCount', { count: summary.unconfirmedActions }) : ''}</span>}{worked !== undefined && <span title={waited ? t('turnTiming.workedTitle') : undefined}>{waited ? t('turnTiming.workedWaited', { worked: formatTurnSeconds(worked), waited: formatTurnSeconds(waited) }) : formatTurnSeconds(worked)}</span>}{turn?.configuration.model && <span>{turn.configuration.model}{turn.configuration.reasoningEffort ? ` · ${turn.configuration.reasoningEffort}` : ''}</span>}</div>
}
