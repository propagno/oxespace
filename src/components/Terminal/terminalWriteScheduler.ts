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
  /**
   * OXE-411 lever Q: keep the pending output as a queue of chunks. The single string re-copied everything still
   * pending on every frame (`pending.slice(maxBytesPerFrame)`), which is quadratic once a pane falls behind its
   * output: the measured renderer profile spent 38% of its CPU there. Same slices, same order, same backpressure.
   */
  queue?: boolean
}

export interface TerminalWriteScheduler {
  enqueue: (data: string) => void
  dispose: () => void
  /** Pending buffered characters waiting to be written (for diagnostics/tests). */
  pendingLength: () => number
  /** Characters the scheduler still references, written or not (for diagnostics/tests). */
  retainedLength: () => number
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

  // Lever Q: the pending output as chunks, `head` characters of parts[first] already taken.
  const parts: string[] = []
  let first = 0
  let head = 0
  let queued = 0
  const useQueue = options.queue === true
  const takeQueued = (max: number): string => {
    let chunk = ''
    while (chunk.length < max && first < parts.length) {
      const part = parts[first]
      const room = max - chunk.length
      if (part.length - head <= room) {
        chunk += head ? part.slice(head) : part
        // Written: let it go now, not when the array is next compacted (a pane behind its output kept megabytes).
        parts[first] = ''
        first++
        head = 0
      } else {
        chunk += part.slice(head, head + room)
        head += room
      }
    }
    if (first > 64 || first === parts.length) { parts.splice(0, first); first = 0 }
    queued -= chunk.length
    return chunk
  }

  let pending = ''
  let inFlight = false
  let frameId: number | null = null
  let disposed = false

  const hasPending = (): boolean => (useQueue ? queued > 0 : pending.length > 0)

  const scheduleFlush = (): void => {
    if (disposed || inFlight || frameId !== null || !hasPending()) return
    frameId = scheduleFrame(() => {
      frameId = null
      flushNext()
    })
  }

  const flushNext = (): void => {
    if (disposed || inFlight || !hasPending()) return
    let chunk: string
    if (useQueue) chunk = takeQueued(maxBytesPerFrame)
    else {
      chunk = pending.length > maxBytesPerFrame ? pending.slice(0, maxBytesPerFrame) : pending
      pending = pending.length > maxBytesPerFrame ? pending.slice(maxBytesPerFrame) : ''
    }
    inFlight = true
    options.write(chunk, () => {
      inFlight = false
      if (!disposed && hasPending()) scheduleFlush()
    })
  }

  const enqueue = (data: string): void => {
    if (disposed || !data) return
    if (!inFlight && frameId === null && !hasPending() && data.length <= immediateBytes) {
      inFlight = true
      options.write(data, () => {
        inFlight = false
        if (!disposed && hasPending()) scheduleFlush()
      })
      return
    }
    if (useQueue) { parts.push(data); queued += data.length } else pending += data
    scheduleFlush()
  }

  const dispose = (): void => {
    disposed = true
    pending = ''
    parts.length = 0
    first = 0
    head = 0
    queued = 0
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
  }

  return {
    enqueue,
    dispose,
    pendingLength: () => (useQueue ? queued : pending.length),
    retainedLength: () => (useQueue ? parts.reduce((total, part) => total + part.length, 0) : pending.length)
  }
}
