import { Check, ChevronDown, Circle, ListChecks, Loader2 } from 'lucide-react'
import type { ThreadEvent } from '../../../shared/types/thread'

export function ThreadPlan({ event }: { event: Extract<ThreadEvent, { type: 'plan' }> }) {
  const completed = event.steps.filter(step => step.status === 'completed').length
  return <details className="thread-plan" open={event.steps.length <= 5 || event.steps.some(step => step.status === 'inProgress')}><summary><ListChecks size={14} /><strong>Plan</strong><small>{completed}/{event.steps.length} completed</small><ChevronDown size={13} /></summary>
    {event.explanation && <p>{event.explanation}</p>}<ol>{event.steps.map((step, index) => <li key={index} className={`is-${step.status}`}>{step.status === 'completed' ? <Check size={14} /> : step.status === 'inProgress' ? <Loader2 size={14} className="thread-spin" /> : <Circle size={12} />}<span>{step.label}</span></li>)}</ol>
  </details>
}
