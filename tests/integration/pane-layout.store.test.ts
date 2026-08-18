import { beforeEach, describe, expect, test } from 'vitest'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import type { WorkspacePane } from '../../shared/types/workspace'

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
})
