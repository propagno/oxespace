import { trimStringToSafeVtTail } from '../../../shared/vt-trim'

/**
 * OXE-471 + OXE-473 · Post-resize atomic redraw guard for interactive
 * normal-buffer CLIs (Antigravity CLI, Claude Code, Codex / Ink on Windows ConPTY).
 *
 * When a pane width (`cols`) changes after a split, sibling close, or panel toggle,
 * ConPTY notifies the running CLI, which often responds in TWO phases over several
 * seconds on long conversations:
 *   1. Phase 1: clears the viewport (`\x1b[2J\x1b[3J\x1b[H`, `\x1b[H\x1b[J`, etc.)
 *      and paints a 1-line stub (`? for shortcuts`) while React/Ink re-renders.
 *   2. Phase 2: streams megabytes of re-wrapped conversation history from turn 1
 *      through turn N in multi-second batches before painting the final prompt.
 *
 * This guard keeps the freshly reflowed xterm canvas visible on screen while
 * coalescing the entire redraw burst off-screen, holding across Phase-1 stubs
 * and mid-history replay batches until the pre-resize bottom anchor reappears
 * (or safety deadlines fire), discarding dead pre-`\x1b[3J` bytes, and flushing
 * the final payload once inside a single DEC 2026 synchronized-output envelope.
 */

/** Window after a `cols`-changing `pty.resize()` during which a screen clear or viewport repaint arms holding. */
export const RESIZE_REDRAW_ARM_MS = 1800
/** Quiet settle time after a normal/completed redraw burst before flushing atomically. */
export const RESIZE_REDRAW_SETTLE_MS = 140
/** Shorter settle time when a DEC 2026 block closes cleanly (`\x1b[?2026l`) without a screen clear. */
export const RESIZE_REDRAW_SYNC_SETTLE_MS = 60
/** Extended quiet settle time when a full viewport collapsed into a clear-to-stub frame (Phase 1). */
export const RESIZE_REDRAW_STUB_SETTLE_MS = 3500
/** Extended quiet settle time while mid-history batches arrive before the bottom anchor returns (Phase 2). */
export const RESIZE_REDRAW_REPLAY_SETTLE_MS = 4500
/** Hard hold deadline for standard redraw bursts without multi-phase replay detection. */
export const RESIZE_REDRAW_MAX_HOLD_MS = 3200
/** Extended hard hold ceiling for multi-phase long-conversation history replays (preempted immediately on keypress). */
export const RESIZE_REDRAW_REPLAY_MAX_HOLD_MS = 14_000
/** High-water cap on held burst bytes (4 MB fits long conversation redraws intact). */
export const RESIZE_REDRAW_MAX_BYTES = 4 * 1024 * 1024

const CLEAR_SCREEN = '\x1b[2J'
const CLEAR_SCROLLBACK = '\x1b[3J'
const CLEAR_TO_END = '\x1b[J'
const CLEAR_TO_END_ZERO = '\x1b[0J'
const FULL_RESET = '\x1bc'
const SYNC_BEGIN = '\x1b[?2026h'
const SYNC_END = '\x1b[?2026l'
const CLEAR_PROLOGUE_TOKENS = [CLEAR_SCREEN, '\x1b[H', '\x1b[1;1H', '\x1b[?25l', SYNC_BEGIN]
const MIN_ANCHOR_VIEWPORT_LINES = 8
const MAX_STUB_VISIBLE_LINES = 4
const TAIL_ANCHOR_SCAN_BYTES = 6 * 1024
const CARRY_LIMIT = 16

