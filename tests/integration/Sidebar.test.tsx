import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        terminal: {
          stop: vi.fn().mockResolvedValue(undefined)
        },
        workspace: {
          closePane: vi.fn().mockResolvedValue(undefined)
        }
      }
    })
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

  test('collapsed sidebar keeps workspaces and panes available on the rail', async () => {
    const user = userEvent.setup()
    const onSelectWorkspace = vi.fn()
    const onActivatePane = vi.fn()

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        activePaneId={null}
        agentProfiles={[]}
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={vi.fn()}
        onActivatePane={onActivatePane}
        isCollapsed
        onToggleCollapse={vi.fn()}
      />
    )

    expect(screen.queryByText('repo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('repo')).toBeInTheDocument()
    expect(screen.getByLabelText('terminal 1')).toBeInTheDocument()
    expect(screen.getByLabelText('terminal 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()

    await user.click(screen.getByLabelText('terminal 2'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(onActivatePane).toHaveBeenCalledWith('pane-2')
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

  test('right-clicking a terminal row can stop and close it', async () => {
    const user = userEvent.setup()
    const closePane = vi.fn().mockResolvedValue(undefined)
    const stop = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        terminal: { stop },
        workspace: { closePane }
      }
    })
    useTerminalStore.setState({
      panes: {
        'pane-1': {
          status: 'running',
          lastActivityAt: Date.now(),
          lastOutput: 'Logged in',
          isWorking: false,
          hasUnread: false,
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
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    )

    fireEvent.contextMenu(screen.getByText('terminal 1'))
    await user.click(screen.getByRole('menuitem', { name: /close terminal/i }))

    await waitFor(() => expect(stop).toHaveBeenCalledWith({ paneId: 'pane-1' }))
    expect(closePane).toHaveBeenCalledWith('pane-1')
  })
})
