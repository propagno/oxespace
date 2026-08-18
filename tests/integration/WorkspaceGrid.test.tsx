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

  test('keeps all panes mounted when maximized so terminals keep scroll state', () => {
    const workspace = createWorkspace('2x2')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId="pane-0-1" onToggleMaximize={() => undefined} />)

    // Still 4 pane hosts in the DOM — maximize is CSS/layout, not unmount.
    expect(screen.getAllByTestId('pane-container')).toHaveLength(4)
    expect(screen.getByLabelText('Restore pane')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-grid')).toHaveAttribute('data-maximized-pane', 'pane-0-1')
    expect(screen.getByTestId('workspace-grid').className).toContain('workspace-grid--maximized')
  })

  test('does not render editor controls inside terminal panes', () => {
    const workspace = createWorkspace('1x1')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)

    expect(screen.queryByRole('button', { name: 'Open editor in pane' })).not.toBeInTheDocument()
  })

  test('keeps only search + expand visible; secondary actions live in ⋯ menu', async () => {
    const user = userEvent.setup()
    const workspace = createWorkspace('1x1')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)

    expect(screen.getByLabelText('Search in terminal')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize pane')).toBeInTheDocument()
    expect(screen.getByLabelText('More pane actions')).toBeInTheDocument()

    // Hidden until the kebab is opened.
    expect(screen.queryByRole('menuitem', { name: /Limpar terminal/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Nova sessão/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Dividir vertical/i })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('More pane actions'))

    expect(screen.getByTestId('pane-actions-menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Limpar terminal/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /Nova sessão/i })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Dividir vertical/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Dividir horizontal/i })).toBeInTheDocument()
  })
})

function createWorkspace(layout: Workspace['layout']): Workspace {
  const [rows, columns] = layout.split('x').map(Number)
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout,
    layoutPreset: rows * columns === 16 ? 16 : rows * columns === 4 ? 4 : 1,
    themeId: 'midnight',
    uiDensity: 'compact',
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
