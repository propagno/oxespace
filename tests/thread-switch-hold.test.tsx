import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'
import { CONVERSATION_SKELETON_AFTER_MS, useThreadStore } from '../src/store/thread.store'
import { ThreadGrid } from '../src/components/Threads/ThreadGrid'

/**
 * F7.2, #363 review L4: while the next conversation loads, the one on screen keeps its own view (scroll position,
 * review state, history feedback), and the next one gets a fresh view of its own. Each mount stands for one view
 * instance, which is what owns the scroll anchor and saves under the conversation it shows.
 */
const mounts: string[] = []
vi.mock('../src/components/Threads/ThreadView', () => ({
  ThreadView: ({ threadId }: { threadId: string | null }) => {
    const shown = useThreadStore(state => state.snapshot?.thread.id ?? null)
    useEffect(() => { mounts.push(shown ?? 'none') }, [])
    return <div data-testid="thread-view" data-selected={threadId ?? ''} data-shown={shown ?? ''} />
  }
}))

const snapshot = (id: string): ThreadSnapshot => ({ thread: { id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'codex', title: id, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }) as unknown as ThreadSnapshot

let deliver: (value: ThreadSnapshot) => void = () => undefined
beforeEach(() => {
  vi.useFakeTimers()
  mounts.length = 0
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read: vi.fn(() => new Promise<ThreadSnapshot>(resolve => { deliver = resolve })) } } })
  const a = snapshot('conv-a'), b = snapshot('conv-b')
  useThreadStore.setState({ selectedId: a.thread.id, snapshot: a, threads: [a.thread, b.thread], snapshotCache: {}, snapshotCacheOrder: [], secondaryId: null, projects: [] })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('a conversation switch keeps the shown conversation’s own view', () => {
  it('within 300 ms: the same view stays mounted for conv-a, then a fresh one mounts for conv-b', async () => {
    render(<ThreadGrid />)
    expect(mounts).toEqual(['conv-a'])
    let opening!: Promise<void>
    act(() => { opening = useThreadStore.getState().select('conv-b') })
    const view = screen.getByTestId('thread-view')
    expect(view).toHaveAttribute('data-selected', 'conv-b')
    expect(view).toHaveAttribute('data-shown', 'conv-a')
    // Not remounted: the view (and the scroll anchor in it) still belongs to conv-a.
    expect(mounts).toEqual(['conv-a'])
    await act(async () => { deliver(snapshot('conv-b')); await opening })
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-shown', 'conv-b')
    expect(mounts).toEqual(['conv-a', 'conv-b'])
  })

  it('past 300 ms: the skeleton gets its own view for conv-b, which then fills in without another remount', async () => {
    render(<ThreadGrid />)
    let opening!: Promise<void>
    act(() => { opening = useThreadStore.getState().select('conv-b') })
    await act(async () => { vi.advanceTimersByTime(CONVERSATION_SKELETON_AFTER_MS) })
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-shown', '')
    expect(mounts).toEqual(['conv-a', 'none'])
    await act(async () => { deliver(snapshot('conv-b')); await opening })
    expect(screen.getByTestId('thread-view')).toHaveAttribute('data-shown', 'conv-b')
    // The view that showed the skeleton is conv-b's: it restores conv-b's saved position on its first snapshot.
    expect(mounts).toEqual(['conv-a', 'none'])
  })
})
