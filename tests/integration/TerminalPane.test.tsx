import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../shared/types/workspace'
import { TerminalPane } from '../../src/components/Panes/TerminalPane'
import { useAgentStore } from '../../src/store/agent.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/components/Terminal/TerminalView', () => ({
  TerminalView: ({ onInput, onResize }: { onInput: (data: string) => void; onResize: (cols: number, rows: number) => void }) => (
    <div data-testid="terminal-view">
      <button type="button" onClick={() => onInput('a')}>
        input
      </button>
      <button type="button" onClick={() => onInput('copilot\r')}>
        copilot command
      </button>
      <button type="button" onClick={() => onResize(120, 32)}>
        resize
      </button>
    </div>
  )
}))

describe('TerminalPane', () => {
  beforeEach(() => {
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
    useAgentStore.setState({
      profiles: [],
      allProfiles: [
        {
          agentProfileId: 'agent-copilot',
          name: 'Copilot',
          provider: 'copilot',
          command: 'copilot',
          commandTemplate: 'copilot',
          isBuiltin: true
        },
        {
          agentProfileId: 'agent-codex',
          name: 'Codex',
          provider: 'codex',
          command: 'codex',
          commandTemplate: 'codex',
          isBuiltin: true
        }
      ],
      readiness: [],
      isLoading: false,
      isDiscovering: false,
      lastHealthCheckAt: null,
      error: null
    })
    useWorkspaceStore.setState({
      workspaces: [{
        id: 'workspace-1',
        name: 'repo',
        rootPath: 'C:/repo',
        layout: '1x1',
        layoutPreset: 1,
        themeId: 'dracula',
        uiDensity: 'compact',
        defaultShellProfileId: 'builtin-claude',
        autoStart: false,
        isActive: true,
        panes: []
      }],
      shellProfiles: [
        { id: 'builtin-claude', name: 'Claude', executable: 'claude', args: [], isBuiltin: true },
        { id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: [], isBuiltin: true }
      ],
      activeWorkspaceId: 'workspace-1',
      isLoading: false,
      error: null
    })
    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn(),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn(),
        setPaneAgent: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] }),
        updateWorktreeState: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] })
      },
      terminal: {
        start: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        restart: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      },
      git: {
        getBranch: vi.fn().mockResolvedValue({ branch: 'feature/test', detached: false, shortSha: null }),
        getDiff: vi.fn(),
        onDiffUpdate: vi.fn(() => vi.fn())
      },
      voice: {
        transcribe: vi.fn().mockResolvedValue({ text: '', durationMs: 0 }),
        getModelStatus: vi.fn().mockResolvedValue({ size: 'base', ready: true, path: 'x', engineReady: true }),
        ensureModel: vi.fn().mockResolvedValue({ size: 'base', ready: true, path: 'x', engineReady: true }),
        onModelProgress: vi.fn(() => vi.fn())
      },
      semantic: {
        setEnabled: vi.fn().mockResolvedValue({ enabled: true, workerReady: true, indexing: false, count: 0, lastError: null }),
        getStatus: vi.fn().mockResolvedValue({ enabled: false, workerReady: true, indexing: false, count: 0, lastError: null })
      }
    } as unknown as typeof window.oxe
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    })
  })

  test('starts, writes and resizes a terminal', async () => {
    const user = userEvent.setup()
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    await user.click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'pane-1', workspaceId: 'workspace-1' })))

    await user.click(screen.getByText('input'))
    await user.click(screen.getByText('resize'))

    expect(window.oxe.terminal.write).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'a' })
    expect(window.oxe.terminal.resize).toHaveBeenCalledWith({ paneId: 'pane-1', cols: 120, rows: 32 })
  })

  test('status bar has no provider identity chip (header owns that)', () => {
    useTerminalStore.getState().setStatus('pane-1', 'running')
    render(
      <TerminalPane
        pane={{
          ...createPane(),
          shellProfileId: 'builtin-claude',
          agentProfileId: 'agent-codex',
          agentName: 'Codex'
        }}
        workspaceId="workspace-1"
        workspaceRootPath="C:/repo"
        autoStart={false}
      />
    )
    expect(screen.queryByTestId('terminal-identity')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-terminal-more')).toBeInTheDocument()
  })

  test('marks pane identity when a provider command is launched from a neutral terminal', async () => {
    const user = userEvent.setup()
    useTerminalStore.setState({
      panes: { 'pane-1': { status: 'running', lastActivityAt: Date.now(), lastOutput: null, isWorking: false, hasUnread: false, error: null } },
      pendingCommands: {},
      activePaneId: 'pane-1'
    })

    render(<TerminalPane pane={{ ...createPane(), shellProfileId: 'builtin-powershell', agentProfileId: null }} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    await user.click(screen.getByText('copilot command'))

    expect(window.oxe.workspace.setPaneAgent).toHaveBeenCalledWith({
      paneId: 'pane-1',
      agentProfileId: 'agent-copilot',
      preserveSession: true
    })
    expect(window.oxe.terminal.write).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'copilot\r' })
  })

  test('does not show branch in the status bar (sidebar owns that)', () => {
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    expect(screen.queryByTestId('terminal-branch')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Worktree:/i)).not.toBeInTheDocument()
  })

  test('marks output unread only when pane is not active', () => {
    const store = useTerminalStore.getState()

    store.setActivePaneId('pane-1')
    store.updateActivity('pane-1', 'active output')
    expect(useTerminalStore.getState().panes['pane-1']?.hasUnread).toBe(false)

    store.updateActivity('pane-2', 'background output')
    expect(useTerminalStore.getState().panes['pane-2']?.hasUnread).toBe(true)

    useTerminalStore.getState().setActivePaneId('pane-2')
    expect(useTerminalStore.getState().panes['pane-2']?.hasUnread).toBe(false)
  })

  test('more menu toggles RTK, Caveman and Semantic', async () => {
    const user = userEvent.setup()
    useTerminalStore.getState().setStatus('pane-1', 'running')
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    await user.click(screen.getByTestId('btn-terminal-more'))
    expect(screen.getByTestId('terminal-more-menu')).toBeInTheDocument()
    expect(screen.getByTestId('menu-toggle-rtk')).toBeInTheDocument()
    expect(screen.getByTestId('menu-toggle-caveman')).toBeInTheDocument()
    expect(screen.getByTestId('menu-toggle-semantic')).toBeInTheDocument()

    await user.click(screen.getByTestId('menu-toggle-rtk'))
    expect(screen.getByTestId('menu-toggle-rtk')).toHaveAttribute('aria-checked', 'true')
  })

  test('oxe:terminal-new-session restarts a running terminal', async () => {
    useTerminalStore.getState().setStatus('pane-1', 'running')
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    window.dispatchEvent(new CustomEvent('oxe:terminal-new-session', { detail: { paneId: 'pane-1' } }))

    await waitFor(() => {
      expect(window.oxe.terminal.stop).toHaveBeenCalledWith({ paneId: 'pane-1' })
      expect(window.oxe.terminal.start).toHaveBeenCalledWith(
        expect.objectContaining({ paneId: 'pane-1', workspaceId: 'workspace-1' })
      )
    })
  })

  test('does not render the removed terminal topbar', () => {
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    expect(screen.queryByTestId('terminal-topbar')).not.toBeInTheDocument()
  })
})

function createPane(): WorkspacePane {
  return {
    id: 'pane-1',
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
    rootPath: null
  }
}
