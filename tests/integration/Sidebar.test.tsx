import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { Sidebar } from '../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../src/hooks/useGitBranch'
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
    __resetGitBranchCacheForTests()
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        terminal: {
          stop: vi.fn().mockResolvedValue(undefined)
        },
        workspace: {
          closePane: vi.fn().mockResolvedValue(undefined)
        },
        git: {
          getBranch: vi.fn().mockResolvedValue({ branch: 'feature/sidebar', detached: false, shortSha: null })
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
    // Sidebar no longer expands to expose individual pane rows — clean
    // workspace-only list. Per-pane controls (rename, activate) moved into
    // the terminal pane header. Asserting the absence here so the pane
    // cards don't sneak back in by accident.
    expect(screen.queryAllByTestId('pane-session-row')).toHaveLength(0)

    await user.click(screen.getByTestId('btn-new-workspace'))
    expect(onNewWorkspace).toHaveBeenCalled()

    await user.click(screen.getByTestId('sidebar-workspace-select'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')

    // Workspace removal moved off the always-visible X button and onto the
    // right-click context menu → confirmation modal. Two clicks (menuitem +
    // modal confirm) replace the old single-click destructive flow.
    fireEvent.contextMenu(screen.getByTestId('sidebar-workspace-select'))
    await user.click(screen.getByRole('menuitem', { name: /remove workspace/i }))
    await user.click(screen.getByRole('button', { name: /remove workspace/i }))
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
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={vi.fn()}
        onActivatePane={onActivatePane}
        isCollapsed
        onToggleCollapse={vi.fn()}
      />
    )

    // Collapsed rail now shows a single button per workspace — per-pane
    // mini-buttons were removed so the rail mirrors the expanded sidebar's
    // "one row per workspace" model. Clicking the workspace button selects
    // the workspace; if it has unread panes, the handler auto-activates the
    // first one (covered by the "filters unread panes" test).
    expect(screen.queryByText('repo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('repo')).toBeInTheDocument()
    expect(screen.queryByLabelText('terminal 1')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('terminal 2')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()

    await user.click(screen.getByLabelText('repo'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(onActivatePane).not.toHaveBeenCalled()
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
    // The unread tab now filters at the workspace level (per-pane rows
    // were removed from the sidebar). Clicking the workspace card surfaces
    // the first unread pane automatically — handleSelectWorkspace in
    // Sidebar.tsx maps "select workspace with unread" to "activate that
    // pane and clear unread".
    await user.click(screen.getByTestId('sidebar-workspace-select'))

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

  // The "right-click a terminal row to stop and close" flow was removed in
  // sidebar Onda 6: pane rows no longer render inside workspace cards.
  // Per-pane stop/close lives on the terminal pane header (X button) and
  // the slash overlay (/stop, /restart). The unread/activation behaviour
  // covered by the prior tests stays intact via handleSelectWorkspace.
})
