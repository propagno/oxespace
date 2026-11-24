/**
 * Frame-paced, backpressured, pause-aware terminal write scheduler (OXE-178, OXE-349).
 *
 * - Interactive small chunks (e.g. key echoes on an idle visible pane) flush
 *   immediately so key-echo latency stays at 0 ms overhead.
 * - Heavy streaming bursts (e.g. 8 PTYs printing ~1 MB/s each on Windows ConPTY)
 *   coalesce per animation frame with a per-frame byte budget and wait for
 *   xterm's write callback before pushing the next slice, leaving room on the
 *   renderer main thread for keystrokes and Ctrl+K.
 * - Hidden/inactive terminals pause xterm writes and retain only a bounded tail
 *   buffer (`maxBufferedBytes`), preventing DOM/canvas churn and unbounded RAM
 *   growth; when visible again, buffered output flushes in coalesced frames.
 */
export interface TerminalWriteMeta {
  /** True when head bytes were evicted due to `maxBufferedBytes` overflow before this slice. */
  truncated: boolean
}

export interface TerminalWriteSchedulerOptions {
  /** Small chunks at or below this size flush immediately when idle and not paused. */
  immediateBytes?: number
  /** Maximum characters handed to xterm in one frame slice. */
  maxBytesPerFrame?: number
  /** Hard cap on buffered characters waiting to be written (evicts oldest head chunks). */
  maxBufferedBytes?: number
  /** Initial paused state (e.g. when TerminalView mounts inside a hidden workspace/pane). */
  paused?: boolean
  /** Flush callback: must invoke `done()` once xterm finishes parsing `chunk`. */
  write: (chunk: string, done: () => void, meta: TerminalWriteMeta) => void
  /** Optional custom frame scheduler (injectable for deterministic tests). */
  scheduleFrame?: (cb: () => void) => number
  cancelFrame?: (id: number) => void
}

export interface TerminalWriteScheduler {
  enqueue: (data: string) => void
  setPaused: (paused: boolean) => void
  isPaused: () => boolean
  dispose: () => void
  /** Pending buffered characters waiting to be written (for diagnostics/tests). */
  pendingLength: () => number
  /** True if head data was evicted while buffered and not yet flushed. */
  wasTruncated: () => boolean
}

export const IMMEDIATE_CHUNK_BYTES = 512
export const MAX_BYTES_PER_FRAME = 64 * 1024
export const MAX_BUFFERED_BYTES = 256 * 1024

function safeTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  let start = text.length - maxChars
  const code = text.charCodeAt(start)
  // Avoid starting on a lone low surrogate.
  if (code >= 0xdc00 && code <= 0xdfff && start + 1 < text.length) start += 1
  return text.slice(start)
}

function takeSlice(chunks: string[], maxChars: number): { chunk: string; taken: number } {
  if (chunks.length === 0) return { chunk: '', taken: 0 }
  const first = chunks[0]
  if (first.length > maxChars) {
    let end = maxChars
    const code = first.charCodeAt(end - 1)
    // Avoid ending on a lone high surrogate.
    if (code >= 0xd800 && code <= 0xdbff && end > 1) end -= 1
    const chunk = first.slice(0, end)
    chunks[0] = first.slice(end)
    return { chunk, taken: chunk.length }
  }

  const parts: string[] = []
  let taken = 0
  while (chunks.length > 0 && taken + chunks[0].length <= maxChars) {
    const next = chunks.shift()!
    parts.push(next)
    taken += next.length
  }
  if (chunks.length > 0 && taken < maxChars) {
    let room = maxChars - taken
    const next = chunks[0]
    const code = next.charCodeAt(room - 1)
    if (code >= 0xd800 && code <= 0xdbff && room > 1) room -= 1
    if (room > 0) {
      parts.push(next.slice(0, room))
      chunks[0] = next.slice(room)
      taken += room
    }
  }
  return { chunk: parts.length === 1 ? parts[0] : parts.join(''), taken }
}

export function createTerminalWriteScheduler(options: TerminalWriteSchedulerOptions): TerminalWriteScheduler {
  const immediateBytes = options.immediateBytes ?? IMMEDIATE_CHUNK_BYTES
  const maxBytesPerFrame = options.maxBytesPerFrame ?? MAX_BYTES_PER_FRAME
  const maxBufferedBytes = Math.max(1, options.maxBufferedBytes ?? MAX_BUFFERED_BYTES)
  const scheduleFrame = options.scheduleFrame
    ?? (typeof requestAnimationFrame === 'function'
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number)
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function'
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>))

  const chunks: string[] = []
  let pendingBytes = 0
  let truncated = false
  let paused = options.paused ?? false
  let inFlight = false
  let frameId: number | null = null
  let disposed = false

  const trimToCap = (): void => {
    if (pendingBytes <= maxBufferedBytes) return
    truncated = true
    while (pendingBytes > maxBufferedBytes && chunks.length > 1) {
      const evicted = chunks.shift()!
      pendingBytes -= evicted.length
    }
    if (pendingBytes > maxBufferedBytes && chunks.length === 1) {
      const tail = safeTail(chunks[0], maxBufferedBytes)
      chunks[0] = tail
      pendingBytes = tail.length
    }
  }

  const scheduleFlush = (): void => {
    if (disposed || paused || inFlight || frameId !== null || pendingBytes === 0) return
    frameId = scheduleFrame(() => {
      frameId = null
      flushNext()
    })
  }

  const flushNext = (): void => {
    if (disposed || paused || inFlight || pendingBytes === 0) return
    const { chunk, taken } = takeSlice(chunks, maxBytesPerFrame)
    if (!chunk) return
    pendingBytes -= taken
    const sliceTruncated = truncated
    truncated = false
    inFlight = true
    options.write(chunk, () => {
      inFlight = false
      if (!disposed && !paused && pendingBytes > 0) scheduleFlush()
    }, { truncated: sliceTruncated })
  }

  const enqueue = (data: string): void => {
    if (disposed || !data) return
    if (!paused && !inFlight && frameId === null && pendingBytes === 0 && !truncated && data.length <= immediateBytes) {
      inFlight = true
      options.write(data, () => {
        inFlight = false
        if (!disposed && !paused && pendingBytes > 0) scheduleFlush()
      }, { truncated: false })
      return
    }
    chunks.push(data)
    pendingBytes += data.length
    trimToCap()
    if (!paused) scheduleFlush()
  }

  const setPaused = (nextPaused: boolean): void => {
    if (disposed || paused === nextPaused) return
    paused = nextPaused
    if (paused) {
      if (frameId !== null) {
        cancelFrame(frameId)
        frameId = null
      }
      return
    }
    if (pendingBytes > 0) scheduleFlush()
  }

  const dispose = (): void => {
    disposed = true
    chunks.length = 0
    pendingBytes = 0
    truncated = false
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
  }

  return {
    enqueue,
    setPaused,
    isPaused: () => paused,
    dispose,
    pendingLength: () => pendingBytes,
    wasTruncated: () => truncated
  }
}
