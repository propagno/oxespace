export const MIN_DOCK_WIDTH_PX = 320
export const MAX_DOCK_WIDTH_PX = 900
export const NARROW_DOCK_MAX_WIDTH_PX = 420
export const NARROW_DOCK_WINDOW_PX = 900

/** Clamps the workbench dock width to 320–900 px, capped at 420 px when the window is 900 px wide or narrower. */
export function clampDockWidth(width: number, windowWidth: number): number {
  const max = windowWidth <= NARROW_DOCK_WINDOW_PX ? NARROW_DOCK_MAX_WIDTH_PX : MAX_DOCK_WIDTH_PX
  return Math.min(max, Math.max(MIN_DOCK_WIDTH_PX, width))
}
