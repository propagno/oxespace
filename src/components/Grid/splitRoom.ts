/**
 * Whether a pane has room to be split in two. Each split halves the pane, so splitting the same area again and again
 * left panes 90 px wide with unreadable titles and a terminal too narrow to use. Like VS Code's editor groups and
 * Windows Terminal's panes, a split that would go below a usable minimum is refused instead of squeezed.
 */
import { computeLayout, type PaneNode } from '../../../shared/types/pane-tree'

export const MIN_PANE_WIDTH_PX = 240
export const MIN_PANE_HEIGHT_PX = 120
/** The gap the split grid keeps between two panes (WorkspaceSplitGrid: 2 × PANE_HALF_GAP_PX). */
const SPLIT_GAP_PX = 10

/** `vertical` puts the new pane beside this one (each gets half the width); `horizontal` below it (half the height). */
export function splitHasRoom(size: { width: number; height: number }, direction: 'vertical' | 'horizontal'): boolean {
  const half = (length: number): number => (length - SPLIT_GAP_PX) / 2
  return direction === 'vertical' ? half(size.width) >= MIN_PANE_WIDTH_PX : half(size.height) >= MIN_PANE_HEIGHT_PX
}

/**
 * The pane's size in the split layout, whatever is maximized: its share of the tree times the grid's size on screen.
 * A maximized pane measured on screen would look big enough, and the split would squeeze both halves on restore.
 */
export function layoutPaneSize(tree: PaneNode | null, paneId: string, grid: { width: number; height: number } | null): { width: number; height: number } | null {
  const rect = tree && grid ? computeLayout(tree).rects.find(item => item.paneId === paneId) : undefined
  if (!rect || !grid) return null
  return { width: rect.width / 100 * grid.width - SPLIT_GAP_PX, height: rect.height / 100 * grid.height - SPLIT_GAP_PX }
}

/** The size of the active workspace's split grid on screen, or null when it is not drawn. */
export function splitGridSize(): { width: number; height: number } | null {
  if (typeof document === 'undefined') return null
  const rect = document.querySelector<HTMLElement>('.workspace-host:not(.workspace-host-hidden) .workspace-split-grid')?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null
}

/** The pane's size on screen, or null when it is not drawn (hidden workspace, maximized elsewhere): then nothing is refused. */
export function paneSize(paneId: string): { width: number; height: number } | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector<HTMLElement>(`[data-testid="pane-container"][data-pane-id="${CSS.escape(paneId)}"]`)
  const rect = element?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null
}
