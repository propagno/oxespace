import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { PaneNode } from '../../../shared/types/pane-tree'
import type { Workspace } from '../../../shared/types/workspace'
import { WorkspaceSplitGrid } from '../../../src/components/Grid/WorkspaceSplitGrid'
import { MIN_PANE_WIDTH_PX, layoutPaneSize, moveHasRoom } from '../../../src/components/Grid/splitRoom'

// OXE-365 (HML3): drag-to-split relocated a pane without the room check a split has, so in a 960 px grid it left two
// panes under the 240 px minimum. The drop now offers no zone, and nothing moves, when the move would squeeze a pane.

const pane = (id: string) => ({ id, workspaceId: 'ws-1', title: id, kind: 'terminal', status: 'running', rowIndex: 0, columnIndex: 0 })
const workspace = (ids: string[]) => ({ id: 'ws-1', name: 'Workspace', rootPath: '/tmp', isActive: true, panes: ids.map(pane) }) as unknown as Workspace
const row = (ids: string[]): PaneNode => ({ kind: 'split', direction: 'horizontal', sizes: ids.map(() => 100 / ids.length), children: ids.map(paneId => ({ kind: 'leaf', paneId })) })

function drag(tree: PaneNode, ids: string[], width: number, from: number, to: { x: number; y: number }) {
  const onMovePane = vi.fn()
  render(<WorkspaceSplitGrid workspace={workspace(ids)} tree={tree} maximizedPaneId={null} onToggleMaximize={() => undefined} onResize={() => undefined} onMovePane={onMovePane} />)
  const container = screen.getByTestId('workspace-split-grid')
  container.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 600, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  fireEvent.pointerDown(screen.getAllByTestId('split-drag-grip')[from], { clientX: 10, clientY: 10 })
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y })) })
  const preview = screen.queryByTestId('split-drop-preview')
  act(() => { window.dispatchEvent(new MouseEvent('pointerup')) })
  return { onMovePane, preview }
}

describe('OXE-365 · drag-to-split respects the 240 px minimum', () => {
  test('in a 960 px grid of three panes, dropping one beside another would leave it under 240 px: no zone, no move', () => {
    const ids = ['pane-a', 'pane-b', 'pane-c']
    const tree = row(ids)
    expect(moveHasRoom(tree, 'pane-a', 'pane-b', 'horizontal', false, { width: 960, height: 600 })).toBe(false)
    const squeezed = layoutPaneSize(row(['pane-a', 'pane-b']), 'pane-a', { width: 480, height: 600 })!
    expect(squeezed.width).toBeLessThan(MIN_PANE_WIDTH_PX)

    // Left edge of pane-b (the middle third): a side-by-side drop on pane-b.
    const { onMovePane, preview } = drag(tree, ids, 960, 0, { x: 330, y: 300 })
    expect(preview).toBeNull()
    expect(onMovePane).not.toHaveBeenCalled()
  })

  test('the same drop in a 1920 px grid leaves both at 240 px or more, and moves the pane', () => {
    const ids = ['pane-a', 'pane-b', 'pane-c']
    const tree = row(ids)
    expect(moveHasRoom(tree, 'pane-a', 'pane-b', 'horizontal', false, { width: 1920, height: 600 })).toBe(true)

    const { onMovePane, preview } = drag(tree, ids, 1920, 0, { x: 660, y: 300 })
    expect(preview).not.toBeNull()
    expect(onMovePane).toHaveBeenCalledWith('pane-a', 'pane-b', 'horizontal', false)
  })
})
