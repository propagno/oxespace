import { trimStringToSafeVtTail } from '../../../shared/vt-trim'

/**
 * OXE-471 · Post-resize atomic redraw guard for interactive normal-buffer CLIs
 * (e.g. Antigravity CLI, Claude Code / Ink on Windows ConPTY).
 *
 * When a pane width (`cols`) changes after a split or sibling close, ConPTY
 * notifies the running CLI, which often responds with `\x1b[2J\x1b[3J\x1b[H` +
 * a footer stub + megabytes of re-rendered history. Writing those chunks live
 * blanks the terminal for seconds and streams ancient history frame-by-frame.
 *
 * This guard keeps the freshly reflowed canvas on screen while coalescing the
 * redraw burst off-screen, discarding any dead pre-`\x1b[3J` stub, and flushing
 * the final payload once inside a single DEC 2026 synchronized-output envelope.
 */

/** Window after a `cols`-changing `pty.resize()` during which a screen clear or DEC 2026 arms atomic holding. */
export const RESIZE_REDRAW_ARM_MS = 450
/** Quiet settle time after the last burst chunk before flushing atomically. */
export const RESIZE_REDRAW_SETTLE_MS = 140
/** Shorter settle time when a DEC 2026 block closes cleanly (`\x1b[?2026l`) without another clear. */
export const RESIZE_REDRAW_SYNC_SETTLE_MS = 60
/** Hard hold deadline so continuous output after a resize can never starve the view. */
export const RESIZE_REDRAW_MAX_HOLD_MS = 3200
/** High-water cap on held burst bytes (4 MB fits long conversation redraws intact). */
export const RESIZE_REDRAW_MAX_BYTES = 4 * 1024 * 1024

const CLEAR_SCREEN = '\x1b[2J'
const CLEAR_SCROLLBACK = '\x1b[3J'
const SYNC_BEGIN = '\x1b[?2026h'
const SYNC_END = '\x1b[?2026l'
const CLEAR_PROLOGUE_TOKENS = [CLEAR_SCREEN, '\x1b[H', '\x1b[1;1H', '\x1b[?25l', SYNC_BEGIN]

export type ResizeRedrawGuardState = 'idle' | 'armed' | 'holding'

export interface ResizeRedrawFlushMeta {
  rawBytes: number
  truncated: boolean
}

