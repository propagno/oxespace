import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'
import { supersededTurnIds, ThreadDockRewind } from '../src/components/Threads/ThreadDockRewind'

afterEach(cleanup)

const snapshot = (rewind?: { turnId: string; removedTurns: number }) => ({
  thread: { id: 't', ...(rewind ? { rewind: { ...rewind, at: 1 } } : {}) },
  turns: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  events: []
}) as unknown as ThreadSnapshot

describe('a pending rewind', () => {
  it('sets aside the target turn and every later one, and nothing without a rewind', () => {
    expect([...supersededTurnIds(snapshot({ turnId: 'b', removedTurns: 2 }))]).toEqual(['b', 'c'])
    expect(supersededTurnIds(snapshot()).size).toBe(0)
    expect(supersededTurnIds(snapshot({ turnId: 'gone', removedTurns: 1 })).size).toBe(0)
  })

  it('says what the next message confirms and offers Redo', () => {
    const onRedo = vi.fn()
    render(<ThreadDockRewind snapshot={snapshot({ turnId: 'b', removedTurns: 2 })} pending={false} onRedo={onRedo} />)
    expect(screen.getByRole('status')).toHaveTextContent('Rewound 2 turns. They leave the conversation when you send your next message.')
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(onRedo).toHaveBeenCalled()
  })

  it('shows nothing when no rewind is pending', () => {
    render(<ThreadDockRewind snapshot={snapshot()} pending={false} onRedo={() => {}} />)
    expect(screen.queryByTestId('thread-dock-rewind')).toBeNull()
  })
})
