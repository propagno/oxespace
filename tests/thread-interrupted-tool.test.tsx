import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ThreadActivityGroup } from '../src/components/Threads/ThreadActivityGroup'
import type { ThreadEvent } from '../shared/types/thread'
afterEach(cleanup)

it('shows an interrupted tool with Continue and Dismiss, and hides them once handled', () => {
  const run: string[] = []
  const tool: Extract<ThreadEvent, { type: 'tool' }> = { type: 'tool', id: 'rm', name: 'Bash', state: 'unknown', interrupted: true, detail: 'rm -rf build', output: 'Interrupted: the app closed while this was running' }
  const view = render(<ThreadActivityGroup events={[tool]} onResolveInterrupted={command => run.push(command)} />)
  fireEvent.click(screen.getByText('Ran command'))
  expect(screen.getByText('Interrupted', { selector: 'span' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(run).toEqual(['/continue-interrupted rm', '/dismiss-interrupted rm'])
  view.rerender(<ThreadActivityGroup events={[{ ...tool, interruptedHandled: 'dismissed' }]} onResolveInterrupted={command => run.push(command)} />)
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  expect(screen.getByText(/Nothing was run again/)).toBeInTheDocument()
})
