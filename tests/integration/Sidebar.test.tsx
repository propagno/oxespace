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

    const onOpenTools = vi.fn()

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        appVersion="0.1.2"
        onNewWorkspace={onNewWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={onCloseWorkspace}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
        onOpenTools={onOpenTools}
      />
    )

    expect(screen.getByText('repo')).toBeInTheDocument()
    expect(screen.getByText('v0.1.2')).toBeInTheDocument()
    // Path is not shown on the card (lives in the name tooltip only).
    expect(screen.queryByText('C:/projects/repo')).not.toBeInTheDocument()
    expect(screen.queryByText('projects/repo')).not.toBeInTheDocument()
    // Card meta surfaces the git branch when available.
    await waitFor(() => {
      expect(screen.getByTestId('ws-group-meta')).toBeInTheDocument()
      expect(screen.getByText('feature/sidebar')).toBeInTheDocument()
    })
    // Sidebar no longer expands to expose individual pane rows — clean
    // workspace-only list. Per-pane controls (rename, activate) moved into
    // the terminal pane header.
    expect(screen.queryAllByTestId('pane-session-row')).toHaveLength(0)

    await user.click(screen.getByTestId('btn-new-workspace'))
    expect(onNewWorkspace).toHaveBeenCalled()

    await user.click(screen.getByTestId('sidebar-workspace-select'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')

    // Workspace removal moved off the always-visible X button and onto the
    // right-click context menu → confirmation modal.
    fireEvent.contextMenu(screen.getByTestId('sidebar-workspace-select'))
    await user.click(screen.getByRole('menuitem', { name: /remove workspace/i }))
    await user.click(screen.getByRole('button', { name: /remove workspace/i }))
    expect(onCloseWorkspace).toHaveBeenCalledWith('workspace-1')

    expect(screen.queryByLabelText('AI Providers')).not.toBeInTheDocument()
    // The All/Unread tabs were removed — the activity dot conveys per-workspace
    // state now. Assert they're gone so they don't sneak back.
    expect(screen.queryByRole('tab', { name: /unread/i })).not.toBeInTheDocument()

    // Tools hub entry lives in the sidebar footer (not the workspace topbar).
    await user.click(screen.getByTestId('btn-open-tools'))
    expect(onOpenTools).toHaveBeenCalled()
  })

  test('collapsed sidebar keeps workspaces available on the rail', async () => {
    const user = userEvent.setup()
    const onSelectWorkspace = vi.fn()
    const onOpenTools = vi.fn()

    render(
      <Sidebar
        workspaces={[workspace]}
        activeWorkspaceId="workspace-1"
        appVersion="0.1.2"
        onNewWorkspace={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={vi.fn()}
        isCollapsed
        onToggleCollapse={vi.fn()}
        onOpenTools={onOpenTools}
      />
    )

    // Collapsed rail shows a single button per workspace; clicking it selects
    // the workspace (pane navigation lives in the grid).
    expect(screen.queryByText('repo')).not.toBeInTheDocument()
    expect(screen.getByLabelText('repo')).toBeInTheDocument()
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('btn-open-tools')).toBeInTheDocument()

    await user.click(screen.getByLabelText('repo'))
    expect(onSelectWorkspace).toHaveBeenCalledWith('workspace-1')

    await user.click(screen.getByTestId('btn-open-tools'))
    expect(onOpenTools).toHaveBeenCalled()
  })
})
