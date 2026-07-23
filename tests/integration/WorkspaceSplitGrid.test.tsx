import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceSplitGrid } from '../../src/components/Grid/WorkspaceSplitGrid'
import type { PaneNode } from '../../shared/types/pane-tree'

vi.mock('../../src/components/Grid/PaneContainer', () => ({
  PaneContainer: ({ pane }: { pane: { id: string } }) => <div data-testid={`pane-${pane.id}`}>{pane.id}</div>
}))

describe('WorkspaceSplitGrid', () => {
  test('renders absolute slots for each leaf and resize handles between them', () => {
    const tree: PaneNode = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [
        { kind: 'leaf', paneId: 'pane-a' },
        { kind: 'leaf', paneId: 'pane-b' }
      ]
    }

    render(
      <WorkspaceSplitGrid
        workspace={createWorkspace()}
        tree={tree}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onResize={() => undefined}
        onMovePane={() => undefined}
      />
    )

    expect(screen.getByTestId('workspace-split-grid')).toBeInTheDocument()
    expect(screen.getByTestId('pane-pane-a')).toBeInTheDocument()
    expect(screen.getByTestId('pane-pane-b')).toBeInTheDocument()
    expect(screen.getAllByTestId('split-resize-handle')).toHaveLength(1)
    // Drag-to-split affordance: one grip per pane when there are 2+ panes.
    expect(screen.getAllByTestId('split-drag-grip')).toHaveLength(2)
  })

  test('performs a drag-to-split drop: grip down → move over target → up calls onMovePane', () => {
    const tree: PaneNode = {
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [
        { kind: 'leaf', paneId: 'pane-a' },
        { kind: 'leaf', paneId: 'pane-b' }
      ]
    }
    const onMovePane = vi.fn()

    render(
      <WorkspaceSplitGrid
        workspace={createWorkspace()}
        tree={tree}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onResize={() => undefined}
        onMovePane={onMovePane}
      />
    )

    // jsdom has no layout; give the container a real box for the % math.
    const container = screen.getByTestId('workspace-split-grid')
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    const [gripA] = screen.getAllByTestId('split-drag-grip')
    fireEvent.pointerDown(gripA, { clientX: 250, clientY: 10 })
    // jsdom lacks PointerEvent coords; a MouseEvent typed 'pointermove' carries
    // clientX/Y and still hits the window listener.
    // Bottom edge of pane-b (right half, lower quadrant) → vertical split, after.
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 750, clientY: 450 }))
    })
    expect(screen.getByTestId('split-drop-preview')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })

    expect(onMovePane).toHaveBeenCalledWith('pane-a', 'pane-b', 'vertical', true)
  })
})

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x2',
    layoutPreset: 2,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: false,
    editorExpanded: false,
    editorWidthPercent: 40,
    reviewPanelVisible: false,
    reviewPanelExpanded: false,
    reviewPanelWidthPercent: 36,
    githubPanelVisible: false,
    githubPanelExpanded: false,
    githubPanelWidthPercent: 40,
    githubActiveTab: 'status',
    backgroundPanelVisible: false,
    backgroundPanelExpanded: false,
    backgroundPanelWidthPercent: 28,
    worktreePanelVisible: false,
    worktreePanelExpanded: false,
    worktreePanelWidthPercent: 36,
    panes: [
      {
        id: 'pane-a',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-claude',
        status: 'idle',
        agentProfileId: null,
        agentName: null,
        displayName: null,
        createdAt: null,
        modelOverride: null,
        rootPath: null
      },
      {
        id: 'pane-b',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 1,
        shellProfileId: 'builtin-claude',
        status: 'idle',
        agentProfileId: null,
        agentName: null,
        displayName: null,
        createdAt: null,
        modelOverride: null,
        rootPath: null
      }
    ]
  }
}
