import { beforeEach, describe, expect, test } from 'vitest'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import type { WorkspacePane } from '../../shared/types/workspace'
import { computeLayout } from '../../shared/types/pane-tree'

function pane(id: string, row = 0, col = 0): WorkspacePane {
  return {
    id,
    workspaceId: 'ws-1',
    type: 'terminal',
    rowIndex: row,
    columnIndex: col,
    shellProfileId: 'builtin-claude',
    status: 'idle',
    agentProfileId: null,
    agentName: null,
    displayName: null,
    createdAt: null,
    modelOverride: null,
    rootPath: null
  }
}

describe('pane-layout.store', () => {
  test('recovers malformed storage and excludes helper panes', () => {
    usePaneLayoutStore.setState({ trees: { 'ws-1': { kind: 'split', direction: 'horizontal', children: null } as never } })
    usePaneLayoutStore.getState().sync('ws-1', [pane('a'), pane('helper', -1, -1)])
    expect(usePaneLayoutStore.getState().trees['ws-1']).toEqual({ kind: 'leaf', paneId: 'a' })
  })
  test('places delegated third pane below its origin and keeps unrelated proportions', () => {
    const store = usePaneLayoutStore.getState()
    store.sync('ws-1', [pane('a'), pane('b', 0, 1)])
    store.sync('ws-1', [pane('a'), pane('b', 0, 1), { ...pane('c', 0, 2), originPaneId: 'b' }])
    expect(usePaneLayoutStore.getState().trees['ws-1']).toMatchObject({
      direction: 'horizontal', sizes: [50, 50], children: [
        { paneId: 'a' }, { direction: 'vertical', children: [{ paneId: 'b' }, { paneId: 'c' }] }
      ]
    })
    const before = usePaneLayoutStore.getState().trees['ws-1']
    store.sync('ws-1', [pane('a'), pane('b', 0, 1), pane('c', 0, 2)])
    expect(usePaneLayoutStore.getState().trees['ws-1']).toBe(before)
  })
  test('manual split after reconciliation does not duplicate a pane', () => {
    const store = usePaneLayoutStore.getState()
    store.sync('ws-1', [pane('a'), pane('b', 0, 1)])
    store.split('ws-1', 'a', 'b', 'vertical')
    expect(JSON.stringify(usePaneLayoutStore.getState().trees['ws-1']).match(/"paneId":"b"/g)).toHaveLength(1)
  })
  beforeEach(() => {
    usePaneLayoutStore.setState({ trees: {} })
  })

  test('sync builds an initial tree from panes', () => {
    usePaneLayoutStore.getState().sync('ws-1', [pane('a', 0, 0), pane('b', 0, 1)])
    const tree = usePaneLayoutStore.getState().trees['ws-1']
    expect(tree).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      children: [{ kind: 'leaf', paneId: 'a' }, { kind: 'leaf', paneId: 'b' }]
    })
  })

  test('split inserts a new leaf beside the target', () => {
    usePaneLayoutStore.getState().sync('ws-1', [pane('a')])
    usePaneLayoutStore.getState().split('ws-1', 'a', 'b', 'vertical')
    const tree = usePaneLayoutStore.getState().trees['ws-1']
    expect(tree).toMatchObject({
      kind: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [{ kind: 'leaf', paneId: 'a' }, { kind: 'leaf', paneId: 'b' }]
    })
  })

  test('remove collapses back to a leaf', () => {
    usePaneLayoutStore.getState().sync('ws-1', [pane('a')])
    usePaneLayoutStore.getState().split('ws-1', 'a', 'b', 'horizontal')
    usePaneLayoutStore.getState().remove('ws-1', 'b')
    expect(usePaneLayoutStore.getState().trees['ws-1']).toEqual({ kind: 'leaf', paneId: 'a' })
  })

  test('sync preserves structure when membership is unchanged', () => {
    usePaneLayoutStore.getState().sync('ws-1', [pane('a')])
    usePaneLayoutStore.getState().split('ws-1', 'a', 'b', 'horizontal')
    usePaneLayoutStore.getState().resize('ws-1', [], 0, 10)
    const before = usePaneLayoutStore.getState().trees['ws-1']
    usePaneLayoutStore.getState().sync('ws-1', [pane('a', 0, 0), pane('b', 0, 1)])
    expect(usePaneLayoutStore.getState().trees['ws-1']).toEqual(before)
  })

  test('a pane split from the pane\'s menu takes half of that pane, whichever arrives first, sync or split', () => {
    const grid = [pane('a', 0, 0), pane('b', 0, 1), pane('c', 1, 0), pane('d', 1, 1)]
    const shares = () => Object.fromEntries(computeLayout(usePaneLayoutStore.getState().trees['ws-1'] ?? null).rects.map(rect => [rect.paneId, [Math.round(rect.width), Math.round(rect.height)]]))
    for (const direction of ['horizontal', 'vertical'] as const) {
      usePaneLayoutStore.setState({ trees: {} })
      usePaneLayoutStore.getState().sync('ws-1', grid)
      // The workspace comes back with the new pane first; the split itself arrives after.
      usePaneLayoutStore.getState().sync('ws-1', [...grid, { ...pane('n', 0, 2), originPaneId: 'a' } as WorkspacePane])
      usePaneLayoutStore.getState().split('ws-1', 'a', 'n', direction)
      const now = shares()
      expect(now.b, direction).toEqual([50, 50])
      expect(now.a, direction).toEqual(direction === 'horizontal' ? [25, 50] : [50, 25])
      expect(now.n, direction).toEqual(now.a)
    }
  })
})