export interface ResizeRedrawGuardOptions {
  armMs?: number
  settleMs?: number
  syncSettleMs?: number
  maxHoldMs?: number
  maxBytes?: number
  onFlush: (atomicPayload: string, meta: ResizeRedrawFlushMeta) => void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface ResizeRedrawGuard {
  notifyPtyResize: (cols: number, rows: number) => void
  ingest: (chunk: string) => boolean
  preemptOnInput: () => void
  flush: () => void
  cancel: () => void
  dispose: () => void
  state: () => ResizeRedrawGuardState
  bufferedBytes: () => number
}

function hasScreenClear(chunk: string): boolean {
  return chunk.includes(CLEAR_SCREEN) || chunk.includes(CLEAR_SCROLLBACK)
}

function hasRedrawTrigger(chunk: string): boolean {
  return hasScreenClear(chunk) || chunk.includes(SYNC_BEGIN)
}

function closesSyncCleanly(chunk: string): boolean {
  const lastEnd = chunk.lastIndexOf(SYNC_END)
  if (lastEnd === -1) return false
  return chunk.lastIndexOf(SYNC_BEGIN) < lastEnd
}

function trimBeforeLastScrollbackClear(payload: string): string {
  const last3J = payload.lastIndexOf(CLEAR_SCROLLBACK)
  if (last3J <= 0) return payload
  let cut = last3J
  // Preserve clear/home/cursor-hide/sync-begin prologue immediately preceding the last `\x1b[3J`.
  let advanced = true
  while (advanced && cut > 0) {
    advanced = false
    for (const token of CLEAR_PROLOGUE_TOKENS) {
      if (cut >= token.length && payload.startsWith(token, cut - token.length)) {
        cut -= token.length
        advanced = true
        break
      }
    }
  }
  return cut > 0 ? payload.slice(cut) : payload
}

function stripSyncMarkers(payload: string): string {
  if (!payload.includes('\x1b[?2026')) return payload
  return payload.split(SYNC_BEGIN).join('').split(SYNC_END).join('')
}

export function createResizeRedrawGuard(options: ResizeRedrawGuardOptions): ResizeRedrawGuard {
  const armMs = options.armMs ?? RESIZE_REDRAW_ARM_MS
  const settleMs = options.settleMs ?? RESIZE_REDRAW_SETTLE_MS
  const syncSettleMs = options.syncSettleMs ?? RESIZE_REDRAW_SYNC_SETTLE_MS
  const maxHoldMs = options.maxHoldMs ?? RESIZE_REDRAW_MAX_HOLD_MS
  const maxBytes = Math.max(1, options.maxBytes ?? RESIZE_REDRAW_MAX_BYTES)
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let currentState: ResizeRedrawGuardState = 'idle'
  let lastCols: number | null = null
  let chunks: string[] = []
  let buffered = 0
  let rawBytes = 0
  let truncated = false
  let armTimer: ReturnType<typeof setTimeout> | null = null
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let maxHoldTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearArmTimer = (): void => {
    if (armTimer !== null) {
      clearTimer(armTimer)
      armTimer = null
    }
  }

  const clearSettleTimer = (): void => {
    if (settleTimer !== null) {
      clearTimer(settleTimer)
      settleTimer = null
    }
  }

  const clearMaxHoldTimer = (): void => {
    if (maxHoldTimer !== null) {
      clearTimer(maxHoldTimer)
      maxHoldTimer = null
    }
  }

  const clearAllTimers = (): void => {
    clearArmTimer()
    clearSettleTimer()
    clearMaxHoldTimer()
  }

  const resetBuffer = (): void => {
    chunks = []
    buffered = 0
    rawBytes = 0
    truncated = false
  }

  const scheduleSettle = (delayMs: number): void => {
    clearSettleTimer()
    settleTimer = setTimer(() => {
      settleTimer = null
      flush()
    }, delayMs)
  }

  const scheduleMaxHold = (): void => {
    clearMaxHoldTimer()
    maxHoldTimer = setTimer(() => {
      maxHoldTimer = null
      flush()
    }, maxHoldMs)
  }

  const enforceByteCap = (): void => {
    if (buffered <= maxBytes) return
    const combined = chunks.length === 1 ? chunks[0] : chunks.join('')
    const deduped = trimBeforeLastScrollbackClear(combined)
    if (deduped.length > maxBytes) {
      const trimmed = trimStringToSafeVtTail(deduped, maxBytes)
      chunks = [trimmed]
      buffered = trimmed.length
      truncated = true
    } else {
      chunks = [deduped]
      buffered = deduped.length
    }
  }

  const flush = (): void => {
    clearAllTimers()
    if (currentState !== 'holding' || chunks.length === 0) {
      currentState = 'idle'
      resetBuffer()
      return
    }
    const combined = chunks.length === 1 ? chunks[0] : chunks.join('')
    const meta: ResizeRedrawFlushMeta = { rawBytes, truncated }
    currentState = 'idle'
    resetBuffer()
    if (disposed) return
    const effective = trimBeforeLastScrollbackClear(combined)
    const cleaned = stripSyncMarkers(effective)
    options.onFlush(`${SYNC_BEGIN}${cleaned}${SYNC_END}`, meta)
  }

  const notifyPtyResize = (cols: number, _rows: number): void => {
    if (disposed) return
    // Initial mount only records baseline width so startup prompts are never delayed.
    if (lastCols === null) {
      lastCols = cols
      return
    }
    // Height-only or same-width resizes do not trigger column re-wrapping redraw storms.
    if (cols === lastCols) return
    lastCols = cols

    if (currentState === 'holding') {
      scheduleMaxHold()
      scheduleSettle(settleMs)
      return
    }

    currentState = 'armed'
    clearArmTimer()
    armTimer = setTimer(() => {
      armTimer = null
      if (currentState === 'armed') currentState = 'idle'
    }, armMs)
  }

  const ingest = (chunk: string): boolean => {
    if (disposed || !chunk) return false
    if (currentState === 'idle') return false

    if (currentState === 'armed') {
      if (!hasRedrawTrigger(chunk)) return false
      clearArmTimer()
      currentState = 'holding'
      chunks = [chunk]
      buffered = chunk.length
      rawBytes = chunk.length
      truncated = false
      enforceByteCap()
      scheduleMaxHold()
      const delay = !hasScreenClear(chunk) && closesSyncCleanly(chunk) ? syncSettleMs : settleMs
      scheduleSettle(delay)
      return true
    }

    // holding
    chunks.push(chunk)
    buffered += chunk.length
    rawBytes += chunk.length
    enforceByteCap()
    const delay = !hasScreenClear(chunk) && closesSyncCleanly(chunk) ? syncSettleMs : settleMs
    scheduleSettle(delay)
    return true
  }

  const preemptOnInput = (): void => {
    if (disposed) return
    if (currentState === 'holding') {
      flush()
      return
    }
    if (currentState === 'armed') {
      clearArmTimer()
      currentState = 'idle'
    }
  }

  const cancel = (): void => {
    clearAllTimers()
    currentState = 'idle'
    resetBuffer()
  }

  const dispose = (): void => {
    disposed = true
    cancel()
  }

  return {
    notifyPtyResize,
    ingest,
    preemptOnInput,
    flush,
    cancel,
    dispose,
    state: () => currentState,
    bufferedBytes: () => buffered
  }
}
