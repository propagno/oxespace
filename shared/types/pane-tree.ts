// F2 · recursive split-tree layout (Orca "Split Anything" model).
// Replaces the fixed row×column grid with an arbitrary binary split tree whose
// leaves reference pane records by id. `direction` is the layout axis:
// 'horizontal' = side-by-side, 'vertical' = stacked.
//
// The renderer positions leaves via absolute CSS rects from `computeLayout`
// (not by nesting React), so a pane's React identity is stable across splits and
// resizes — its terminal never remounts.

export type SplitDirection = 'horizontal' | 'vertical'

export interface PaneLeaf {
  kind: 'leaf'
  paneId: string
}

export interface PaneSplit {
  kind: 'split'
  direction: SplitDirection
  children: PaneNode[]
  /** Child sizes in percent (sum ~100). Omitted ⇒ equal split. */
  sizes?: number[]
}

export type PaneNode = PaneLeaf | PaneSplit

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface LeafRect extends Rect {
  paneId: string
}

export interface ResizeHandle extends Rect {
  /** Child indices from the root down to the split node this handle resizes. */
  path: number[]
  /** The handle sits between children `index` and `index + 1`. */
  index: number
  direction: SplitDirection
  /** The split's size (percent of container) along its axis — converts a pixel
   *  drag into a percent delta relative to this split. */
  extent: number
}

const MIN_SIZE_PCT = 6

export function isLeaf(node: PaneNode): node is PaneLeaf {
  return node.kind === 'leaf'
}

/** All pane ids referenced by the tree, in visual (depth-first) order. */
export function collectPaneIds(node: PaneNode | null): string[] {
  if (!node) return []
  if (node.kind === 'leaf') return [node.paneId]
  return node.children.flatMap(collectPaneIds)
}

function resolveSizes(sizes: number[] | undefined, n: number): number[] {
  if (sizes && sizes.length === n) {
    const total = sizes.reduce((a, b) => a + b, 0)
    if (total > 0) return sizes.map((s) => (s / total) * 100)
  }
  return Array.from({ length: n }, () => 100 / n)
}

/** Collapse degenerate splits (0/1 child) and flatten same-direction nesting,
 *  preserving child proportions. Keeps the tree minimal after edits. */
export function normalize(node: PaneNode | null): PaneNode | null {
  if (!node || node.kind === 'leaf') return node
  const parentSizes = resolveSizes(node.sizes, node.children.length)
  const outChildren: PaneNode[] = []
  const outSizes: number[] = []
  node.children.forEach((child, i) => {
    const nc = normalize(child)
    if (!nc) return
    const share = parentSizes[i]
    if (nc.kind === 'split' && nc.direction === node.direction) {
      const childSizes = resolveSizes(nc.sizes, nc.children.length)
      nc.children.forEach((gc, j) => {
        outChildren.push(gc)
        outSizes.push((share * childSizes[j]) / 100)
      })
    } else {
      outChildren.push(nc)
      outSizes.push(share)
    }
  })
  if (outChildren.length === 0) return null
  if (outChildren.length === 1) return outChildren[0]
  const total = outSizes.reduce((a, b) => a + b, 0) || 1
  return { kind: 'split', direction: node.direction, children: outChildren, sizes: outSizes.map((s) => (s / total) * 100) }
}

/** Build an initial tree from grid-positioned panes: rows stacked vertically,
 *  each row's panes side-by-side (equal sizes). Preserves existing workspaces. */
export function buildTreeFromPanes(
  panes: Array<{ id: string; rowIndex: number; columnIndex: number }>
): PaneNode | null {
  if (panes.length === 0) return null
  const rows = [...new Set(panes.map((p) => p.rowIndex))].sort((a, b) => a - b)
  const rowNodes: PaneNode[] = rows.map((row) => {
    const cols = panes
      .filter((p) => p.rowIndex === row)
      .sort((a, b) => a.columnIndex - b.columnIndex)
      .map((p): PaneLeaf => ({ kind: 'leaf', paneId: p.id }))
    return cols.length === 1 ? cols[0] : { kind: 'split', direction: 'horizontal', children: cols }
  })
  const tree: PaneNode = rowNodes.length === 1 ? rowNodes[0] : { kind: 'split', direction: 'vertical', children: rowNodes }
  return normalize(tree)
}

