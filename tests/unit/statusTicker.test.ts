import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StatusTicker } from '../../src/hooks/useStatusTicker'

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('StatusTicker (F16)', () => {
  beforeEach(() => { vi.useFakeTimers(); setVisibility('visible') })
  afterEach(() => { vi.useRealTimers(); setVisibility('visible') })

  test('N subscribers hold one timer; a shared key refreshes once per period', () => {
    const ticker = new StatusTicker()
    const claude = vi.fn()
    const offs = Array.from({ length: 6 }, () => ticker.subscribe('credits:claude', 60_000, claude))
    const context = vi.fn()
    offs.push(ticker.subscribe('context:/repo', 30_000, context))
    expect(vi.getTimerCount()).toBe(1)
    expect(claude).toHaveBeenCalledTimes(1)
    expect(context).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(context).toHaveBeenCalledTimes(2)
    expect(claude).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(context).toHaveBeenCalledTimes(3)
    expect(claude).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    for (const off of offs) off()
  })

  test('stops when no subscriber is left, and an unsubscribe twice is harmless', () => {
    const ticker = new StatusTicker()
    const run = vi.fn()
    const a = ticker.subscribe('k', 1_000, run)
    const b = ticker.subscribe('k', 1_000, run)
    a(); a()
    expect(ticker.pendingTimers).toBe(1)
    b()
    expect(ticker.pendingTimers).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(5_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  test('pauses while the window is hidden and refreshes what fell due when it is shown', () => {
    const ticker = new StatusTicker()
    const run = vi.fn()
    const off = ticker.subscribe('k', 1_000, run)
    setVisibility('hidden')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    expect(run).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    off()
  })

  test('window focus refreshes every key at once and restarts their period', () => {
    const ticker = new StatusTicker()
    const a = vi.fn()
    const b = vi.fn()
    const offs = [ticker.subscribe('a', 60_000, a), ticker.subscribe('b', 30_000, b)]
    vi.advanceTimersByTime(10_000)
    window.dispatchEvent(new Event('focus'))
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 2])
    vi.advanceTimersByTime(29_000)
    expect(b).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1_000)
    expect(b).toHaveBeenCalledTimes(3)
    for (const off of offs) off()
    window.dispatchEvent(new Event('focus'))
    expect(a).toHaveBeenCalledTimes(2)
  })
})
