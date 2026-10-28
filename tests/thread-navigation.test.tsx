import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread } from '../shared/types/thread'
import { useThreadShortcuts } from '../src/hooks/useThreadShortcuts'
import { setKeyboardView } from '../src/keyboard/keybindings'
import { useThreadStore } from '../src/store/thread.store'
import { adjacentThreadId, navigableThreads } from '../src/utils/threadNavigation'

const thread = (id: string, over: Partial<ConversationThread> = {}): ConversationThread =>
  ({ id, projectId: 'p', updatedAt: 1, pinned: false, archived: false, ...over }) as unknown as ConversationThread

describe('thread navigation order', () => {
  it('puts pinned first, then newest, and hides archived and hidden-project threads', () => {
    const list = navigableThreads([
      thread('old', { updatedAt: 1 }),
      thread('new', { updatedAt: 9 }),
      thread('pin', { updatedAt: 2, pinned: true }),
      thread('gone', { archived: true }),
      thread('hid', { projectId: 'secret' })
    ], ['secret'])
    expect(list.map((t) => t.id)).toEqual(['pin', 'new', 'old'])
  })

  it('wraps around and handles an unselected or unknown current thread', () => {
    const list = [thread('a'), thread('b'), thread('c')]
    expect(adjacentThreadId(list, 'a', 1)).toBe('b')
    expect(adjacentThreadId(list, 'c', 1)).toBe('a')
    expect(adjacentThreadId(list, 'a', -1)).toBe('c')
    expect(adjacentThreadId(list, null, 1)).toBe('a')
    expect(adjacentThreadId(list, 'zzz', -1)).toBe('c')
    expect(adjacentThreadId([], 'a', 1)).toBeNull()
  })
})

describe('useThreadShortcuts', () => {
  afterEach(() => {
    useThreadStore.setState({ threads: [], selectedId: null, hiddenProjects: [] })
    setKeyboardView('code')
  })

  const press = (init: KeyboardEventInit): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  }

  it('moves between conversations and opens a new one only when enabled', () => {
    const select = vi.fn().mockResolvedValue(undefined)
    useThreadStore.setState({ threads: [thread('a', { updatedAt: 3 }), thread('b', { updatedAt: 2 })], selectedId: 'a', select } as never)
    const onNew = vi.fn()
    setKeyboardView('thread')
    const { rerender } = renderHook(({ on }) => useThreadShortcuts(on, onNew), { initialProps: { on: false } })

    press({ key: 'PageDown', ctrlKey: true, altKey: true })
    expect(select).not.toHaveBeenCalled()

    rerender({ on: true })
    press({ key: 'PageDown', ctrlKey: true, altKey: true })
    expect(select).toHaveBeenLastCalledWith('b')
    press({ key: 'PageUp', ctrlKey: true, altKey: true })
    expect(select).toHaveBeenLastCalledWith('b') // wraps from a to b
    press({ key: 'n', ctrlKey: true, altKey: true })
    expect(onNew).toHaveBeenCalledTimes(1)

    // Plain typing and other modifier combinations are left alone.
    press({ key: 'n' })
    press({ key: 'PageDown', ctrlKey: true })
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(2)
  })
})