const ANSI_STRIP_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g
const BOX_RULE_ONLY_RE = /^[\s─━═\-_•·=]+$/
const HOME_CURSOR_RE = /\x1b\[(?:1;1|1;|;1)?H/
const LINE_ERASE_OR_HIDE_RE = /\x1b\[(?:[02]?K|\?25l)/
const INK_ERASE_UP_RE = /\x1b\[(?:\d*A|2K)/

export type ResizeRedrawGuardState = 'idle' | 'armed' | 'holding'

export interface ResizeViewportAnchor {
  /** Number of non-empty lines visible in the viewport immediately before `pty.resize()`. */
  visibleLines: number
  /** Normalized leading snippets of the last 1–3 substantive non-empty lines at the viewport bottom. */
  bottomAnchors: readonly string[]
  /** Alternate-screen TUIs repaint a single viewport and never emit multi-second scrollback replays. */
  altScreen?: boolean
}

export interface ReadableTerminalViewport {
  rows: number
  buffer: {
    active: {
      type: string
      viewportY: number
      getLine: (y: number) => { translateToString?: (trimRight?: boolean) => string } | undefined | null
    }
  }
}

/**
 * OXE-473 · Snapshot the visible viewport's density and bottom anchor snippets
 * immediately before forwarding a `cols`-changing resize to ConPTY, so
 * `resizeRedrawGuard` can distinguish a Phase-1 blank stub or mid-history batch
 * from the completed bottom prompt frame.
 */
export function captureViewportAnchor(terminal: ReadableTerminalViewport): ResizeViewportAnchor {
  const buf = terminal.buffer.active
  const altScreen = buf.type === 'alternate'
  const startY = Math.max(0, buf.viewportY)
  const endY = startY + Math.max(1, terminal.rows)
  let visibleLines = 0
  const substantive: string[] = []
  for (let y = startY; y < endY; y++) {
    const line = buf.getLine(y)
    if (!line || typeof line.translateToString !== 'function') continue
    const raw = line.translateToString(true).trim()
    if (!raw) continue
    visibleLines += 1
    // Split on wide column padding (`  +`) so left-aligned labels like `? for shortcuts`
    // stay width-independent even if right-aligned status metadata moves or wraps.
    const segment = raw.split(/\s{2,}/).find((part) => part.length >= 6 && !BOX_RULE_ONLY_RE.test(part))
      ?? raw.replace(/\s+/g, ' ')
    if (segment.length >= 6 && !BOX_RULE_ONLY_RE.test(segment)) {
      substantive.push(segment.slice(0, 20))
    }
  }
  return {
    visibleLines,
    bottomAnchors: substantive.slice(-3),
    altScreen
  }
}

export interface ResizeRedrawFlushMeta {
  rawBytes: number
  truncated: boolean
}

export interface ResizeRedrawGuardOptions {
  armMs?: number
  settleMs?: number
  syncSettleMs?: number
  stubSettleMs?: number
  replaySettleMs?: number
  maxHoldMs?: number
  replayMaxHoldMs?: number
  maxBytes?: number
  onFlush: (atomicPayload: string, meta: ResizeRedrawFlushMeta) => void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface ResizeRedrawGuard {
  notifyPtyResize: (cols: number, rows: number, anchor?: ResizeViewportAnchor | null) => void
  ingest: (chunk: string) => boolean
  preemptOnInput: () => void
  flush: () => void
  cancel: () => void
  dispose: () => void
  state: () => ResizeRedrawGuardState
  bufferedBytes: () => number
}

function hasScreenClear(text: string): boolean {
  if (
    text.includes(CLEAR_SCREEN) ||
    text.includes(CLEAR_SCROLLBACK) ||
    text.includes(FULL_RESET)
  ) {
    return true
  }
  if (text.includes(CLEAR_TO_END) || text.includes(CLEAR_TO_END_ZERO)) {
    return HOME_CURSOR_RE.test(text) || text.indexOf(CLEAR_TO_END) < 64 || text.indexOf(CLEAR_TO_END_ZERO) < 64
  }
  return false
}

function hasRedrawTrigger(text: string): boolean {
  if (hasScreenClear(text) || text.includes(SYNC_BEGIN)) return true
  if (HOME_CURSOR_RE.test(text) && LINE_ERASE_OR_HIDE_RE.test(text)) return true
  if (text.includes('\x1b[?25l') && INK_ERASE_UP_RE.test(text)) return true
  return false
}

function closesSyncCleanly(chunk: string): boolean {
  const lastEnd = chunk.lastIndexOf(SYNC_END)
  if (lastEnd === -1) return false
  return chunk.lastIndexOf(SYNC_BEGIN) < lastEnd
}

function updateSyncOpenState(current: boolean, chunk: string): boolean {
  const lastBegin = chunk.lastIndexOf(SYNC_BEGIN)
  const lastEnd = chunk.lastIndexOf(SYNC_END)
  if (lastBegin === -1 && lastEnd === -1) return current
  return lastBegin > lastEnd
}

function findLastClearIndex(text: string): number {
  let idx = -1
  for (const token of [CLEAR_SCROLLBACK, CLEAR_SCREEN, CLEAR_TO_END, CLEAR_TO_END_ZERO, FULL_RESET]) {
    const pos = text.lastIndexOf(token)
    if (pos > idx) idx = pos
  }
  return idx
}

function stripAnsiAndNormalize(text: string): string {
  return text.replace(ANSI_STRIP_RE, '').replace(/\r/g, '\n')
}

function countNonEmptyVisibleLines(text: string, limit: number): number {
  const stripped = stripAnsiAndNormalize(text)
  let count = 0
  let start = 0
  while (start <= stripped.length && count < limit) {
    const nl = stripped.indexOf('\n', start)
    const end = nl === -1 ? stripped.length : nl
    let hasInk = false
    for (let i = start; i < end; i++) {
      if (stripped.charCodeAt(i) > 32) {
        hasInk = true
        break
      }
    }
    if (hasInk) count += 1
    if (nl === -1) break
    start = nl + 1
  }
  return count
}

function extractTailText(chunks: readonly string[], maxBytes: number): string {
  let remaining = maxBytes
  const parts: string[] = []
  for (let i = chunks.length - 1; i >= 0 && remaining > 0; i--) {
    const chunk = chunks[i]
    if (chunk.length <= remaining) {
      parts.push(chunk)
      remaining -= chunk.length
    } else {
      parts.push(chunk.slice(chunk.length - remaining))
      remaining = 0
    }
  }
  parts.reverse()
  return parts.length === 1 ? parts[0] : parts.join('')
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
  const stubSettleMs = options.stubSettleMs ?? RESIZE_REDRAW_STUB_SETTLE_MS
  const replaySettleMs = options.replaySettleMs ?? RESIZE_REDRAW_REPLAY_SETTLE_MS
  const maxHoldMs = options.maxHoldMs ?? RESIZE_REDRAW_MAX_HOLD_MS
  const replayMaxHoldMs = Math.max(maxHoldMs, options.replayMaxHoldMs ?? RESIZE_REDRAW_REPLAY_MAX_HOLD_MS)
  const maxBytes = Math.max(1, options.maxBytes ?? RESIZE_REDRAW_MAX_BYTES)
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let currentState: ResizeRedrawGuardState = 'idle'
  let lastCols: number | null = null
  let currentAnchor: ResizeViewportAnchor | null = null
  let escapeCarry = ''
  let chunks: string[] = []
  let buffered = 0
  let rawBytes = 0
  let truncated = false
  let seenClear = false
  let syncOpen = false
  let visibleLinesSinceClear = 0
  let holdStartedAt = 0
  let currentMaxHoldLimit = maxHoldMs
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
    seenClear = false
    syncOpen = false
    visibleLinesSinceClear = 0
    escapeCarry = ''
    currentMaxHoldLimit = maxHoldMs
  }

  const scheduleSettle = (delayMs: number): void => {
    clearSettleTimer()
    settleTimer = setTimer(() => {
      settleTimer = null
      flush()
    }, delayMs)
  }

  const scheduleMaxHold = (limitMs: number): void => {
    const elapsed = holdStartedAt > 0 ? Math.max(0, Date.now() - holdStartedAt) : 0
    const remaining = Math.max(1, limitMs - elapsed)
    currentMaxHoldLimit = limitMs
    clearMaxHoldTimer()
    maxHoldTimer = setTimer(() => {
      maxHoldTimer = null
      flush()
    }, remaining)
  }

  const ensureReplayHoldCeiling = (): void => {
    if (currentMaxHoldLimit >= replayMaxHoldMs) return
    scheduleMaxHold(replayMaxHoldMs)
  }

  const updateVisibleLinesSinceClear = (chunk: string): void => {
    const clearIdx = findLastClearIndex(chunk)
    if (clearIdx >= 0) {
      seenClear = true
      visibleLinesSinceClear = countNonEmptyVisibleLines(chunk.slice(clearIdx), MIN_ANCHOR_VIEWPORT_LINES + 4)
      return
    }
    if (!seenClear) return
    const cap = MIN_ANCHOR_VIEWPORT_LINES + 4
    if (visibleLinesSinceClear < cap) {
      visibleLinesSinceClear = Math.min(cap, visibleLinesSinceClear + countNonEmptyVisibleLines(chunk, cap - visibleLinesSinceClear))
    }
  }

  const tailMatchesBottomAnchor = (): boolean => {
    const anchors = currentAnchor?.bottomAnchors
    if (!anchors || anchors.length === 0) return true
    const rawTail = extractTailText(chunks, TAIL_ANCHOR_SCAN_BYTES)
    const lastClear = findLastClearIndex(rawTail)
    const postClearTail = lastClear >= 0 ? rawTail.slice(lastClear) : rawTail
    const tail = stripAnsiAndNormalize(postClearTail)
      .replace(/\s+/g, ' ')
      .trim()
    if (!tail) return false
    return anchors.some((anchor) => anchor.length > 0 && tail.includes(anchor))
  }

  const computeSettleDelay = (chunk: string): number => {
    const anchor = currentAnchor
    const canTrackMultiPhase = Boolean(
      anchor && !anchor.altScreen && anchor.visibleLines >= MIN_ANCHOR_VIEWPORT_LINES
    )

    if (syncOpen) {
      if (canTrackMultiPhase) ensureReplayHoldCeiling()
      return canTrackMultiPhase ? stubSettleMs : settleMs
    }

    if (canTrackMultiPhase && seenClear && anchor) {
      const stubCeiling = Math.min(MAX_STUB_VISIBLE_LINES, Math.floor(anchor.visibleLines / 3))
      if (!truncated && visibleLinesSinceClear <= stubCeiling) {
        // Phase 1 clear-to-stub collapse (e.g. `? for shortcuts` alone after wiping 25 lines):
        // keep the pre-resize reflowed canvas on screen while Phase 2 history layout renders.
        ensureReplayHoldCeiling()
        return stubSettleMs
      }
      if (anchor.bottomAnchors.length > 0 && !tailMatchesBottomAnchor()) {
        // Phase 2 mid-history replay (e.g. Turn 1..25 before the bottom prompt returns):
        // wait across multi-second Ink/CLI render batches instead of exposing ancient turns.
        ensureReplayHoldCeiling()
        return replaySettleMs
      }
    }

    return !seenClear && !hasScreenClear(chunk) && closesSyncCleanly(chunk) ? syncSettleMs : settleMs
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
      currentAnchor = null
      resetBuffer()
      return
    }
    const combined = chunks.length === 1 ? chunks[0] : chunks.join('')
    const meta: ResizeRedrawFlushMeta = { rawBytes, truncated }
    currentState = 'idle'
    currentAnchor = null
    resetBuffer()
    if (disposed) return
    const effective = trimBeforeLastScrollbackClear(combined)
    const cleaned = stripSyncMarkers(effective)
    // Keep any truncation clear INSIDE the DEC 2026 envelope so xterm never paints a blank frame.
    const body = meta.truncated ? `${CLEAR_SCREEN}\x1b[H${cleaned}` : cleaned
    options.onFlush(`${SYNC_BEGIN}${body}${SYNC_END}`, meta)
  }

  const notifyPtyResize = (cols: number, _rows: number, anchor?: ResizeViewportAnchor | null): void => {
    if (disposed) return
    // Initial mount only records baseline width so startup prompts are never delayed.
    if (lastCols === null) {
      lastCols = cols
      return
    }
    // Height-only or same-width resizes do not trigger column re-wrapping redraw storms.
    if (cols === lastCols) return
    lastCols = cols
    if (anchor !== undefined) currentAnchor = anchor

    if (currentState === 'holding') {
      holdStartedAt = Date.now()
      scheduleMaxHold(currentMaxHoldLimit)
      scheduleSettle(settleMs)
      return
    }

    currentState = 'armed'
    escapeCarry = ''
    clearArmTimer()
    armTimer = setTimer(() => {
      armTimer = null
      if (currentState === 'armed') {
        currentState = 'idle'
        currentAnchor = null
        escapeCarry = ''
      }
    }, armMs)
  }

  const ingest = (chunk: string): boolean => {
    if (disposed || !chunk) return false
    if (currentState === 'idle') return false

    if (currentState === 'armed') {
      const probe = escapeCarry ? escapeCarry + chunk : chunk
      if (!hasRedrawTrigger(probe)) {
        escapeCarry = probe.length > CARRY_LIMIT ? probe.slice(-CARRY_LIMIT) : probe
        return false
      }
      clearArmTimer()
      escapeCarry = ''
      currentState = 'holding'
      holdStartedAt = Date.now()
      chunks = [chunk]
      buffered = chunk.length
      rawBytes = chunk.length
      truncated = false
      seenClear = hasScreenClear(probe)
      syncOpen = updateSyncOpenState(false, probe)
      visibleLinesSinceClear = 0
      updateVisibleLinesSinceClear(probe)
      enforceByteCap()
      scheduleMaxHold(maxHoldMs)
      scheduleSettle(computeSettleDelay(probe))
      return true
    }

    // holding
    chunks.push(chunk)
    buffered += chunk.length
    rawBytes += chunk.length
    if (hasScreenClear(chunk)) seenClear = true
    syncOpen = updateSyncOpenState(syncOpen, chunk)
    updateVisibleLinesSinceClear(chunk)
    enforceByteCap()
    scheduleSettle(computeSettleDelay(chunk))
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
      currentAnchor = null
      escapeCarry = ''
    }
  }

  const cancel = (): void => {
    clearAllTimers()
    currentState = 'idle'
    currentAnchor = null
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
