import { Check, ChevronDown, Circle, ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent } from '../../../shared/types/thread'
import { Spinner } from '../../ui'

export function ThreadPlan({ event }: { event: Extract<ThreadEvent, { type: 'plan' }> }) {
  const { t } = useTranslation('thread')
  const completed = event.steps.filter(step => step.status === 'completed').length
  return <details className="thread-plan" open={event.steps.length <= 5 || event.steps.some(step => step.status === 'inProgress')}><summary><ListChecks size={14} /><strong>{t('plan.title')}</strong><small>{t('plan.progress', { done: completed, total: event.steps.length })}</small><ChevronDown size={14} /></summary>
    {event.explanation && <p>{event.explanation}</p>}<ol>{event.steps.map((step, index) => <li key={index} className={`is-${step.status}`}>{step.status === 'completed' ? <Check size={14} /> : step.status === 'inProgress' ? <Spinner size="sm" label={t('plan.inProgress')} /> : <Circle size={12} />}<span>{step.label}</span></li>)}</ol>
  </details>
}
