/** Where the pane's "More pane actions" menu goes: fixed, so the pane does not clip it. */
export interface PaneMenuPlacement {
  top?: number
  bottom?: number
  /** Anchored to the ⋯ button's right edge. */
  right?: number
  /** Anchored at the pointer (a right click on the header, CODE-8). */
  left?: number
  maxHeight: number
}

const GAP = 6
const MARGIN = 8
/** Below this much room under the button (full terminal menu with an expanded submenu, OXE-427), it opens upward if there is more above. */
const COMFORTABLE = 440

/**
 * The menu stays between the window's top and `floor`: the top of the status bar, or the window's bottom when there
 * is none. A pane in the bottom row has little room below its button, so the menu opens upward there instead of
 * running under the status bar, which would take the clicks of its last items (FINDING M: "Close pane").
 */
export function paneMenuPlacement(trigger: Pick<DOMRect, 'top' | 'bottom' | 'right'>, viewport: { width: number; height: number }, floor = viewport.height): PaneMenuPlacement {
  const right = Math.max(MARGIN, viewport.width - trigger.right)
  const below = floor - trigger.bottom - GAP - MARGIN
  const above = trigger.top - GAP - MARGIN
  if (below < COMFORTABLE && above > below) return { bottom: viewport.height - trigger.top + GAP, right, maxHeight: Math.max(0, above) }
  return { top: trigger.bottom + GAP, right, maxHeight: Math.max(0, below) }
}

/** About the menu's width (`min(292px, 80vw)`), so a menu opened at the pointer does not run off the window's right edge. */
const MENU_WIDTH = 292

/**
 * The same menu opened at the pointer by a right click on the pane header (CODE-8): its top-left corner at the pointer,
 * pulled back inside the window, and upward when the pointer is low and there is more room above, as for the button.
 */
export function paneMenuAtPointer(point: { x: number; y: number }, viewport: { width: number; height: number }, floor = viewport.height): PaneMenuPlacement {
  const width = Math.min(MENU_WIDTH, viewport.width * 0.8)
  const left = Math.max(MARGIN, Math.min(point.x, viewport.width - width - MARGIN))
  const below = floor - point.y - MARGIN
  const above = point.y - MARGIN
  if (below < COMFORTABLE && above > below) return { bottom: viewport.height - point.y, left, maxHeight: Math.max(0, above) }
  return { top: point.y, left, maxHeight: Math.max(0, below) }
}

/**
 * Keeps an open menu (especially after expanding a submenu, OXE-427) from clipping its bottom items ("Close pane")
 * when the trigger sits near the middle of the viewport: if `contentHeight` exceeds `placement.maxHeight` while more
 * vertical room exists between `MARGIN` and `floor - MARGIN`, shifts the popover inside that band.
 */
export function fitPaneMenuPlacement(
  placement: PaneMenuPlacement,
  contentHeight: number,
  viewportHeight: number,
  floor = viewportHeight
): PaneMenuPlacement {
  if (contentHeight <= 0 || contentHeight <= placement.maxHeight) return placement
  const available = Math.max(0, floor - MARGIN * 2)
  if (available <= placement.maxHeight) return placement
  const height = Math.min(contentHeight, available)
  const top = Math.max(MARGIN, floor - MARGIN - height)
  return {
    top,
    ...(placement.right !== undefined ? { right: placement.right } : {}),
    ...(placement.left !== undefined ? { left: placement.left } : {}),
    maxHeight: Math.max(0, floor - MARGIN - top)
  }
}

/** The top of the app's status bar, where a menu has to stop; the window's height when no bar is shown. */
export function statusBarFloor(doc: Document = document, height = window.innerHeight): number {
  const tops = [...doc.querySelectorAll('.app-statusbar')].map(bar => bar.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => rect.top)
  return Math.min(height, ...tops)
}
