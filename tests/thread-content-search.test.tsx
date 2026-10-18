import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadContentSearch } from '../src/hooks/useThreadContentSearch'

describe('useThreadContentSearch', () => {
  const search = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    search.mockReset()
    ;(window as unknown as { oxe: unknown }).oxe = { session: { search } }
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as { oxe?: unknown }).oxe
  })

  it('does not search for short queries', async () => {
    const { result } = renderHook(() => useThreadContentSearch('ab'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(search).not.toHaveBeenCalled()
    expect(result.current.size).toBe(0)
  })

  it('returns the native session ids whose content matched, after a debounce', async () => {
    search.mockResolvedValue({ hits: [{ sessionId: 's1' }, { sessionId: 's2' }], mode: 'all', indexedSessions: 2, indexing: false })
    const { result } = renderHook(() => useThreadContentSearch('websocket'))
    expect(search).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await waitFor(() => expect(result.current.has('s1')).toBe(true))
    expect(result.current.has('s2')).toBe(true)
    expect(search).toHaveBeenCalledWith({ query: 'websocket', limit: 50 })
  })

  it('clears matches when the query becomes too short and tolerates a failing index', async () => {
    search.mockResolvedValue({ hits: [{ sessionId: 's1' }], mode: 'all', indexedSessions: 1, indexing: false })
    const { result, rerender } = renderHook(({ q }) => useThreadContentSearch(q), { initialProps: { q: 'websocket' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    await waitFor(() => expect(result.current.size).toBe(1))
    rerender({ q: 'we' })
    await waitFor(() => expect(result.current.size).toBe(0))

    search.mockRejectedValue(new Error('index unavailable'))
    rerender({ q: 'reconnect' })
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(result.current.size).toBe(0)
  })
})
