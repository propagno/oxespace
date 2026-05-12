import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { Sidebar } from '../../src/components/Sidebar/Sidebar'

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'repo',
  rootPath: 'C:/projects/repo',
  layout: '2x2',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  panes: [
    { id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle' },
    { id: 'pane-2', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 1, shellProfileId: 'builtin-claude', status: 'idle' }
  ]
}

describe('Sidebar', () => {
  test('renders workspace metadata and dispatches actions', async () => {
    const user = userEvent.setup()
    const onNewWorkspace = vi.fn()
    const onSelectWorkspace = vi.fn()
    const onCloseWorkspace = vi.fn()
    const onToggleSettings = vi.fn()
    const onToggleCollapse = vi.fn()

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        activePaneId={null}
        agentProfiles={[]}
        appVersion="0.1.2"
        onNewWorkspace={onNewWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={onCloseWorkspace}
        onActivatePane={vi.fn()}
        isSettingsOpen={false}
        onToggleSettings={onToggleSettings}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
      />
    )

    expect(screen.getByText('repo')).toBeInTheDocument()
    expect(screen.getByText('v0.1.2')).toBeInTheDocument()
    expect(screen.queryByText('C:/projects/repo')).not.toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('btn-new-workspace'))
    expect(onNewWorkspace).toHaveBeenCalled()

    await user.click(screen.getByTestId('sidebar-workspace-select'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')

    await user.click(screen.getByLabelText('Close repo'))
    expect(onCloseWorkspace).toHaveBeenCalledWith('workspace-1')

    await user.click(screen.getByLabelText('AI Providers'))
    expect(onToggleSettings).toHaveBeenCalled()
  })

  test('keeps settings available when collapsed', async () => {
    const user = userEvent.setup()
    const onToggleSettings = vi.fn()

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        activePaneId={null}
        agentProfiles={[]}
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onActivatePane={vi.fn()}
        isSettingsOpen={false}
        onToggleSettings={onToggleSettings}
        isCollapsed
        onToggleCollapse={vi.fn()}
      />
    )

    expect(screen.queryByText('repo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()
  })
})
