import { afterEach, describe, expect, it, vi } from 'vitest'
import { preloadDisabled, preloadSkipReason, preloadTargets, recentView, rememberView, runIdlePreload, type PreloadTarget } from '../src/lib/idlePreload'
import { scheduleIdle } from '../src/lib/preloadSchedule'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })

const fakeLoaders = () => {
  const calls: PreloadTarget[] = []
  const loader = (target: PreloadTarget) => () => { calls.push(target); return Promise.resolve() }
  return { calls, loaders: { thread: loader('thread'), data: loader('data'), pods: loader('pods'), post: loader('post'), settings: loader('settings') } }
}
const desktop = { navigator: { deviceMemory: 8, getBattery: async () => ({ charging: true }) }, performance: { memory: { usedJSHeapSize: 50, jsHeapSizeLimit: 1000 } } }

describe('idle preload', () => {
  it('targets only the most recent lazy view, then Settings', () => {
    expect(preloadTargets('data')).toEqual(['data', 'settings'])
    expect(preloadTargets('thread')).toEqual(['thread', 'settings'])
    expect(preloadTargets('code')).toEqual(['settings'])
    expect(preloadTargets(null)).toEqual(['settings'])
    expect(preloadTargets('anything')).toEqual(['settings'])
  })

  it('loads the most recent view and Settings, and nothing else', async () => {
    const { calls, loaders } = fakeLoaders()
    expect(await runIdlePreload(() => false, { recent: 'pods', env: desktop, loaders })).toEqual(['pods', 'settings'])
    expect(calls).toEqual(['pods', 'settings'])
  })

  it('skips everything on battery, with little memory or a heap mostly used', async () => {
    const onBattery = { ...desktop, navigator: { ...desktop.navigator, getBattery: async () => ({ charging: false }) } }
    const smallMachine = { ...desktop, navigator: { ...desktop.navigator, deviceMemory: 4 } }
    const fullHeap = { ...desktop, performance: { memory: { usedJSHeapSize: 800, jsHeapSizeLimit: 1000 } } }
    expect(await preloadSkipReason(onBattery)).toBe('on-battery')
    expect(await preloadSkipReason(smallMachine)).toBe('low-device-memory')
    expect(await preloadSkipReason(fullHeap)).toBe('high-memory-use')
    for (const env of [onBattery, smallMachine, fullHeap]) {
      const { calls, loaders } = fakeLoaders()
      expect(await runIdlePreload(() => false, { recent: 'data', env, loaders })).toEqual([])
      expect(calls).toEqual([])
    }
  })

  it('goes ahead when the APIs are missing or fail', async () => {
    expect(await preloadSkipReason({})).toBeNull()
    expect(await preloadSkipReason({ navigator: { getBattery: () => Promise.reject(new Error('denied')) } })).toBeNull()
    const throwing = { get navigator(): never { throw new Error('blocked') } }
    expect(await preloadSkipReason(throwing)).toBeNull()
  })

  it('stops when cancelled, before starting or between chunks', async () => {
    const before = fakeLoaders()
    expect(await runIdlePreload(() => true, { recent: 'data', env: desktop, loaders: before.loaders })).toEqual([])
    expect(before.calls).toEqual([])
    const between = fakeLoaders()
    let cancelled = false
    const loaders = { ...between.loaders, data: () => { cancelled = true; return between.loaders.data() } }
    expect(await runIdlePreload(() => cancelled, { recent: 'data', env: desktop, loaders })).toEqual(['data'])
    expect(between.calls).toEqual(['data'])
  })

  it('a failing chunk does not stop the next one', async () => {
    const { calls, loaders } = fakeLoaders()
    expect(await runIdlePreload(() => false, { recent: 'post', env: desktop, loaders: { ...loaders, post: () => Promise.reject(new Error('offline')) } })).toEqual(['post', 'settings'])
    expect(calls).toEqual(['settings'])
  })

  it('schedules at idle with a 2 s deadline, falls back to a timer, and cancels', () => {
    const idle = vi.fn((_task: () => void, _options: { timeout: number }) => 7)
    const cancelIdle = vi.fn()
    vi.stubGlobal('requestIdleCallback', idle)
    vi.stubGlobal('cancelIdleCallback', cancelIdle)
    const stop = scheduleIdle(() => undefined)
    expect(idle.mock.calls[0][1]).toEqual({ timeout: 2_000 })
    stop()
    expect(cancelIdle).toHaveBeenCalledWith(7)

    vi.unstubAllGlobals()
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.useFakeTimers()
    const task = vi.fn()
    scheduleIdle(task)
    vi.advanceTimersByTime(2_000)
    expect(task).toHaveBeenCalledOnce()
    const cancelled = vi.fn()
    scheduleIdle(cancelled)()
    vi.advanceTimersByTime(5_000)
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('remembers the most recent view and honours the off switch', () => {
    expect(recentView()).toBeNull()
    rememberView('post')
    expect(recentView()).toBe('post')
    expect(preloadDisabled()).toBe(false)
    localStorage.setItem('oxe.preload', 'off')
    expect(preloadDisabled()).toBe(true)
  })

  it('reads the most recent view itself, and does nothing when switched off', async () => {
    rememberView('thread')
    const on = fakeLoaders()
    expect(await runIdlePreload(() => false, { env: desktop, loaders: on.loaders })).toEqual(['thread', 'settings'])
    localStorage.setItem('oxe.preload', 'off')
    const off = fakeLoaders()
    expect(await runIdlePreload(() => false, { env: desktop, loaders: off.loaders })).toEqual([])
    expect(off.calls).toEqual([])
  })
})
