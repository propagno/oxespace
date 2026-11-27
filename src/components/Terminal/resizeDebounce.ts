import type { HeldGrid } from './heldGrid'

/**
 * OXE-451 · Trailing debounce window before forwarding a settled layout resize
 * to ConPTY/node-pty. Separates immediate local `fitAddon.fit()` sizing from
 * IPC `pty.resize()` so sidebar/panel/split reflows emit at most 1 clean redraw.
 */
export const PTY_RESIZE_DEBOUNCE_MS = 100

/**
 * Minimum sane PTY dimensions. Layout transitions (e.g. split flex shrink or
 * drawer open) can transiently measure narrow strips (< 20 cols) that squash
 * Ink/TUI frames into 1-word-per-line output if forwarded to the PTY.
 */
export const MIN_VALID_PTY_COLS = 20
export const MIN_VALID_PTY_ROWS = 4

export type PtyResizeReportOutcome = 'ignored' | 'immediate' | 'debounced' | 'unchanged'

export interface PtyResizeDebouncerOptions {
  delayMs?: number
  minCols?: number
  minRows?: number
  onEmit: (cols: number, rows: number) => void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface PtyResizeDebouncer {
  report(cols: number, rows: number): PtyResizeReportOutcome
  cancel(): void
  flush(): void
  lastEmitted(): HeldGrid | null
  hasPending(): boolean
  dispose(): void
}

export function isValidPtyGrid(
  cols: number,
  rows: number,
  minCols = MIN_VALID_PTY_COLS,
  minRows = MIN_VALID_PTY_ROWS
): boolean {
  return (
    Number.isFinite(cols) &&
    Number.isFinite(rows) &&
    cols >= minCols &&
    rows >= minRows
  )
}

export function syncNotifiedGrid(notified: HeldGrid, debouncer: PtyResizeDebouncer): void {
  const emitted = debouncer.lastEmitted()
  notified.cols = emitted?.cols ?? 0
  notified.rows = emitted?.rows ?? 0
}

export function createPtyResizeDebouncer(options: PtyResizeDebouncerOptions): PtyResizeDebouncer {
  const delayMs = options.delayMs ?? PTY_RESIZE_DEBOUNCE_MS
  const minCols = options.minCols ?? MIN_VALID_PTY_COLS
  const minRows = options.minRows ?? MIN_VALID_PTY_ROWS
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let emitted: HeldGrid | null = null
  let pending: HeldGrid | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearPendingTimer = (): void => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const flush = (): void => {
    clearPendingTimer()
    if (disposed || !pending) return
    const next = pending
    pending = null
    if (emitted && next.cols === emitted.cols && next.rows === emitted.rows) return
    emitted = next
    options.onEmit(next.cols, next.rows)
  }

  const cancel = (): void => {
    clearPendingTimer()
    pending = null
  }

  const report = (cols: number, rows: number): PtyResizeReportOutcome => {
    if (disposed || !isValidPtyGrid(cols, rows, minCols, minRows)) return 'ignored'

    // First valid mount reports immediately so PTY startup gets real geometry right away.
    if (emitted === null) {
      cancel()
      emitted = { cols, rows }
      options.onEmit(cols, rows)
      return 'immediate'
    }

    // Flicker back to the last emitted grid cancels any pending resize (0 redundant IPC).
    if (cols === emitted.cols && rows === emitted.rows) {
      cancel()
      return 'unchanged'
    }

    pending = { cols, rows }
    clearPendingTimer()
    timer = setTimer(flush, delayMs)
    return 'debounced'
  }

  const dispose = (): void => {
    disposed = true
    cancel()
  }

  return {
    report,
    cancel,
    flush,
    lastEmitted: () => (emitted ? { ...emitted } : null),
    hasPending: () => pending !== null,
    dispose
  }
}
