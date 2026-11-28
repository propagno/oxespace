/**
 * OXE-483 · Renderer-side flow-control ACK batcher for xterm.js.
 *
 * Accumulates parsed characters inside xterm's `write(chunk, done)` callback and
 * sends an IPC ACK once at least `CHAR_COUNT_ACK_SIZE` (5,000) chars have been
 * consumed, or when flushed on hide/park/detach/unmount.
 *
 * Safe when `sendAck` is absent (e.g. legacy test mocks or custom thread transports).
 */
export const CHAR_COUNT_ACK_SIZE = 5_000

export interface TerminalAckBatcherOptions {
  paneId: string
  ackSize?: number
  sendAck?: (paneId: string, chars: number) => Promise<void> | void
}

export interface TerminalAckBatcher {
  /** Accumulate `chars` finished by xterm; emits an ACK once threshold is reached. */
  record: (chars: number) => void
  /** Flush any remaining accumulated characters immediately (e.g. on hide/detach/unmount). */
  flush: () => void
  /** Currently accumulated unacknowledged character count (for diagnostics/tests). */
  pending: () => number
}

export function createTerminalAckBatcher(options: TerminalAckBatcherOptions): TerminalAckBatcher {
  const ackSize = Math.max(1, options.ackSize ?? CHAR_COUNT_ACK_SIZE)
  let pendingChars = 0

  const emit = (chars: number): void => {
    if (chars <= 0 || typeof options.sendAck !== 'function') return
    try {
      const result = options.sendAck(options.paneId, chars)
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(() => undefined)
      }
    } catch {
      /* ignore teardown or mock errors */
    }
  }

  const flush = (): void => {
    if (pendingChars <= 0) return
    const chars = pendingChars
    pendingChars = 0
    emit(chars)
  }

  const record = (chars: number): void => {
    if (!Number.isFinite(chars) || chars <= 0) return
    pendingChars += Math.floor(chars)
    if (pendingChars >= ackSize) flush()
  }

  return {
    record,
    flush,
    pending: () => pendingChars
  }
}
