/**
 * The window's half of the performance journal (1.5.1): which view a sample belongs to, its buckets, and what the
 * observers report to the main process (long frames, their blocking part, and real interactions only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PerfBatch, perfView, startPerfJournal } from '../src/lib/perfJournal'
import { setKeyboardView } from '../src/keyboard/keybindings'

type Callback = (list: { getEntries(): PerformanceEntry[] }) => void
const observers: Array<{ type: string; callback: Callback; options: Record<string, unknown> }> = []
class FakeObserver {
  static supportedEntryTypes = ['long-animation-frame', 'event']
  constructor(private readonly callback: Callback) {}
  observe(options: Record<string, unknown>): void { observers.push({ type: String(options.type), callback: this.callback, options }) }
  disconnect(): void { /* nothing to release */ }
}
const emit = (type: string, entries: Array<Record<string, unknown>>) => {
  for (const observer of observers.filter(item => item.type === type)) observer.callback({ getEntries: () => entries as unknown as PerformanceEntry[] })
}

afterEach(() => {
  observers.length = 0
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  setKeyboardView('code')
})

describe('performance journal, window half', () => {
  it('names the view, Settings over it, and an open dialog', () => {
    setKeyboardView('thread')
    expect(perfView()).toBe('thread')
    document.body.innerHTML = '<div role="dialog"></div>'
    expect(perfView()).toBe('thread:dialog')
    document.body.innerHTML = '<div class="settings-center"></div>'
    expect(perfView()).toBe('settings')
  })

  it('counts samples into the journal buckets and empties on take', () => {
    const batch = new PerfBatch()
    batch.add('frame:code', 60); batch.add('frame:code', 2500); batch.add('frame:code', Number.NaN)
    expect(batch.take()).toEqual({ stats: { 'frame:code': { n: 2, sum: 2560, max: 2500, b: [0, 0, 0, 1, 0, 0, 0, 0, 1] } } })
    expect(batch.take()).toBeNull()
  })

  it('reports long frames, their blocking part and real interactions, by view', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('PerformanceObserver', FakeObserver)
    const reportPerf = vi.fn(async () => undefined)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { diagnostics: { reportPerf } } })
    const stop = startPerfJournal(() => 'data')
    expect(observers.map(item => item.type)).toEqual(['long-animation-frame', 'event'])
    expect(observers[1].options).toMatchObject({ buffered: true, durationThreshold: 16 })
    emit('long-animation-frame', [{ duration: 120, blockingDuration: 70 }, { duration: 55, blockingDuration: 0 }])
    emit('event', [{ name: 'click', duration: 48, interactionId: 7 }, { name: 'pointermove', duration: 30, interactionId: 0 }, { name: 'Bad Name', duration: 30, interactionId: 3 }])
    expect(reportPerf).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(reportPerf).toHaveBeenCalledTimes(1)
    const [batch] = reportPerf.mock.calls[0] as unknown as [{ stats: Record<string, { n: number; max: number }> }]
    expect(Object.keys(batch.stats).sort()).toEqual(['block:data', 'frame:data', 'input:click:data'])
    expect(batch.stats['frame:data']).toMatchObject({ n: 2, max: 120 })
    vi.advanceTimersByTime(30_000)
    expect(reportPerf).toHaveBeenCalledTimes(1) // nothing new, nothing sent
    stop()
    vi.useRealTimers()
  })

  it('does nothing where the browser or the bridge has no support', () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { diagnostics: { reportPerf: vi.fn() } } })
    startPerfJournal()()
    expect(observers).toHaveLength(0)
  })
})
