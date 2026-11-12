import { describe, expect, test } from 'vitest'
import {
  buildTreeFromPanes,
  collectPaneIds,
  computeLayout,
  gridShape,
  moveLeaf,
  normalize,
  placeSplit,
  removeLeaf,
  resizeSplit,
  splitLeaf,
  type PaneNode
} from '../../shared/types/pane-tree'

const panes = (spec: Array<[string, number, number]>) =>
  spec.map(([id, rowIndex, columnIndex]) => ({ id, rowIndex, columnIndex }))

describe('pane-tree', () => {
  test('buildTreeFromPanes: single pane is a leaf', () => {
    expect(buildTreeFromPanes(panes([['a', 0, 0]]))).toEqual({ kind: 'leaf', paneId: 'a' })
  })

  test('buildTreeFromPanes: one row of two → equal horizontal split', () => {
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1]]))
    expect(tree).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      children: [{ kind: 'leaf', paneId: 'a' }, { kind: 'leaf', paneId: 'b' }]
    })
    expect((tree as { sizes: number[] }).sizes).toEqual([50, 50])
  })

  test('buildTreeFromPanes: 2x2 → vertical of two horizontal rows', () => {
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1], ['c', 1, 0], ['d', 1, 1]]))
    expect(collectPaneIds(tree)).toEqual(['a', 'b', 'c', 'd'])
    expect(tree).toMatchObject({ kind: 'split', direction: 'vertical' })
  })

  test('splitLeaf: inserts a new pane beside the target with 50/50 sizes', () => {
    const next = splitLeaf({ kind: 'leaf', paneId: 'a' }, 'a', 'b', 'horizontal')
    expect(next).toEqual({
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [{ kind: 'leaf', paneId: 'a' }, { kind: 'leaf', paneId: 'b' }]
    })
  })

  test('splitLeaf: before=false inserts new pane first', () => {
    const next = splitLeaf({ kind: 'leaf', paneId: 'a' }, 'a', 'b', 'vertical', false)
    expect(collectPaneIds(next)).toEqual(['b', 'a'])
  })

  test('removeLeaf: collapses the parent split when one child remains', () => {
    const tree = splitLeaf({ kind: 'leaf', paneId: 'a' }, 'a', 'b', 'horizontal')
    expect(removeLeaf(tree, 'b')).toEqual({ kind: 'leaf', paneId: 'a' })
  })

  test('removeLeaf: removing the last leaf yields null', () => {
    expect(removeLeaf({ kind: 'leaf', paneId: 'a' }, 'a')).toBeNull()
  })

  test('normalize: flattens same-direction nesting preserving proportions', () => {
    const nested: PaneNode = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [
        { kind: 'leaf', paneId: 'a' },
        { kind: 'split', direction: 'horizontal', sizes: [50, 50], children: [{ kind: 'leaf', paneId: 'b' }, { kind: 'leaf', paneId: 'c' }] }
      ]
    }
    const flat = normalize(nested) as { children: unknown[]; sizes: number[] }
    expect(collectPaneIds(flat as PaneNode)).toEqual(['a', 'b', 'c'])
    expect(flat.sizes.map((s) => Math.round(s))).toEqual([50, 25, 25])
  })

  test('computeLayout: single leaf fills the container', () => {
    const { rects, handles } = computeLayout({ kind: 'leaf', paneId: 'a' })
    expect(rects).toEqual([{ paneId: 'a', left: 0, top: 0, width: 100, height: 100 }])
    expect(handles).toHaveLength(0)
  })

  test('computeLayout: horizontal split → two side-by-side rects + one handle', () => {
    const tree = splitLeaf({ kind: 'leaf', paneId: 'a' }, 'a', 'b', 'horizontal')
    const { rects, handles } = computeLayout(tree)
    expect(rects).toEqual([
      { paneId: 'a', left: 0, top: 0, width: 50, height: 100 },
      { paneId: 'b', left: 50, top: 0, width: 50, height: 100 }
    ])
    expect(handles).toHaveLength(1)
    expect(handles[0]).toMatchObject({ direction: 'horizontal', index: 0, left: 50 })
  })

  test('resizeSplit: shifts the boundary and clamps to a minimum', () => {
    const tree = splitLeaf({ kind: 'leaf', paneId: 'a' }, 'a', 'b', 'horizontal')
    const resized = resizeSplit(tree, [], 0, 10) as { sizes: number[] }
    expect(resized.sizes).toEqual([60, 40])
    const clamped = resizeSplit(tree, [], 0, -100) as { sizes: number[] }
    expect(clamped.sizes[0]).toBeGreaterThanOrEqual(6)
    expect(clamped.sizes[0] + clamped.sizes[1]).toBeCloseTo(100)
  })

  test('split preserves the untouched pane id set', () => {
    let tree: PaneNode | null = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1]]))
    tree = splitLeaf(tree, 'a', 'c', 'vertical')
    expect(collectPaneIds(tree).sort()).toEqual(['a', 'b', 'c'])
  })

  test('moveLeaf: relocates a pane beside the target without losing panes', () => {
    // [a | b | c] → move a below c: [b | (c / a)]
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1], ['c', 0, 2]]))
    const moved = moveLeaf(tree, 'a', 'c', 'vertical')
    expect(collectPaneIds(moved).sort()).toEqual(['a', 'b', 'c'])
    expect(moved).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      children: [
        { kind: 'leaf', paneId: 'b' },
        { kind: 'split', direction: 'vertical', children: [{ kind: 'leaf', paneId: 'c' }, { kind: 'leaf', paneId: 'a' }] }
      ]
    })
  })

  test('moveLeaf: after=false places the moved pane first', () => {
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1]]))
    const moved = moveLeaf(tree, 'b', 'a', 'horizontal', false)
    expect(collectPaneIds(moved)).toEqual(['b', 'a'])
  })

  test('moveLeaf: no-ops on self-drop and unknown ids', () => {
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1]]))
    expect(moveLeaf(tree, 'a', 'a', 'vertical')).toBe(tree)
    expect(moveLeaf(tree, 'zzz', 'a', 'vertical')).toBe(tree)
    expect(moveLeaf(tree, 'a', 'zzz', 'vertical')).toBe(tree)
  })

  test('moveLeaf: two panes swapping orientation stays valid', () => {
    // [a | b] → move b above a: (b / a)
    const tree = buildTreeFromPanes(panes([['a', 0, 0], ['b', 0, 1]]))
    const moved = moveLeaf(tree, 'b', 'a', 'vertical', false)
    expect(moved).toMatchObject({
      kind: 'split',
      direction: 'vertical',
      children: [{ kind: 'leaf', paneId: 'b' }, { kind: 'leaf', paneId: 'a' }]
    })
  })
})

