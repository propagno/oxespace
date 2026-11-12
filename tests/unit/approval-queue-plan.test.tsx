import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadRequest } from '../../shared/types/thread'
import { ApprovalQueue } from '../../src/components/Approvals/ApprovalQueue'

afterEach(cleanup)

const plan = '# Plan: quantity-aware `total()`\n\n## Context\n\n- Multiply each price by its quantity\n\n```js\nreturn price * qty\n```'
// A conversation's request as it arrives: the plan's own text, with its impact.
const planRequest: ThreadRequest = {
  id: 'plan', nativeId: 'plan', nativeMethod: 'can_use_tool:ExitPlanMode', kind: 'approval', title: 'Review the plan', detail: plan, generation: 1, createdAt: 1, state: 'pending',
  availableDecisions: ['accept', 'decline'], impact: { where: 'shop-api', affects: { count: 1, unit: 'files' }, reversible: true, risk: 'low', kind: 'file', text: plan, lang: 'text' }
}
const command: ThreadRequest = {
  id: 'cmd', nativeId: 'cmd', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run a command', command: 'npm run test', generation: 1, createdAt: 2, state: 'pending',
  availableDecisions: ['accept', 'decline'], impact: { where: 'shop-api', affects: { count: null, unit: 'files' }, reversible: true, risk: 'low', kind: 'command', text: 'npm run test', lang: 'shell' }
}

describe('the approval queue shows a plan to review as prose (CHAT-10)', () => {
  it('renders the plan, with no raw Markdown; a command keeps its exact text in a block', async () => {
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals: { preview: vi.fn(async () => null) } } })
    render(<ApprovalQueue items={[{ request: planRequest, agent: 'Claude', conversation: 'Quantity' }, { request: command, agent: 'Claude', conversation: 'Quantity' }]} decided={[]} onRespond={vi.fn(async () => undefined)} />)
    // The oldest request is selected: the plan.
    const shown = await screen.findByTestId('queue-plan')
    expect(within(shown).getByRole('heading', { name: 'Plan: quantity-aware total()' })).toBeInTheDocument()
    expect(within(shown).getByRole('heading', { name: 'Context' })).toBeInTheDocument()
    expect(within(shown).getByRole('listitem')).toHaveTextContent('Multiply each price by its quantity')
    expect(shown).not.toHaveTextContent('## Context')
    expect(shown).not.toHaveTextContent('```')
    // The plan's own code block is still code.
    expect(within(shown).getByText('return price * qty')).toBeInTheDocument()
  })
})
