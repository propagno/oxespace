/**
 * OXE-484 · Asymmetric terminal reflow debouncer (inspired by VS Code TerminalResizeDebouncer).
 *
 * - Vertical (`rows`-only) resizes are O(1) in xterm and always apply immediately.
 * - Horizontal (`cols`) resizes trigger O(N) scrollback reflow in xterm, so when the
 *   buffer has at least `COLS_REFLOW_MIN_BUFFER_LINES` (200) lines, continuous horizontal
 *   drags are debounced by `COLS_REFLOW_DEBOUNCE_MS` (100 ms) while preserving exact final
 *   dimensions on drag end. Small buffers (< 200 lines) apply immediately.
 */
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { fitTerminalGrid, type HeldGrid } from './heldGrid'
import type { PtyResizeDebouncer } from './resizeDebounce'

export const COLS_REFLOW_DEBOUNCE_MS = 100
export const COLS_REFLOW_MIN_BUFFER_LINES = 200

export type TerminalReflowOutcome =
  | 'unchanged'
  | 'immediate-rows'
  | 'immediate-full'
  | 'debounced-cols'

export interface TerminalReflowDebouncerOptions {
  delayMs?: number
  minBufferLines?: number
  getBufferLength: () => number
  getCurrentSize: () => HeldGrid
  applyRows: (rows: number, options?: { deferPty?: boolean }) => void
  applyColsAndRows: (cols: number, rows: number, wasDebounced: boolean) => void
  onColsDeferred?: () => void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface TerminalReflowDebouncer {
  resize(cols: number, rows: number, options?: { immediate?: boolean }): TerminalReflowOutcome
  flush(): void
  cancel(): void
  hasPending(): boolean
  pendingSize(): HeldGrid | null
  dispose(): void
}

export function createTerminalReflowDebouncer(
  options: TerminalReflowDebouncerOptions
): TerminalReflowDebouncer {
  const delayMs = options.delayMs ?? COLS_REFLOW_DEBOUNCE_MS
  const minBufferLines = options.minBufferLines ?? COLS_REFLOW_MIN_BUFFER_LINES
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let pending: HeldGrid | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearPendingTimer = (): void => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const cancel = (): void => {
    clearPendingTimer()
    pending = null
  }

  const flush = (): void => {
    clearPendingTimer()
    if (disposed || !pending) return
    const next = pending
    pending = null
    options.applyColsAndRows(next.cols, next.rows, true)
  }

  const resize = (
    cols: number,
    rows: number,
    resizeOptions?: { immediate?: boolean }
  ): TerminalReflowOutcome => {
    if (
      disposed ||
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      cols < 1 ||
      rows < 1
    ) {
      return 'unchanged'
    }

    const current = options.getCurrentSize()
    if (cols === current.cols && rows === current.rows) {
      cancel()
      return 'unchanged'
    }

    if (resizeOptions?.immediate || options.getBufferLength() < minBufferLines) {
      cancel()
      options.applyColsAndRows(cols, rows, false)
      return 'immediate-full'
    }

    // Vertical-only resize: O(1) in xterm (no scrollback re-wrap).
    if (cols === current.cols) {
      cancel()
      options.applyRows(rows, { deferPty: false })
      return 'immediate-rows'
    }

    // Horizontal resize on a populated buffer: apply any vertical delta immediately
    // and debounce the expensive horizontal reflow by `delayMs`.
    if (rows !== current.rows) {
      options.applyRows(rows, { deferPty: true })
    }

    pending = { cols, rows }
    options.onColsDeferred?.()
    clearPendingTimer()
    timer = setTimer(flush, delayMs)
    return 'debounced-cols'
  }

  const dispose = (): void => {
    disposed = true
    cancel()
  }

  return {
    resize,
    flush,
    cancel,
    hasPending: () => pending !== null,
    pendingSize: () => (pending ? { ...pending } : null),
    dispose
  }
}

export interface TerminalFitControllerOptions {
  terminal: Terminal
  fitAddon: FitAddon
  notified: HeldGrid
  resizeDebouncer: PtyResizeDebouncer
  getFixedSize: () => HeldGrid | null
  isHidden: () => boolean
  isDisposed: () => boolean
  reportResize: (cols: number, rows: number) => void
}

export interface TerminalFitController {
  fit(forceRefresh?: boolean): void
  cancel(): void
  dispose(): void
}

function syncViewportScrollArea(terminal: Terminal): void {
  // Public API has no syncScrollArea; after maximize the private viewport can
  // keep a stale scrollHeight so the wheel appears dead. Best-effort only.
  try {
    const core = (terminal as unknown as {
      _core?: { viewport?: { syncScrollArea?: (immediate?: boolean) => void } }
    })._core
    core?.viewport?.syncScrollArea?.(true)
  } catch {
    /* private xterm surface — ignore if shape changes */
  }
}

/**
 * Coordinates xterm fit/repaint, scroll-position preservation, and asymmetric
 * `cols` reflow debouncing (`rows` immediate, `cols` debounced 100 ms when
 * buffer >= 200 lines) while keeping PTY resize debounce & OXE-471/473 guards intact.
 */
export function createTerminalFitController(
  options: TerminalFitControllerOptions
): TerminalFitController {
  const { terminal, fitAddon, notified, resizeDebouncer, reportResize } = options

  const refreshAndRestoreScroll = (
    dimensionsChanged: boolean,
    forceRefresh: boolean,
    wasAtBottom: boolean,
    viewportY: number,
    isAlt: boolean
  ): void => {
    if (dimensionsChanged || forceRefresh) terminal.refresh(0, Math.max(0, terminal.rows - 1))
    syncViewportScrollArea(terminal)
    if (isAlt) return
    if (wasAtBottom) terminal.scrollToBottom()
    else terminal.scrollToLine(Math.min(viewportY, terminal.buffer.active.baseY))
  }

  const applyFullFit = (forceRefresh: boolean, wasDebounced: boolean): void => {
    if (options.isHidden() || options.isDisposed()) return
    try {
      const buf = terminal.buffer.active
      const viewportY = buf.viewportY
      const wasAtBottom = viewportY >= buf.baseY
      const isAlt = buf.type === 'alternate'
      const dimensionsChanged = fitTerminalGrid(terminal, fitAddon, options.getFixedSize(), notified, reportResize)
      if (wasDebounced && resizeDebouncer.hasPending()) resizeDebouncer.flush()
      refreshAndRestoreScroll(dimensionsChanged, forceRefresh, wasAtBottom, viewportY, isAlt)
    } catch {
      // xterm may not have measurable dimensions during first layout.
    }
  }

  const applyRowsOnly = (rows: number, rowOptions?: { deferPty?: boolean }): void => {
    if (options.isHidden() || options.isDisposed()) return
    try {
      const buf = terminal.buffer.active
      const viewportY = buf.viewportY
      const wasAtBottom = viewportY >= buf.baseY
      const isAlt = buf.type === 'alternate'
      const changed = terminal.rows !== rows
      if (changed) terminal.resize(terminal.cols, rows)
      if (!rowOptions?.deferPty && (terminal.cols !== notified.cols || terminal.rows !== notified.rows)) {
        notified.cols = terminal.cols
        notified.rows = terminal.rows
        reportResize(terminal.cols, terminal.rows)
        if (resizeDebouncer.hasPending()) resizeDebouncer.flush()
      }
      refreshAndRestoreScroll(changed, false, wasAtBottom, viewportY, isAlt)
    } catch {
      // xterm may not have measurable dimensions during first layout.
    }
  }

  const reflowDebouncer = createTerminalReflowDebouncer({
    getBufferLength: () => (terminal.buffer?.normal ?? terminal.buffer?.active)?.length ?? 0,
    getCurrentSize: () => ({ cols: terminal.cols, rows: terminal.rows }),
    applyRows: applyRowsOnly,
    applyColsAndRows: (_cols, _rows, wasDebounced) => applyFullFit(false, wasDebounced),
    onColsDeferred: () => resizeDebouncer.cancel()
  })

  const fit = (forceRefresh = false): void => {
    if (options.isHidden()) return
    const immediate = forceRefresh || options.getFixedSize() !== null || notified.cols === 0 || notified.rows === 0
    if (immediate || typeof fitAddon.proposeDimensions !== 'function') {
      reflowDebouncer.cancel()
      applyFullFit(forceRefresh, false)
      return
    }
    let proposed: { cols: number; rows: number } | undefined
    try { proposed = fitAddon.proposeDimensions() } catch { proposed = undefined }
    if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
      reflowDebouncer.cancel()
      applyFullFit(forceRefresh, false)
      return
    }
    reflowDebouncer.resize(proposed.cols, proposed.rows)
  }

  return {
    fit,
    cancel: () => reflowDebouncer.cancel(),
    dispose: () => reflowDebouncer.dispose()
  }
}