/** Replace the leaf for `targetPaneId` with a split of [target, new] (50/50). */
export function splitLeaf(
  node: PaneNode | null,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection,
  after = true
): PaneNode | null {
  if (!node) return node
  if (node.kind === 'leaf') {
    if (node.paneId !== targetPaneId) return node
    const target: PaneLeaf = { kind: 'leaf', paneId: targetPaneId }
    const added: PaneLeaf = { kind: 'leaf', paneId: newPaneId }
    return { kind: 'split', direction, children: after ? [target, added] : [added, target], sizes: [50, 50] }
  }
  return {
    kind: 'split',
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map((c) => splitLeaf(c, targetPaneId, newPaneId, direction, after) as PaneNode)
  }
}

/** Remove the leaf for `paneId`, collapsing single-child splits (sizes reset). */
export function removeLeaf(node: PaneNode | null, paneId: string): PaneNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return node.paneId === paneId ? null : node
  const children = node.children
    .map((c) => removeLeaf(c, paneId))
    .filter((c): c is PaneNode => c !== null)
  // Sizes are dropped when membership changes; normalize resolves to equal.
  return normalize({ kind: 'split', direction: node.direction, children })
}

/** Drag-to-split: detach `paneId` and re-insert it beside `targetPaneId` along
 *  `direction` (`after` = right/bottom half). No-op when the move is degenerate
 *  (same pane, missing ids, or the tree would lose panes). */
export function moveLeaf(
  node: PaneNode | null,
  paneId: string,
  targetPaneId: string,
  direction: SplitDirection,
  after = true
): PaneNode | null {
  if (!node || paneId === targetPaneId) return node
  const ids = collectPaneIds(node)
  if (!ids.includes(paneId) || !ids.includes(targetPaneId)) return node
  const without = removeLeaf(node, paneId)
  if (!without) return node
  return normalize(splitLeaf(without, targetPaneId, paneId, direction, after))
}

/** Adjust the boundary between children `index`/`index+1` of the split at `path`
 *  by `deltaPct` (percent of that split's extent), clamped to MIN_SIZE_PCT. */
export function resizeSplit(
  node: PaneNode | null,
  path: number[],
  index: number,
  deltaPct: number
): PaneNode | null {
  if (!node || node.kind === 'leaf') return node
  if (path.length === 0) {
    const sizes = resolveSizes(node.sizes, node.children.length).slice()
    let a = sizes[index] + deltaPct
    let b = sizes[index + 1] - deltaPct
    if (a < MIN_SIZE_PCT) { b -= MIN_SIZE_PCT - a; a = MIN_SIZE_PCT }
    if (b < MIN_SIZE_PCT) { a -= MIN_SIZE_PCT - b; b = MIN_SIZE_PCT }
    sizes[index] = a
    sizes[index + 1] = b
    return { ...node, sizes }
  }
  const [head, ...rest] = path
  return {
    ...node,
    children: node.children.map((c, i) => (i === head ? (resizeSplit(c, rest, index, deltaPct) as PaneNode) : c))
  }
}

/** Compute absolute rects (percent of container) for every leaf, plus the
 *  resize handles at split boundaries. Drives the flat-list renderer. */
export function computeLayout(node: PaneNode | null): { rects: LeafRect[]; handles: ResizeHandle[] } {
  const rects: LeafRect[] = []
  const handles: ResizeHandle[] = []
  const walk = (n: PaneNode, rect: Rect, path: number[]): void => {
    if (n.kind === 'leaf') {
      rects.push({ paneId: n.paneId, ...rect })
      return
    }
    const sizes = resolveSizes(n.sizes, n.children.length)
    let offset = 0
    n.children.forEach((child, i) => {
      const frac = sizes[i] / 100
      const childRect: Rect =
        n.direction === 'horizontal'
          ? { left: rect.left + offset * rect.width, top: rect.top, width: frac * rect.width, height: rect.height }
          : { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: frac * rect.height }
      walk(child, childRect, [...path, i])
      if (i < n.children.length - 1) {
        const boundary = offset + frac
        handles.push(
          n.direction === 'horizontal'
            ? { path, index: i, direction: n.direction, extent: rect.width, left: rect.left + boundary * rect.width, top: rect.top, width: 0, height: rect.height }
            : { path, index: i, direction: n.direction, extent: rect.height, left: rect.left, top: rect.top + boundary * rect.height, width: rect.width, height: 0 }
        )
      }
      offset += frac
    })
  }
  if (node) walk(node, { left: 0, top: 0, width: 100, height: 100 }, [])
  return { rects, handles }
}
