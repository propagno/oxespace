import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { StatusSignal, type SignalState } from '../../ui'

/** Plan step → signal. Labels are the glossary §5 state words (pending uses idle; that list has no waiting). */
const STEP: Record<'completed' | 'inProgress' | 'pending', { state: SignalState; word: 'completed' | 'running' | 'idle' }> = {
  completed: { state: 'done', word: 'completed' },
  inProgress: { state: 'working', word: 'running' },
  pending: { state: 'waiting', word: 'idle' }
}

/** The plan card: numbered steps, a state signal on each, a thin bar and the count (AG-11 5.1). */
export function ThreadPlan({ event }: { event: Extract<ThreadEvent, { type: 'plan' }> }) {
  const { t } = useTranslation('thread')
  const total = event.steps.length
  const done = event.steps.filter(step => step.status === 'completed').length
  return <section className="thread-plan" data-ui="plan-card">
    <header className="thread-plan-head">
      <strong>{t('plan.title')}</strong>
      <span className="thread-plan-count">{done}/{total}</span>
    </header>
    <div className="thread-plan-bar" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={t('plan.progress', { done, total })}>
      <span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
    </div>
    {event.explanation && <p>{event.explanation}</p>}
    <ol>{event.steps.map((step, index) => {
      const signal = STEP[step.status] ?? STEP.pending
      return <li key={index} className={`is-${step.status}`}><StatusSignal state={signal.state} label={t(`status.${signal.word}`)} size={14} /><span>{step.label}</span></li>
    })}</ol>
  </section>
}
