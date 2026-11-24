/**
 * Whether a pane has room to be split in two. Each split halves the pane, so splitting the same area again and again
 * left panes 90 px wide with unreadable titles and a terminal too narrow to use. Like VS Code's editor groups and
 * Windows Terminal's panes, a split that would go below a usable minimum is refused instead of squeezed.
 */
import { computeLayout, moveLeaf, type PaneNode, type SplitDirection } from '../../../shared/types/pane-tree'

export const MIN_PANE_WIDTH_PX = 240
export const MIN_PANE_HEIGHT_PX = 120
/**
 * The split grid's gutters, as WorkspaceSplitGrid insets each pane (insetPaneRect): var(--space-2), 8 px, on a side that
 * touches the grid's edge, and half of it, 4 px, on each side of the gap between two panes. A pane at an edge so loses
 * 8 + 4 = 12 px of its share, one in the middle 4 + 4 = 8 px (OXE-344: a flat 10 px let a split leave 238 px).
 */
export const PANE_OUTER_GUTTER_PX = 8
export const PANE_HALF_GAP_PX = PANE_OUTER_GUTTER_PX / 2
const EDGE_EPSILON = 0.001

/** Which sides of a pane touch the grid's edge. */
export type PaneEdges = { left: boolean; right: boolean; top: boolean; bottom: boolean }
/** A pane's size on screen; without `edges` (a pane measured on screen) the worst case is assumed. */
export type PaneRoom = { width: number; height: number; edges?: PaneEdges }

const inset = (atEdge: boolean): number => (atEdge ? PANE_OUTER_GUTTER_PX : PANE_HALF_GAP_PX)

/**
 * The smaller of the two halves a split would leave, on screen. A pane of on-screen length L between insets a and b has
 * a share of L + a + b; each half keeps its own outer inset and gains a half gap at the cut, so the smaller half is
 * (L − |a − b|) / 2 − 4. Unknown edges count as one side at the edge and the other inside, the worst case.
 */
export function splitHalf(size: PaneRoom, direction: 'vertical' | 'horizontal'): { width: number; height: number } {
  const smaller = (length: number, a: number, b: number): number => (length - Math.abs(a - b)) / 2 - PANE_HALF_GAP_PX
  const worst = PANE_OUTER_GUTTER_PX - PANE_HALF_GAP_PX
  const edges = size.edges
  if (direction === 'vertical') {
    const width = edges ? smaller(size.width, inset(edges.left), inset(edges.right)) : (size.width - worst) / 2 - PANE_HALF_GAP_PX
    return { width, height: size.height }
  }
  const height = edges ? smaller(size.height, inset(edges.top), inset(edges.bottom)) : (size.height - worst) / 2 - PANE_HALF_GAP_PX
  return { width: size.width, height }
}

/** `vertical` puts the new pane beside this one (each gets half the width); `horizontal` below it (half the height). */
export function splitHasRoom(size: PaneRoom, direction: 'vertical' | 'horizontal'): boolean {
  const half = splitHalf(size, direction)
  return direction === 'vertical' ? half.width >= MIN_PANE_WIDTH_PX : half.height >= MIN_PANE_HEIGHT_PX
}

/**
 * The pane's size in the split layout, whatever is maximized: its share of the tree times the grid's size on screen,
 * less the grid's real insets on each side. A maximized pane measured on screen would look big enough, and the split
 * would squeeze both halves on restore.
 */
export function layoutPaneSize(tree: PaneNode | null, paneId: string, grid: { width: number; height: number } | null): PaneRoom | null {
  const rect = tree && grid ? computeLayout(tree).rects.find(item => item.paneId === paneId) : undefined
  if (!rect || !grid) return null
  const edges: PaneEdges = {
    left: rect.left <= EDGE_EPSILON,
    top: rect.top <= EDGE_EPSILON,
    right: rect.left + rect.width >= 100 - EDGE_EPSILON,
    bottom: rect.top + rect.height >= 100 - EDGE_EPSILON,
  }
  return {
    width: rect.width / 100 * grid.width - inset(edges.left) - inset(edges.right),
    height: rect.height / 100 * grid.height - inset(edges.top) - inset(edges.bottom),
    edges,
  }
}

/**
 * Whether moving a pane beside another (drag-to-split, Arrange) leaves both at a usable size (OXE-365). The move is laid
 * out as the store would apply it (`moveLeaf`): the pane leaves its place, which its neighbours take, and shares the
 * target's area. A pane already under the minimum may stay that size, but a move never squeezes one further below it.
 */
export function moveHasRoom(
  tree: PaneNode | null,
  paneId: string,
  targetPaneId: string,
  direction: SplitDirection,
  after: boolean,
  grid: { width: number; height: number } | null
): boolean {
  if (!tree || !grid) return true
  const moved = moveLeaf(tree, paneId, targetPaneId, direction, after)
  return [paneId, targetPaneId].every(id => {
    const was = layoutPaneSize(tree, id, grid)
    const will = layoutPaneSize(moved, id, grid)
    if (!was || !will) return true
    const narrower = will.width < MIN_PANE_WIDTH_PX && will.width < was.width
    const shorter = will.height < MIN_PANE_HEIGHT_PX && will.height < was.height
    return !narrower && !shorter
  })
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
