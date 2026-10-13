import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ThreadAnnouncer, threadAnnouncement } from '../src/components/Threads/ThreadAnnouncer'
import type { ConversationThread } from '../shared/types/thread'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('threadAnnouncement', () => {
  it('speaks only on state changes worth hearing', () => {
    expect(threadAnnouncement({ status: 'idle' }, { status: 'running' }, 0)).toBe('The agent is working.')
    expect(threadAnnouncement({ status: 'running' }, { status: 'approval' }, 2)).toBe('The agent needs your input on 2 requests.')
    expect(threadAnnouncement({ status: 'approval' }, { status: 'running' }, 0)).toBeNull()
    expect(threadAnnouncement({ status: 'running' }, { status: 'idle', lastTurnStatus: 'completed' }, 0)).toBe('The agent finished.')
    expect(threadAnnouncement({ status: 'running' }, { status: 'failed' }, 0)).toBe('The turn failed.')
    expect(threadAnnouncement({ status: 'running' }, { status: 'running' }, 0)).toBeNull()
    expect(threadAnnouncement({ status: 'interrupted' }, { status: 'idle' }, 0)).toBeNull()
  })
})

describe('ThreadAnnouncer', () => {
  it('is silent on open, then throttles to the latest state', () => {
    vi.useFakeTimers()
    const thread = (status: ConversationThread['status'], lastTurnStatus?: ConversationThread['lastTurnStatus']) => ({ id: 't', status, lastTurnStatus }) as ConversationThread
    const { rerender } = render(<ThreadAnnouncer thread={thread('idle')} pendingRequests={0} />)
    expect(screen.getByRole('status')).toHaveTextContent('')
    rerender(<ThreadAnnouncer thread={thread('running')} pendingRequests={0} />)
    act(() => { vi.advanceTimersByTime(0) })
    expect(screen.getByRole('status')).toHaveTextContent('The agent is working.')
    rerender(<ThreadAnnouncer thread={thread('approval')} pendingRequests={1} />)
    rerender(<ThreadAnnouncer thread={thread('running')} pendingRequests={0} />)
    rerender(<ThreadAnnouncer thread={thread('idle', 'completed')} pendingRequests={0} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('The agent is working.')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('status')).toHaveTextContent('The agent finished.')
  })
})
