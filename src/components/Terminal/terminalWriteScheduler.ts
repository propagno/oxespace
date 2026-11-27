/**
 * Frame-paced, backpressured, pause-aware terminal write scheduler (OXE-178, OXE-349, OXE-411).
 *
 * - Interactive small chunks (e.g. key echoes on an idle visible pane) flush
 *   immediately so key-echo latency stays at 0 ms overhead.
 * - Heavy streaming bursts (e.g. 8 PTYs printing ~1 MB/s each on Windows ConPTY)
 *   coalesce per animation frame with a per-frame byte budget and wait for
 *   xterm's write callback before pushing the next slice, leaving room on the
 *   renderer main thread for keystrokes and Ctrl+K.
 * - OXE-411 lever Q (on by default since 1.6.0): pending output stays a queue of
 *   chunks with an advancing head index (and immediate release of written chunks),
 *   avoiding quadratic string re-copying when a pane falls behind its output.
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
  /** Optional higher cap while visible (not paused); hidden/paused panes still enforce `maxBufferedBytes`. */
  activeMaxBufferedBytes?: number
  /** Initial paused state (e.g. when TerminalView mounts inside a hidden workspace/pane). */
  paused?: boolean
  /**
   * OXE-411 lever Q (on by default): keep pending output as a queue of chunks instead of one string re-copied on
   * every frame (`OXESPACE_TERM_LEVERS=none` sets this to `false`).
   */
  queue?: boolean
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
  /** Drains and returns any pending buffered text without scheduling a write (used on parked reattach). */
  takePending: () => { data: string; truncated: boolean }
  dispose: () => void
  /** Pending buffered characters waiting to be written (for diagnostics/tests). */
  pendingLength: () => number
  /** Characters the scheduler still references, written or not (for diagnostics/tests). */
  retainedLength: () => number
  /** True if head data was evicted while buffered and not yet flushed. */
  wasTruncated: () => boolean
}

import { scanVtState, skipPartialVtSequence, trimStringToSafeVtTail, type VtTailState } from '../../../shared/vt-trim'

export const IMMEDIATE_CHUNK_BYTES = 512
export const MAX_BYTES_PER_FRAME = 64 * 1024
export const MAX_BUFFERED_BYTES = 256 * 1024

