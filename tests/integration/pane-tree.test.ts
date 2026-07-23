import { describe, expect, test } from 'vitest'
import {
  buildTreeFromPanes,
  collectPaneIds,
  computeLayout,
  moveLeaf,
  normalize,
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
