import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceGrid } from '../../src/components/Grid/WorkspaceGrid'

vi.mock('../../src/components/Panes/PaneContent', () => ({
  PaneContent: () => <div data-testid="pane-content" />
}))

describe('WorkspaceGrid', () => {
  test('renders all panes in a 4x4 workspace and toggles maximize', async () => {
    const user = userEvent.setup()
    const onToggleMaximize = vi.fn()
    const workspace = createWorkspace('4x4')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={onToggleMaximize} />)

    expect(screen.getAllByTestId('pane-container')).toHaveLength(16)

    await user.click(screen.getAllByLabelText('Maximize pane')[0])
    expect(onToggleMaximize).toHaveBeenCalledWith('pane-0-0')
  })

  test('renders only the maximized pane when maximizedPaneId is set', () => {
    const workspace = createWorkspace('2x2')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId="pane-0-1" onToggleMaximize={() => undefined} />)

    expect(screen.getAllByTestId('pane-container')).toHaveLength(1)
    expect(screen.getByLabelText('Restore pane')).toBeInTheDocument()
  })
})

function createWorkspace(layout: Workspace['layout']): Workspace {
  const [rows, columns] = layout.split('x').map(Number)
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout,
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    panes: Array.from({ length: rows * columns }, (_, index) => {
      const rowIndex = Math.floor(index / columns)
      const columnIndex = index % columns
      return {
        id: `pane-${rowIndex}-${columnIndex}`,
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex,
        columnIndex,
        shellProfileId: 'builtin-claude',
        status: 'idle'
      }
    })
  }
}
