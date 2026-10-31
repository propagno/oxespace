import { afterEach, describe, expect, it, vi } from 'vitest'
import { preloadDisabled, preloadTargets, recentView, rememberView, runIdlePreload, viewSkipReason, type PreloadTarget } from '../src/lib/idlePreload'
import { scheduleIdle } from '../src/lib/preloadSchedule'
import { chunk } from '../src/lib/chunk'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })

const fakeLoaders = () => {
  const calls: PreloadTarget[] = []
  const loader = (target: PreloadTarget) => () => { calls.push(target); return Promise.resolve() }
  return { calls, loaders: { thread: loader('thread'), data: loader('data'), pods: loader('pods'), post: loader('post'), settings: loader('settings') } }
}
const big = { navigator: { deviceMemory: 8, getBattery: async () => ({ charging: true }) }, performance: { memory: { usedJSHeapSize: 50, jsHeapSizeLimit: 1000 } } }

describe('idle preload', () => {
  it('preloads only the most recent lazy view, then Settings, on an 8 GB machine', async () => {
    expect((await preloadTargets('data', big)).targets).toEqual(['data', 'settings'])
    expect((await preloadTargets('thread', big)).targets).toEqual(['thread', 'settings'])
    expect(await preloadTargets('code', big)).toEqual({ targets: ['settings'], viewSkipped: 'no-recent-view' })
    expect((await preloadTargets(null, big)).targets).toEqual(['settings'])
    const { calls, loaders } = fakeLoaders()
    expect(await runIdlePreload(() => false, { recent: 'pods', env: big, loaders })).toEqual(['pods', 'settings'])
    expect(calls).toEqual(['pods', 'settings'])
  })

  it('leaves the view out below 8 GB, without deviceMemory, on battery or with a mostly used heap; Settings still loads', async () => {
    const cases = {
      'low-device-memory': { ...big, navigator: { ...big.navigator, deviceMemory: 4 } },
      'device-memory-unknown': { ...big, navigator: { getBattery: big.navigator.getBattery } },
      'on-battery': { ...big, navigator: { ...big.navigator, getBattery: async () => ({ charging: false }) } },
      'high-memory-use': { ...big, performance: { memory: { usedJSHeapSize: 800, jsHeapSizeLimit: 1000 } } }
    }
    for (const [reason, env] of Object.entries(cases)) {
      expect(await viewSkipReason(env)).toBe(reason)
      const { calls, loaders } = fakeLoaders()
      expect(await runIdlePreload(() => false, { recent: 'data', env, loaders })).toEqual(['settings'])
      expect(calls).toEqual(['settings'])
    }
  })

  it('a missing or failing battery or heap API does not hold the view back; an unreadable deviceMemory does', async () => {
    expect(await viewSkipReason({ navigator: { deviceMemory: 8 } })).toBeNull()
    expect(await viewSkipReason({ navigator: { deviceMemory: 8, getBattery: () => Promise.reject(new Error('denied')) } })).toBeNull()
    const throwing = { get navigator(): never { throw new Error('blocked') } }
    expect(await viewSkipReason(throwing)).toBe('device-memory-unknown')
  })

  it('stops when cancelled, before starting or between chunks', async () => {
    const before = fakeLoaders()
    expect(await runIdlePreload(() => true, { recent: 'data', env: big, loaders: before.loaders })).toEqual([])
    expect(before.calls).toEqual([])
    const between = fakeLoaders()
    let cancelled = false
    const loaders = { ...between.loaders, data: () => { cancelled = true; return between.loaders.data() } }
    expect(await runIdlePreload(() => cancelled, { recent: 'data', env: big, loaders })).toEqual(['data'])
    expect(between.calls).toEqual(['data'])
  })

  it('a failing chunk does not stop the next one', async () => {
    const { calls, loaders } = fakeLoaders()
    expect(await runIdlePreload(() => false, { recent: 'post', env: big, loaders: { ...loaders, post: () => Promise.reject(new Error('offline')) } })).toEqual(['post', 'settings'])
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

  it('remembers the most recent view, reads it itself and does nothing when switched off', async () => {
    expect(recentView()).toBeNull()
    rememberView('thread')
    expect(recentView()).toBe('thread')
    const on = fakeLoaders()
    expect(await runIdlePreload(() => false, { env: big, loaders: on.loaders })).toEqual(['thread', 'settings'])
    expect(preloadDisabled()).toBe(false)
    localStorage.setItem('oxe.preload', 'off')
    expect(preloadDisabled()).toBe(true)
    const off = fakeLoaders()
    expect(await runIdlePreload(() => false, { env: big, loaders: off.loaders })).toEqual([])
    expect(off.calls).toEqual([])
  })

  it('a chunk loads once, remembers its module and can be retried after a failure', async () => {
    let attempts = 0
    const source = chunk(async () => { attempts++; if (attempts === 1) throw new Error('offline'); return { ok: true } })
    await expect(source.load()).rejects.toThrow('offline')
    expect(source.get()).toBeUndefined()
    await expect(source.load()).resolves.toEqual({ ok: true })
    await source.load()
    expect(attempts).toBe(2)
    expect(source.get()).toEqual({ ok: true })
  })
})
