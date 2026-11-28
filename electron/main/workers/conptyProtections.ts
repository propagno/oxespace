/**
 * OXE-484 · Windows ConPTY stability protections (inspired by VS Code TerminalProcess).
 *
 * 1. `windowsConptyForkOptions`: enables `useConptyDll` and `conptyInheritCursor` on win32.
 * 2. `ConptyKillSpawnThrottle`: enforces a 250 ms cooldown after a ConPTY kill before
 *    spawning a replacement process on win32 to prevent `conhost`/handle exhaustion hangs.
 * 3. `createDataFlushGuard` & `drainWithTimeout`: bounds exit/shutdown data draining to
 *    `CONPTY_DATA_FLUSH_TIMEOUT_MS` (250 ms) so trailing output flushes without hanging.
 */
import type { IWindowsPtyForkOptions } from 'node-pty'

export const CONPTY_KILL_SPAWN_THROTTLE_MS = 250
export const CONPTY_DATA_FLUSH_TIMEOUT_MS = 250

export function windowsConptyForkOptions(
  platform: NodeJS.Platform
): Partial<IWindowsPtyForkOptions> {
  if (platform !== 'win32') return {}
  return {
    useConptyDll: true,
    conptyInheritCursor: true
  }
}

export interface ConptyKillSpawnThrottleOptions {
  platform?: NodeJS.Platform
  intervalMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export class ConptyKillSpawnThrottle {
  private readonly isWin32: boolean
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (id: ReturnType<typeof setTimeout>) => void
  private lastKillAt = Number.NEGATIVE_INFINITY
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private disposed = false

  constructor(options: ConptyKillSpawnThrottleOptions = {}) {
    this.isWin32 = (options.platform ?? process.platform) === 'win32'
    this.intervalMs = Math.max(0, options.intervalMs ?? CONPTY_KILL_SPAWN_THROTTLE_MS)
    this.now = options.now ?? (() => Date.now())
    this.setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  }

  recordKill(): void {
    if (!this.isWin32) return
    this.lastKillAt = this.now()
  }

  remainingDelayMs(): number {
    if (!this.isWin32 || this.intervalMs <= 0 || !Number.isFinite(this.lastKillAt)) return 0
    const elapsed = this.now() - this.lastKillAt
    if (elapsed < 0) return this.intervalMs
    return Math.max(0, this.intervalMs - elapsed)
  }

  /**
   * Executes `fn` synchronously when no kill cooldown is active, or schedules it
   * after the remaining win32 cooldown. Returns a cancel handle.
   */
  scheduleSpawn(fn: () => void): () => void {
    if (this.disposed) return () => undefined
    const delay = this.remainingDelayMs()
    if (delay <= 0) {
      fn()
      return () => undefined
    }
    let cancelled = false
    const id = this.setTimer(() => {
      this.timers.delete(id)
      if (!cancelled && !this.disposed) fn()
    }, delay)
    this.timers.add(id)
    return () => {
      cancelled = true
      if (this.timers.delete(id)) this.clearTimer(id)
    }
  }

  /** Promise-based cooldown wait for async spawners (e.g. pty-daemon). */
  waitForCooldown(signal?: AbortSignal): Promise<void> {
    if (this.disposed || signal?.aborted) return Promise.resolve()
    const delay = this.remainingDelayMs()
    if (delay <= 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        cancel()
        finish()
      }
      const cancel = this.scheduleSpawn(finish)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  pendingCount(): number {
    return this.timers.size
  }

  dispose(): void {
    this.disposed = true
    for (const id of this.timers) this.clearTimer(id)
    this.timers.clear()
  }
}

export interface DataFlushGuardOptions {
  flush: () => void
  timeoutMs?: number
  quietMs?: number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface DataFlushGuard {
  /**
   * Begins exit teardown: flushes buffered data immediately and invokes `onComplete`
   * synchronously when no async/trailing drain is needed, or once trailing output
   * settles — strictly bounded by `CONPTY_DATA_FLUSH_TIMEOUT_MS` (250 ms).
   */
  beginExit(onComplete: () => void, pendingWork?: Promise<unknown>): void
  /** Signals trailing output arrived during exit drain, extending only the quiet window. */
  notifyData(): void
  isExiting(): boolean
  dispose(): void
}

export function createDataFlushGuard(options: DataFlushGuardOptions): DataFlushGuard {
  const timeoutMs = Math.max(1, options.timeoutMs ?? CONPTY_DATA_FLUSH_TIMEOUT_MS)
  const quietMs = Math.max(0, options.quietMs ?? 0)
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let exiting = false
  let completed = false
  let disposed = false
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null
  let quietTimer: ReturnType<typeof setTimeout> | null = null
  let completeCb: (() => void) | null = null

  const clearTimers = (): void => {
    if (ceilingTimer !== null) {
      clearTimer(ceilingTimer)
      ceilingTimer = null
    }
    if (quietTimer !== null) {
      clearTimer(quietTimer)
      quietTimer = null
    }
  }

  const finish = (): void => {
    if (completed) return
    completed = true
    clearTimers()
    try { options.flush() } catch { /* exiting */ }
    const cb = completeCb
    completeCb = null
    if (!disposed) cb?.()
  }

  const armQuietTimer = (): void => {
    if (quietMs <= 0 || completed || disposed) return
    if (quietTimer !== null) clearTimer(quietTimer)
    quietTimer = setTimer(finish, quietMs)
  }

  const beginExit = (onComplete: () => void, pendingWork?: Promise<unknown>): void => {
    if (exiting || disposed) return
    exiting = true
    completeCb = onComplete
    try { options.flush() } catch { /* exiting */ }

    if (!pendingWork && quietMs <= 0) {
      finish()
      return
    }

    ceilingTimer = setTimer(finish, timeoutMs)
    if (pendingWork) {
      void pendingWork.then(
        () => {
          if (quietMs <= 0) finish()
          else armQuietTimer()
        },
        () => finish()
      )
    } else {
      armQuietTimer()
    }
  }

  const notifyData = (): void => {
    if (!exiting || completed || disposed) return
    armQuietTimer()
  }

  const dispose = (): void => {
    disposed = true
    completed = true
    completeCb = null
    clearTimers()
  }

  return {
    beginExit,
    notifyData,
    isExiting: () => exiting,
    dispose
  }
}

export async function drainWithTimeout(
  work: Promise<unknown>,
  timeoutMs = CONPTY_DATA_FLUSH_TIMEOUT_MS
): Promise<'completed' | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      work.then(() => 'completed' as const, () => 'completed' as const),
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => {
          timer = null
          resolve('timed-out')
        }, Math.max(1, timeoutMs))
      })
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
