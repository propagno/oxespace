import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { activePlan, ThreadDockPlan } from '../src/components/Threads/ThreadDockPlan'

afterEach(cleanup)

const prompt = (id: string): ThreadEvent => ({ type: 'message', id, role: 'user', text: id })
const plan = (id: string, statuses: Array<'pending' | 'inProgress' | 'completed'>): ThreadEvent =>
  ({ type: 'plan', id, steps: statuses.map((status, index) => ({ label: `Step ${index + 1}`, status })) })

describe('pinned plan above the composer', () => {
  it('shows the latest plan of the latest turn while a step is left', () => {
    expect(activePlan([prompt('a'), plan('p1', ['completed', 'inProgress', 'pending'])])?.id).toBe('p1')
    expect(activePlan([prompt('a'), plan('p1', ['completed', 'inProgress']), plan('p2', ['completed', 'completed', 'inProgress'])])?.id).toBe('p2')
  })

  it('hides a finished plan, and a plan an earlier turn left unfinished', () => {
    expect(activePlan([prompt('a'), plan('p1', ['completed', 'completed'])])).toBeNull()
    expect(activePlan([prompt('a'), plan('p1', ['completed', 'pending']), prompt('b')])).toBeNull()
    expect(activePlan([])).toBeNull()
  })

  it('names the progress and the current step, and lists every step when opened', () => {
    render(<ThreadDockPlan events={[prompt('a'), plan('p1', ['completed', 'inProgress', 'pending'])]} />)
    const strip = screen.getByTestId('thread-dock-plan')
    expect(strip).toHaveTextContent('Plan 1/3')
    expect(strip.querySelector('.thread-dock-plan-current')).toHaveTextContent('Step 2')
    expect(strip.querySelector('summary')).toHaveAttribute('aria-label', 'Plan, 1 of 3 done. Now: Step 2')
    expect(strip.querySelectorAll('li')).toHaveLength(3)
  })
})
