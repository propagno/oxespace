/**
 * Whether a pane has room to be split in two. Each split halves the pane, so splitting the same area again and again
 * left panes 90 px wide with unreadable titles and a terminal too narrow to use. Like VS Code's editor groups and
 * Windows Terminal's panes, a split that would go below a usable minimum is refused instead of squeezed.
 */
export const MIN_PANE_WIDTH_PX = 240
export const MIN_PANE_HEIGHT_PX = 120
/** The gap the split grid keeps between two panes (WorkspaceSplitGrid: 2 × PANE_HALF_GAP_PX). */
const SPLIT_GAP_PX = 10

/** `vertical` puts the new pane beside this one (each gets half the width); `horizontal` below it (half the height). */
export function splitHasRoom(size: { width: number; height: number }, direction: 'vertical' | 'horizontal'): boolean {
  const half = (length: number): number => (length - SPLIT_GAP_PX) / 2
  return direction === 'vertical' ? half(size.width) >= MIN_PANE_WIDTH_PX : half(size.height) >= MIN_PANE_HEIGHT_PX
}

/** The pane's size on screen, or null when it is not drawn (hidden workspace, maximized elsewhere): then nothing is refused. */
export function paneSize(paneId: string): { width: number; height: number } | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector<HTMLElement>(`[data-testid="pane-container"][data-pane-id="${CSS.escape(paneId)}"]`)
  const rect = element?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null
}
