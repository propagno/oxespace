/**
 * Frame-paced, backpressured terminal write scheduler (OXE-178).
 *
 * Interactive small chunks (e.g. key echoes on an idle pane) flush immediately
 * when the pane is idle so key-echo latency stays at 0 ms overhead. Heavy
 * streaming bursts (e.g. 8 PTYs printing ~1 MB/s each on Windows ConPTY)
 * coalesce per animation frame with a per-frame byte budget and wait for
 * xterm's write callback before pushing the next slice, leaving room on the
 * renderer main thread for keystrokes and Ctrl+K.
 */
export interface TerminalWriteSchedulerOptions {
  /** Small chunks at or below this size flush immediately when no write is in flight. */
  immediateBytes?: number
  /** Maximum characters handed to xterm in one frame slice. */
  maxBytesPerFrame?: number
  /** Flush callback: must invoke `done()` once xterm finishes parsing `chunk`. */
  write: (chunk: string, done: () => void) => void
  /** Optional custom frame scheduler (injectable for deterministic tests). */
  scheduleFrame?: (cb: () => void) => number
  cancelFrame?: (id: number) => void
}

export interface TerminalWriteScheduler {
  enqueue: (data: string) => void
  dispose: () => void
  /** Pending buffered characters waiting to be written (for diagnostics/tests). */
  pendingLength: () => number
}

export const IMMEDIATE_CHUNK_BYTES = 512
export const MAX_BYTES_PER_FRAME = 64 * 1024

export function createTerminalWriteScheduler(options: TerminalWriteSchedulerOptions): TerminalWriteScheduler {
  const immediateBytes = options.immediateBytes ?? IMMEDIATE_CHUNK_BYTES
  const maxBytesPerFrame = options.maxBytesPerFrame ?? MAX_BYTES_PER_FRAME
  const scheduleFrame = options.scheduleFrame
    ?? (typeof requestAnimationFrame === 'function'
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number)
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function'
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>))

  let pending = ''
  let inFlight = false
  let frameId: number | null = null
  let disposed = false

  const scheduleFlush = (): void => {
    if (disposed || inFlight || frameId !== null || !pending) return
    frameId = scheduleFrame(() => {
      frameId = null
      flushNext()
    })
  }

  const flushNext = (): void => {
    if (disposed || inFlight || !pending) return
    const chunk = pending.length > maxBytesPerFrame ? pending.slice(0, maxBytesPerFrame) : pending
    pending = pending.length > maxBytesPerFrame ? pending.slice(maxBytesPerFrame) : ''
    inFlight = true
    options.write(chunk, () => {
      inFlight = false
      if (!disposed && pending) scheduleFlush()
    })
  }

  const enqueue = (data: string): void => {
    if (disposed || !data) return
    if (!inFlight && frameId === null && !pending && data.length <= immediateBytes) {
      inFlight = true
      options.write(data, () => {
        inFlight = false
        if (!disposed && pending) scheduleFlush()
      })
      return
    }
    pending += data
    scheduleFlush()
  }

  const dispose = (): void => {
    disposed = true
    pending = ''
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
  }

  return {
    enqueue,
    dispose,
    pendingLength: () => pending.length
  }
}
