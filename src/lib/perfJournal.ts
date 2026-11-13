import { getKeyboardView } from '../keyboard/keybindings'

/**
 * The window's half of the performance journal (1.5.1; the main process keeps the file, see perf-journal.ts).
 * Two browser measurements, by view and never by content:
 *  - long animation frames (over 50 ms): `frame:<view>` is the frame, `block:<view>` the part that held input back;
 *  - event timing: `input:<event>:<view>`, from a click or key press to the next painted frame, from 16 ms up.
 * Samples are counted into the journal's buckets here and reported every 30 seconds, and when the window hides.
 * Loaded after the first screen has painted (startupTiming.ts), so it costs the start nothing.
 */
const BUCKETS = [16, 33, 50, 100, 200, 500, 1000, 2000]
const REPORT_MS = 30_000
const EVENT = /^[a-z]{1,16}$/

interface Stat { n: number; sum: number; max: number; b: number[] }

/** Where the person was: the view, Settings over it, and whether a dialog was open. */
export function perfView(doc: Document = document): string {
  const view = doc.querySelector('.settings-center') ? 'settings' : getKeyboardView()
  return doc.querySelector('[role="dialog"]') ? `${view}:dialog` : view
}

export class PerfBatch {
  private stats = new Map<string, Stat>()

  add(key: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0 || this.stats.size >= 64 && !this.stats.has(key)) return
    const stat = this.stats.get(key) ?? { n: 0, sum: 0, max: 0, b: new Array(BUCKETS.length + 1).fill(0) }
    stat.n++; stat.sum += ms; stat.max = Math.max(stat.max, ms)
    const slot = BUCKETS.findIndex(bound => ms < bound)
    stat.b[slot < 0 ? BUCKETS.length : slot]++
    this.stats.set(key, stat)
  }

  /** The counts so far, emptied; null when nothing was measured. */
  take(): { stats: Record<string, Stat> } | null {
    if (!this.stats.size) return null
    const stats = Object.fromEntries(this.stats)
    this.stats.clear()
    return { stats }
  }
}

interface FrameEntry extends PerformanceEntry { blockingDuration?: number }
interface InputEntry extends PerformanceEntry { interactionId?: number }

let started = false

/** Starts observing once; returns a stop function (tests, and a window that unloads). */
export function startPerfJournal(view: () => string = perfView): () => void {
  const supported = typeof PerformanceObserver === 'undefined' ? [] : PerformanceObserver.supportedEntryTypes ?? []
  const report = window.oxe?.diagnostics?.reportPerf
  if (started || !report || !supported.length) return () => undefined
  started = true
  const batch = new PerfBatch()
  const observers: PerformanceObserver[] = []
  const observe = (type: string, options: PerformanceObserverInit & { durationThreshold?: number }, read: (entry: PerformanceEntry, where: string) => void): void => {
    if (!supported.includes(type)) return
    try {
      const observer = new PerformanceObserver(list => { const where = view(); for (const entry of list.getEntries()) read(entry, where) })
      observer.observe({ type, buffered: true, ...options })
      observers.push(observer)
    } catch { /* an entry type this Chromium lists but refuses: the other one still measures */ }
  }
  observe('long-animation-frame', {}, (entry, where) => {
    batch.add(`frame:${where}`, entry.duration)
    const blocking = (entry as FrameEntry).blockingDuration
    if (blocking && blocking > 0) batch.add(`block:${where}`, blocking)
  })
  observe('event', { durationThreshold: 16 }, (entry, where) => {
    // Only real interactions (a click, a key press), never hovers or scrolls without one.
    if (!(entry as InputEntry).interactionId || !EVENT.test(entry.name)) return
    batch.add(`input:${entry.name}:${where}`, entry.duration)
  })
  const send = (): void => {
    const taken = batch.take()
    if (taken) void report(taken).catch(() => undefined)
  }
  const timer = window.setInterval(send, REPORT_MS)
  const hidden = (): void => { if (document.visibilityState === 'hidden') send() }
  document.addEventListener('visibilitychange', hidden)
  return () => {
    send()
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', hidden)
    for (const observer of observers) observer.disconnect()
    started = false
  }
}
