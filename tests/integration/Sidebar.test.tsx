import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { Sidebar } from '../../src/components/Sidebar/Sidebar'
import { useTerminalStore } from '../../src/store/terminal.store'

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'repo',
  rootPath: 'C:/projects/repo',
  layout: '2x2',
  layoutPreset: 4,
  themeId: 'dracula',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  panes: [
    { id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null },
    { id: 'pane-2', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 1, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null }
  ]
}

describe('Sidebar', () => {
  beforeEach(() => {
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  })

  test('renders workspace metadata and dispatches actions', async () => {
    const user = userEvent.setup()
    const onNewWorkspace = vi.fn()
    const onSelectWorkspace = vi.fn()
    const onCloseWorkspace = vi.fn()
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

    // The AI Providers button was removed from the sidebar header in Wave 2 —
    // agent discovery is now reached through the Command Palette
    // ("Open Agent Settings"). We assert its absence here so it stays gone.
    expect(screen.queryByLabelText('AI Providers')).not.toBeInTheDocument()
  })

  test('collapsed sidebar exposes only the expand affordance', () => {
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
        isCollapsed
        onToggleCollapse={vi.fn()}
      />
    )

    expect(screen.queryByText('repo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()
  })

  test('filters unread panes, clears unread on activation and returns to all tab', async () => {
    const user = userEvent.setup()
    const onActivatePane = vi.fn()
    useTerminalStore.setState({
      panes: {
        'pane-2': {
          status: 'running',
          lastActivityAt: Date.now(),
          lastOutput: 'new output',
          isWorking: true,
          hasUnread: true,
          error: null
        }
      },
      pendingCommands: {},
      activePaneId: 'pane-1'
    })

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        activePaneId="pane-1"
        agentProfiles={[]}
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onActivatePane={onActivatePane}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    await user.click(screen.getByRole('tab', { name: /unread/i }))
    await user.click(screen.getByText('terminal 2'))

    expect(onActivatePane).toHaveBeenCalledWith('pane-2')
    expect(useTerminalStore.getState().panes['pane-2']?.hasUnread).toBe(false)
    expect(screen.getByRole('tab', { name: /^all$/i })).toHaveAttribute('aria-selected', 'true')
  })

  test('collapsed sidebar shows unread badge on the rail', () => {
    useTerminalStore.setState({
      panes: {
        'pane-2': {
          status: 'running',
          lastActivityAt: Date.now(),
          lastOutput: 'new output',
          isWorking: true,
          hasUnread: true,
          error: null
        }
      },
      pendingCommands: {},
      activePaneId: 'pane-1'
    })

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        activePaneId="pane-1"
        agentProfiles={[]}
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onActivatePane={vi.fn()}
        isCollapsed
        onToggleCollapse={vi.fn()}
      />
    )

    expect(screen.getByLabelText('1 unread pane')).toHaveTextContent('1')
  })
})
