import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThreadSubagentActivity } from '../src/components/Threads/ThreadSubagentActivity'

const event = (state: 'running' | 'completed') => ({ type: 'subagent' as const, id: 't', action: 'Background command', state, receiverThreadIds: ['bash_1'], agents: [] })

describe('ThreadSubagentActivity stop', () => {
  it('offers Stop only for a running task when a handler is given', () => {
    const onStop = vi.fn()
    const { rerender } = render(<ThreadSubagentActivity event={event('running')} onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Background command' }))
    expect(onStop).toHaveBeenCalledOnce()
    rerender(<ThreadSubagentActivity event={event('completed')} onStop={onStop} />)
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
    rerender(<ThreadSubagentActivity event={event('running')} />)
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
  })

  it('disables Stop while an action is pending', () => {
    render(<ThreadSubagentActivity event={event('running')} onStop={vi.fn()} stopping />)
    expect(screen.getByRole('button', { name: 'Stop Background command' })).toBeDisabled()
  })
})
