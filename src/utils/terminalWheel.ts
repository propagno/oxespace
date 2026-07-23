/**
 * Translate mouse-wheel events into PTY key sequences when a full-screen TUI
 * (Grok, Claude Code, etc.) is on the alternate screen without mouse tracking.
 *
 * Alt-screen has no xterm scrollback, so the default wheel handler does nothing
 * useful. Sending PageUp/PageDown (or arrow keys for fine trackpad motion) lets
 * the TUI scroll its own viewport.
 *
 * Returns the string to write to the PTY, or null if xterm should handle the
 * wheel natively (normal buffer, or app-owned mouse tracking).
 */
export function wheelToTuiScrollKeys(
  opts: {
    bufferType: 'normal' | 'alternate'
    mouseTrackingMode: string
    deltaY: number
    deltaMode: number
    ctrlKey?: boolean
    altKey?: boolean
    metaKey?: boolean
  }
): string | null {
  if (opts.bufferType !== 'alternate') return null
  if (opts.mouseTrackingMode !== 'none') return null
  if (opts.ctrlKey || opts.altKey || opts.metaKey) return null
  if (opts.deltaY === 0) return null

  const up = opts.deltaY < 0
  // Line-based wheels (mouse) and large pixel deltas → page scroll (Grok pager).
  // Small trackpad deltas → a few cursor keys for smoother movement.
  const isLineMode = opts.deltaMode === 1 /* DOM_DELTA_LINE */
  const isPageMode = opts.deltaMode === 2 /* DOM_DELTA_PAGE */
  const magnitude = Math.abs(opts.deltaY)

  if (isPageMode || isLineMode || magnitude >= 90) {
    return up ? '\x1b[5~' : '\x1b[6~' // PageUp / PageDown
  }

  const notches = Math.max(1, Math.min(8, Math.round(magnitude / 40)))
  const key = up ? '\x1b[A' : '\x1b[B'
  return key.repeat(notches)
}
