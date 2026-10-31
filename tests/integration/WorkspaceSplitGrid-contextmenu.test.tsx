import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceSplitGrid } from '../../src/components/Grid/WorkspaceSplitGrid'
import type { PaneNode } from '../../shared/types/pane-tree'

vi.mock('../../src/components/Grid/PaneContainer', () => ({
  PaneContainer: ({ pane }: { pane: { id: string } }) => <div data-testid={`pane-${pane.id}`}>{pane.id}</div>
}))

// Its own file: jsdom keeps Radix menu state between menus in one file (see WorkspaceSplitGrid.test.tsx).
describe('WorkspaceSplitGrid divider, context menu', () => {
  // On Linux, Chromium turns Shift+F10 into a contextmenu event rather than an F10 keydown, so the divider's menu
  // must open from contextmenu too (main went red on linux-x64 in e2e/drag-alternatives.spec.ts).
  test('a contextmenu event (Shift+F10, the context-menu key, a right click) opens the divider menu', async () => {
    const tree: PaneNode = { kind: 'split', direction: 'horizontal', sizes: [50, 50], children: [{ kind: 'leaf', paneId: 'pane-a' }, { kind: 'leaf', paneId: 'pane-b' }] }
    const onResize = vi.fn()
    render(<WorkspaceSplitGrid workspace={createWorkspace()} tree={tree} maximizedPaneId={null} onToggleMaximize={() => undefined} onResize={onResize} onMovePane={() => undefined} />)
    const divider = screen.getByRole('separator', { name: 'Divider between columns' })
    const notCancelled = fireEvent.contextMenu(divider)
    expect(notCancelled).toBe(false)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move the divider left' }))
    expect(onResize).toHaveBeenCalledWith([], 0, -5)
    // A choice closes the menu and gives focus back to the divider, whose arrows keep resizing (F23).
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(divider).toHaveFocus()
    fireEvent.keyDown(divider, { key: 'ArrowRight' })
    expect(onResize).toHaveBeenLastCalledWith([], 0, 2)
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