describe('placeSplit: a split pane that sync already placed', () => {
  const leaf = (paneId: string): PaneNode => ({ kind: 'leaf', paneId })
  const widths = (tree: PaneNode | null) => Object.fromEntries(computeLayout(tree).rects.map(rect => [rect.paneId, Math.round(rect.width * 10) / 10]))
  const heights = (tree: PaneNode | null) => Object.fromEntries(computeLayout(tree).rects.map(rect => [rect.paneId, Math.round(rect.height * 10) / 10]))
  // A 2 × 2 grid after sync put "n" beside "a": the top row is a, n, b at 25, 25, 50.
  const synced: PaneNode = { kind: 'split', direction: 'vertical', children: [
    { kind: 'split', direction: 'horizontal', children: [leaf('a'), leaf('n'), leaf('b')], sizes: [25, 25, 50] },
    { kind: 'split', direction: 'horizontal', children: [leaf('c'), leaf('d')] }
  ] }

  test('split right: the two share the origin\'s half, the neighbour keeps its own', () => {
    const tree = placeSplit(synced, 'a', 'n', 'horizontal')
    expect(collectPaneIds(tree)).toEqual(['a', 'n', 'b', 'c', 'd'])
    expect(widths(tree)).toMatchObject({ a: 25, n: 25, b: 50 })
  })

  test('split down: the origin keeps its width and gives half its height', () => {
    const tree = placeSplit(synced, 'a', 'n', 'vertical')
    expect(collectPaneIds(tree)).toEqual(['a', 'n', 'b', 'c', 'd'])
    expect(widths(tree)).toMatchObject({ a: 50, n: 50, b: 50 })
    expect(heights(tree).a).toBeCloseTo(heights(tree).n, 0)
    expect(heights(tree).b).toBeCloseTo(heights(tree).a * 2, 0)
  })

  test('the old path gave the origin a third of the row', () => {
    // What moveLeaf does with the same tree, kept here so the difference stays visible.
    expect(widths(moveLeaf(synced, 'n', 'a', 'vertical'))).toMatchObject({ a: 33.3, b: 66.7 })
  })

  test('a pane placed at the far end of the row gives its share to the origin; the pane between keeps its own', () => {
    const elsewhere: PaneNode = { kind: 'split', direction: 'horizontal', children: [leaf('a'), leaf('b'), leaf('n')], sizes: [40, 40, 20] }
    const tree = placeSplit(elsewhere, 'a', 'n', 'horizontal')
    expect(collectPaneIds(tree)).toEqual(['a', 'n', 'b'])
    expect(widths(tree)).toMatchObject({ a: 30, n: 30, b: 40 })
  })

  test('unknown panes and a pane split from itself change nothing', () => {
    expect(placeSplit(synced, 'a', 'missing', 'horizontal')).toBe(synced)
    expect(placeSplit(synced, 'a', 'a', 'horizontal')).toBe(synced)
  })
})

