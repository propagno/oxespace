/**
 * OXE-484 · Adaptive `smoothScrollDuration` controller & safe `clearTextureAtlas` helper.
 *
 * - Enables smooth scrolling (`125 ms`) during normal interactive pace when the
 *   WebGL2 renderer is active and input is not a precision trackpad gesture.
 * - Automatically disables smooth scrolling (`0 ms`) when output throughput floods
 *   or when falling back to the DOM renderer, and restores it once output settles.
 * - Provides `safeClearTextureAtlas()` to flush glyph atlases on font, DPI/UI-scale,
 *   theme changes, and WebGL context recovery without throwing on mocks/disposed terms.
 */
import type { Terminal } from '@xterm/xterm'

export const SMOOTH_SCROLL_DURATION_MS = 125
export const SMOOTH_SCROLL_FLOOD_BYTES = 32 * 1024
export const SMOOTH_SCROLL_FLOOD_WINDOW_MS = 250
export const SMOOTH_SCROLL_RECOVER_IDLE_MS = 600
export const SMOOTH_SCROLL_TRACKPAD_COOLDOWN_MS = 400

export function safeClearTextureAtlas(
  terminal: { clearTextureAtlas?: () => void } | null | undefined
): boolean {
  try {
    if (typeof terminal?.clearTextureAtlas === 'function') {
      terminal.clearTextureAtlas()
      return true
    }
  } catch {
    /* renderer unavailable or terminal already disposed */
  }
  return false
}

export interface AdaptiveSmoothScrollOptions {
  terminal: Pick<Terminal, 'options'>
  defaultDurationMs?: number
  floodBytesThreshold?: number
  floodWindowMs?: number
  recoverIdleMs?: number
  trackpadCooldownMs?: number
  webglActive?: boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}

export interface AdaptiveSmoothScrollController {
  recordThroughput(bytes: number): void
  setWebglActive(active: boolean): void
  onWheel(event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): void
  currentDuration(): number
  isFlooding(): boolean
  isWebglActive(): boolean
  dispose(): void
}

export function createAdaptiveSmoothScrollController(
  options: AdaptiveSmoothScrollOptions
): AdaptiveSmoothScrollController {
  const defaultDurationMs = Math.max(0, options.defaultDurationMs ?? SMOOTH_SCROLL_DURATION_MS)
  const floodBytesThreshold = Math.max(1, options.floodBytesThreshold ?? SMOOTH_SCROLL_FLOOD_BYTES)
  const floodWindowMs = Math.max(1, options.floodWindowMs ?? SMOOTH_SCROLL_FLOOD_WINDOW_MS)
  const recoverIdleMs = Math.max(1, options.recoverIdleMs ?? SMOOTH_SCROLL_RECOVER_IDLE_MS)
  const trackpadCooldownMs = Math.max(1, options.trackpadCooldownMs ?? SMOOTH_SCROLL_TRACKPAD_COOLDOWN_MS)
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((id: ReturnType<typeof setTimeout>) => clearTimeout(id))

  let webglActive = options.webglActive ?? false
  let flooding = false
  let trackpadActive = false
  let windowStartedAt = 0
  let windowBytes = 0
  let recoverTimer: ReturnType<typeof setTimeout> | null = null
  let trackpadTimer: ReturnType<typeof setTimeout> | null = null
  let appliedDuration: number | null = null
  let disposed = false

  const computeDuration = (): number =>
    webglActive && !flooding && !trackpadActive ? defaultDurationMs : 0

  const syncOption = (): void => {
    if (disposed) return
    const next = computeDuration()
    if (appliedDuration === next) return
    appliedDuration = next
    try {
      options.terminal.options.smoothScrollDuration = next
    } catch {
      /* terminal already disposed */
    }
  }

  const clearRecoverTimer = (): void => {
    if (recoverTimer !== null) {
      clearTimer(recoverTimer)
      recoverTimer = null
    }
  }

  const clearTrackpadTimer = (): void => {
    if (trackpadTimer !== null) {
      clearTimer(trackpadTimer)
      trackpadTimer = null
    }
  }

  const scheduleRecovery = (): void => {
    clearRecoverTimer()
    recoverTimer = setTimer(() => {
      recoverTimer = null
      flooding = false
      windowBytes = 0
      windowStartedAt = 0
      syncOption()
    }, recoverIdleMs)
  }

  const recordThroughput = (bytes: number): void => {
    if (disposed || bytes <= 0 || !Number.isFinite(bytes)) return
    const current = now()
    if (windowStartedAt === 0 || current - windowStartedAt >= floodWindowMs) {
      windowStartedAt = current
      windowBytes = bytes
    } else {
      windowBytes += bytes
    }

    if (windowBytes >= floodBytesThreshold) {
      flooding = true
      syncOption()
      scheduleRecovery()
    } else if (flooding) {
      // Sustained activity while recovering keeps smooth scroll disabled until truly calm.
      scheduleRecovery()
    }
  }

  const setWebglActive = (active: boolean): void => {
    if (disposed) return
    webglActive = Boolean(active)
    syncOption()
  }

  const onWheel = (event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): void => {
    if (disposed) return
    const absY = Math.abs(event.deltaY)
    if (absY === 0) return
    // Precision trackpads emit small pixel-mode deltas; physical wheel detents emit line/page or >=40px jumps.
    const isTrackpad = event.deltaMode === 0 && absY < 40
    if (isTrackpad) {
      trackpadActive = true
      syncOption()
      clearTrackpadTimer()
      trackpadTimer = setTimer(() => {
        trackpadTimer = null
        trackpadActive = false
        syncOption()
      }, trackpadCooldownMs)
    } else if (trackpadActive) {
      clearTrackpadTimer()
      trackpadActive = false
      syncOption()
    }
  }

  // Apply initial duration immediately so DOM fallback starts at 0 ms.
  syncOption()

  const dispose = (): void => {
    disposed = true
    clearRecoverTimer()
    clearTrackpadTimer()
  }

  return {
    recordThroughput,
    setWebglActive,
    onWheel,
    currentDuration: () => appliedDuration ?? computeDuration(),
    isFlooding: () => flooding,
    isWebglActive: () => webglActive,
    dispose
  }
}
