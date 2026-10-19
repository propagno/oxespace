import { Check, ChevronDown, Circle, ListChecks, Loader2 } from 'lucide-react'
import type { ThreadEvent } from '../../../shared/types/thread'

type PlanEvent = Extract<ThreadEvent, { type: 'plan' }>

/**
 * The plan of the latest turn while it still has steps to do, or null. Only the latest turn counts: an old
 * plan the agent left unfinished is history, not current work.
 */
export function activePlan(events: ThreadEvent[]): PlanEvent | null {
  let lastPrompt = -1
  events.forEach((event, index) => { if (event.type === 'message' && event.role === 'user') lastPrompt = index })
  const plan = events.slice(lastPrompt + 1).filter((event): event is PlanEvent => event.type === 'plan').at(-1)
  return plan && plan.steps.some(step => step.status !== 'completed') ? plan : null
}

/**
 * The current step of the agent's plan, pinned above the composer so it stays in view while the
 * conversation scrolls (the timeline keeps the full plan card too).
 */
export function ThreadDockPlan({ events }: { events: ThreadEvent[] }) {
  const plan = activePlan(events)
  if (!plan) return null
  const done = plan.steps.filter(step => step.status === 'completed').length
  const current = plan.steps.find(step => step.status === 'inProgress') ?? plan.steps.find(step => step.status === 'pending')
  return <details className="thread-dock-plan" data-testid="thread-dock-plan">
    <summary aria-label={`Plan, ${done} of ${plan.steps.length} done${current ? `. Now: ${current.label}` : ''}`}>
      <ListChecks size={14} aria-hidden="true" />
      <strong>Plan {done}/{plan.steps.length}</strong>
      {current && <span className="thread-dock-plan-current">{current.label}</span>}
      <ChevronDown size={14} aria-hidden="true" className="thread-dock-plan-chevron" />
    </summary>
    <ol>{plan.steps.map((step, index) => <li key={index} className={`is-${step.status}`}>
      {step.status === 'completed' ? <Check size={13} aria-hidden="true" /> : step.status === 'inProgress' ? <Loader2 size={13} aria-hidden="true" className="thread-spin" /> : <Circle size={11} aria-hidden="true" />}
      <span>{step.label}</span>
    </li>)}</ol>
  </details>
}
