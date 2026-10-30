import { useEffect, useRef } from 'react'

/**
 * One timer per window for the terminal status chips (credits, context usage; F16). Each chip used to run
 * its own interval and focus listener per pane, so six agent panes woke the renderer for eighteen timers
 * that refreshed the same account-wide figures. Chips that share a key share one refresh; the timer is
 * armed for the nearest due refresh only, stops when no chip is left, and pauses while the window is
 * hidden (the figures are refreshed when it comes back, as they are when it regains focus).
 */
interface TickerEntry { everyMs: number; dueAt: number; run: () => void; subscribers: number }

export class StatusTicker {
  private readonly entries = new Map<string, TickerEntry>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private listening = false

  constructor(private readonly now: () => number = Date.now) {}

  /** Refreshes now (unless that key is already ticking), then every `everyMs`. Returns the unsubscribe. */
  subscribe(key: string, everyMs: number, run: () => void): () => void {
    const existing = this.entries.get(key)
    const entry = existing ?? { everyMs, dueAt: this.now() + everyMs, run, subscribers: 0 }
    entry.run = run
    entry.everyMs = Math.min(entry.everyMs, everyMs)
    entry.subscribers++
    if (!existing) {
      this.entries.set(key, entry)
      run()
    }
    this.listen()
    this.schedule()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (--entry.subscribers > 0) return
      if (this.entries.get(key) === entry) this.entries.delete(key)
      this.schedule()
    }
  }

  /** How many timers this ticker holds: 0 or 1. */
  get pendingTimers(): number {
    return this.timer === null ? 0 : 1
  }

  private hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
  }

  private schedule(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    if (this.entries.size === 0) { this.unlisten(); return }
    if (this.hidden()) return
    let next = Infinity
    for (const entry of this.entries.values()) next = Math.min(next, entry.dueAt)
    this.timer = setTimeout(() => { this.timer = null; this.runDue(false) }, Math.max(0, next - this.now()))
  }

  private runDue(all: boolean): void {
    const now = this.now()
    for (const entry of [...this.entries.values()]) {
      if (!all && entry.dueAt > now) continue
      entry.dueAt = now + entry.everyMs
      entry.run()
    }
    this.schedule()
  }

  private readonly onFocus = (): void => { this.runDue(true) }
  private readonly onVisibility = (): void => {
    // Back from hidden: whatever fell due meanwhile refreshes now; going hidden just drops the timer.
    if (this.hidden()) this.schedule()
    else this.runDue(false)
  }

  private listen(): void {
    if (this.listening || typeof window === 'undefined') return
    this.listening = true
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  private unlisten(): void {
    if (!this.listening) return
    this.listening = false
    window.removeEventListener('focus', this.onFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
  }
}

export const statusTicker = new StatusTicker()

/** Runs `refresh` on mount, on window focus and every `everyMs`, through the window's one ticker. */
export function useStatusTicker(key: string, everyMs: number, refresh: () => void): void {
  const refreshRef = useRef(refresh)
  useEffect(() => { refreshRef.current = refresh })
  useEffect(() => statusTicker.subscribe(key, everyMs, () => refreshRef.current()), [key, everyMs])
}