export function createTerminalWriteScheduler(options: TerminalWriteSchedulerOptions): TerminalWriteScheduler {
  const immediateBytes = options.immediateBytes ?? IMMEDIATE_CHUNK_BYTES
  const maxBytesPerFrame = options.maxBytesPerFrame ?? MAX_BYTES_PER_FRAME
  const maxBufferedBytes = Math.max(1, options.maxBufferedBytes ?? MAX_BUFFERED_BYTES)
  const activeMaxBufferedBytes = Math.max(maxBufferedBytes, options.activeMaxBufferedBytes ?? maxBufferedBytes)
  const currentMaxBufferedBytes = (): number => (paused ? maxBufferedBytes : activeMaxBufferedBytes)
  const useQueue = options.queue !== false
  const scheduleFrame = options.scheduleFrame
    ?? (typeof requestAnimationFrame === 'function'
      ? (cb: () => void) => requestAnimationFrame(cb)
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number)
  const cancelFrame = options.cancelFrame
    ?? (typeof cancelAnimationFrame === 'function'
      ? (id: number) => cancelAnimationFrame(id)
      : (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>))

  // Lever Q: pending output as chunks, `head` characters of parts[first] already taken.
  const parts: string[] = []
  let first = 0
  let head = 0
  let pending = ''
  let pendingBytes = 0
  let truncated = false
  let evictedState: VtTailState = 'ground'
  let paused = options.paused ?? false
  let inFlight = false
  let frameId: number | null = null
  let disposed = false

  const compact = (): void => {
    if (first > 64 || first === parts.length) {
      parts.splice(0, first)
      first = 0
    }
  }

  const takeQueued = (maxChars: number): string => {
    const out: string[] = []
    let taken = 0
    while (taken < maxChars && first < parts.length) {
      const part = parts[first]
      const avail = part.length - head
      const room = maxChars - taken
      if (avail <= room) {
        out.push(head ? part.slice(head) : part)
        taken += avail
        // Written: let it go now, not when the array is next compacted (a pane behind its output kept megabytes).
        parts[first] = ''
        first++
        head = 0
      } else {
        let step = room
        const code = part.charCodeAt(head + step - 1)
        // Avoid ending on a lone high surrogate.
        if (code >= 0xd800 && code <= 0xdbff) {
          if (step > 1) step -= 1
          else if (taken > 0) break
        }
        out.push(part.slice(head, head + step))
        head += step
        taken += step
        break
      }
    }
    compact()
    pendingBytes -= taken
    return out.length === 1 ? out[0] : out.join('')
  }

  const takePendingString = (maxChars: number): string => {
    if (pending.length <= maxChars) {
      const chunk = pending
      pending = ''
      pendingBytes = 0
      return chunk
    }
    let end = maxChars
    const code = pending.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff && end > 1) end -= 1
    const chunk = pending.slice(0, end)
    pending = pending.slice(end)
    pendingBytes = pending.length
    return chunk
  }

  const trimToCap = (): void => {
    const cap = currentMaxBufferedBytes()
    const overCap = pendingBytes > cap
    if (!overCap && evictedState === 'ground') return
    if (overCap) truncated = true
    if (!useQueue) {
      if (overCap) {
        pending = trimStringToSafeVtTail(pending, cap)
        pendingBytes = pending.length
      }
      return
    }
    while (pendingBytes > cap && first < parts.length) {
      const avail = parts[first].length - head
      if (pendingBytes - avail >= cap && first + 1 < parts.length) {
        evictedState = scanVtState(parts[first], evictedState, head, parts[first].length)
        parts[first] = ''
        first++
        head = 0
        pendingBytes -= avail
      } else {
        const drop = pendingBytes - cap
        const nextHead = head + drop
        evictedState = scanVtState(parts[first], evictedState, head, nextHead)
        pendingBytes -= drop
        head = nextHead
        if (head >= parts[first].length) {
          parts[first] = ''
          first++
          head = 0
        }
        break
      }
    }
    // Advance cleanly past any partial ESC/CSI/OSC/DCS sequence or lone low surrogate
    // left at the head after dropping leading bytes.
    while (first < parts.length) {
      const part = parts[first]
      const { offset, state } = skipPartialVtSequence(part, evictedState, head)
      evictedState = state
      const skipped = offset - head
      if (skipped > 0) {
        pendingBytes -= skipped
        head = offset
      }
      if (head >= part.length) {
        parts[first] = ''
        first++
        head = 0
      } else {
        break
      }
      if (evictedState === 'ground') break
    }
    compact()
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
    const chunk = useQueue ? takeQueued(maxBytesPerFrame) : takePendingString(maxBytesPerFrame)
    if (!chunk) return
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
    if (useQueue) parts.push(data)
    else pending += data
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
      trimToCap()
      return
    }
    if (pendingBytes > 0) scheduleFlush()
  }

  const takePending = (): { data: string; truncated: boolean } => {
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    const wasTrunc = truncated
    truncated = false
    evictedState = 'ground'
    if (pendingBytes === 0) return { data: '', truncated: wasTrunc }
    let data: string
    if (useQueue) {
      const out: string[] = []
      for (let i = first; i < parts.length; i++) {
        const part = parts[i]
        if (!part) continue
        out.push(i === first && head > 0 ? part.slice(head) : part)
      }
      parts.length = 0
      first = 0
      head = 0
      data = out.length === 1 ? out[0] : out.join('')
    } else {
      data = pending
      pending = ''
    }
    pendingBytes = 0
    return { data, truncated: wasTrunc }
  }

  const dispose = (): void => {
    disposed = true
    parts.length = 0
    first = 0
    head = 0
    pending = ''
    pendingBytes = 0
    truncated = false
    evictedState = 'ground'
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
  }

  return {
    enqueue,
    setPaused,
    isPaused: () => paused,
    takePending,
    dispose,
    pendingLength: () => pendingBytes,
    retainedLength: () => (useQueue ? parts.reduce((total, part) => total + part.length, 0) : pending.length),
    wasTruncated: () => truncated
  }
}
