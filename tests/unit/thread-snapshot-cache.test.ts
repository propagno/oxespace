import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSnapshotCache } from '../../electron/main/services/conversation/thread-snapshot-cache'
import type { ThreadSnapshot } from '../../shared/types/thread'

const snapshot = (id: string): ThreadSnapshot => ({ thread: { id } as ThreadSnapshot['thread'], events: [] })

describe('ThreadSnapshotCache', () => {
  const held = new Set<string>()
  let cache: ThreadSnapshotCache
  beforeEach(() => { vi.useFakeTimers(); held.clear(); cache = new ThreadSnapshotCache(id => held.has(id)) })
  afterEach(() => { cache.close(); vi.useRealTimers() })

  it('keeps only the most recent idle conversation', () => {
    for (const id of ['a', 'b', 'c']) { cache.set(id, snapshot(id)); cache.touch(id); cache.trim() }
    expect([...cache.keys()]).toEqual(['c'])
  })

  it('never drops a conversation with work in flight', () => {
    held.add('a')
    for (const id of ['a', 'b', 'c']) { cache.set(id, snapshot(id)); cache.touch(id); cache.trim() }
    expect([...cache.keys()].sort()).toEqual(['a', 'c'])
  })

  it('releases an idle conversation after the idle time without another read', () => {
    cache.set('a', snapshot('a')); cache.touch('a'); cache.trim()
    vi.advanceTimersByTime(29_000)
    expect(cache.has('a')).toBe(true)
    vi.advanceTimersByTime(31_000)
    expect(cache.has('a')).toBe(false)
  })

  it('treats a read as use: the idle time restarts', () => {
    cache.set('a', snapshot('a')); cache.touch('a'); cache.trim()
    vi.advanceTimersByTime(20_000)
    cache.touch('a')
    vi.advanceTimersByTime(20_000)
    cache.trim()
    expect(cache.has('a')).toBe(true)
  })

  it('stops its timer when closed', () => {
    cache.set('a', snapshot('a')); cache.trim()
    cache.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})