describe('gridShape: the grid the panes form now', () => {
  const leaf = (paneId: string): PaneNode => ({ kind: 'leaf', paneId })
  const row = (...ids: string[]): PaneNode => ({ kind: 'split', direction: 'horizontal', children: ids.map(leaf) })

  test('one pane, one row, one column', () => {
    expect(gridShape(leaf('a'))).toEqual({ rows: 1, columns: 1 })
    expect(gridShape(row('a', 'b', 'c'))).toEqual({ rows: 1, columns: 3 })
    expect(gridShape({ kind: 'split', direction: 'vertical', children: [leaf('a'), leaf('b')] })).toEqual({ rows: 2, columns: 1 })
  })

  test('rows of the same length are a grid, whatever their sizes', () => {
    const grid: PaneNode = { kind: 'split', direction: 'vertical', sizes: [30, 70], children: [{ ...row('a', 'b'), sizes: [20, 80] } as PaneNode, row('c', 'd')] }
    expect(gridShape(grid)).toEqual({ rows: 2, columns: 2 })
    expect(gridShape({ kind: 'split', direction: 'vertical', children: [row('a', 'b', 'c'), row('d', 'e', 'f')] })).toEqual({ rows: 2, columns: 3 })
  })

  test('columns of the same length are a grid too', () => {
    const column = (...ids: string[]): PaneNode => ({ kind: 'split', direction: 'vertical', children: ids.map(leaf) })
    expect(gridShape({ kind: 'split', direction: 'horizontal', children: [column('a', 'b'), column('c', 'd'), column('e', 'f')] })).toEqual({ rows: 2, columns: 3 })
  })

  test('a fifth pane split from one of four is no grid', () => {
    const five = placeSplit({ kind: 'split', direction: 'vertical', children: [row('a', 'b', 'n'), row('c', 'd')] }, 'a', 'n', 'horizontal')
    expect(collectPaneIds(five)).toHaveLength(5)
    expect(gridShape(five)).toBeNull()
    expect(gridShape({ kind: 'split', direction: 'horizontal', children: [leaf('a'), { kind: 'split', direction: 'vertical', children: [leaf('b'), leaf('c')] }] })).toBeNull()
  })

  test('no tree, no shape', () => {
    expect(gridShape(null)).toBeNull()
  })
})
