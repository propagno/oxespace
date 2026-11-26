import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../shared/types/workspace'
import { TerminalPane } from '../../src/components/Panes/TerminalPane'
import { useAgentStore } from '../../src/store/agent.store'
import { useTerminalPrefsStore } from '../../src/store/terminal-prefs.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

const terminalViewRenderSpy = vi.hoisted(() => vi.fn())

vi.mock('../../src/components/Terminal/TerminalView', () => ({
  TerminalView: ({ onInput, onResize }: { onInput: (data: string) => void; onResize: (cols: number, rows: number) => void }) => {
    terminalViewRenderSpy()
    return (
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
  }
}))

describe('TerminalPane', () => {
  beforeEach(() => {
    terminalViewRenderSpy.mockClear()
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
        attach: vi.fn().mockResolvedValue({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false }),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        onActivity: vi.fn(() => vi.fn())
      },
      git: {
        getBranch: vi.fn().mockResolvedValue({ branch: 'feature/test', detached: false, shortSha: null }),
        getDiff: vi.fn(),
        onDiffUpdate: vi.fn(() => vi.fn())
      }
    } as unknown as typeof window.oxe
  })

  test('explicit start recovers a delegated task instead of using the ordinary launcher', async () => {
    window.oxe.delegation = {
      status: vi.fn().mockResolvedValue({ enabled: true, tasks: [{ id: 'task-1', paneId: 'pane-1', state: 'interrupted' }] }),
      control: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => vi.fn())
    } as unknown as typeof window.oxe.delegation
    render(<TerminalPane pane={{ ...createPane(), originPaneId: 'origin' }} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await userEvent.setup().click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.delegation.control).toHaveBeenCalledWith('workspace-1', 'task-1', 'retry'))
    expect(window.oxe.terminal.start).not.toHaveBeenCalled()
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

  test('adopts a session that is already running instead of respawning it', async () => {
    const user = userEvent.setup()
    // A workspace returning from the MRU: main still owns the shell. Spawning
    // again would kill it, reload the user's $PROFILE and blank the terminal —
    // the multi-second cost the attach model exists to remove.
    vi.mocked(window.oxe.terminal.status).mockResolvedValue({ running: true, seq: 42, altScreen: false })

    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await user.click(screen.getByLabelText('Start terminal'))

    await waitFor(() => expect(useTerminalStore.getState().getStatus('pane-1').status).toBe('running'))
    expect(window.oxe.terminal.start).not.toHaveBeenCalled()
  })

  test('does not rerender when an unrelated terminal changes', () => {
    useTerminalStore.getState().setStatus('pane-1', 'running')
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    terminalViewRenderSpy.mockClear()

    act(() => useTerminalStore.getState().setStatus('pane-2', 'running'))

    expect(terminalViewRenderSpy).not.toHaveBeenCalled()
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

  test('more menu toggles Caveman, with no Semantic toggle (R2)', async () => {
    const user = userEvent.setup()
    useTerminalStore.getState().setStatus('pane-1', 'running')
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    await user.click(screen.getByTestId('btn-terminal-more'))
    expect(screen.getByTestId('terminal-more-menu')).toBeInTheDocument()
    // R4 took RTK out: the menu has no RTK toggle.
    expect(screen.queryByTestId('menu-toggle-rtk')).toBeNull()
    expect(screen.getByTestId('menu-toggle-caveman')).toBeInTheDocument()
    expect(screen.queryByTestId('menu-toggle-semantic')).toBeNull()

    await user.click(screen.getByTestId('menu-toggle-caveman'))
    expect(screen.getByTestId('menu-toggle-caveman')).toHaveAttribute('aria-checked', 'true')
  })

  test('restores an exact Codex session in the selected pane', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    window.oxe.session = { list: vi.fn().mockResolvedValue([{ sessionId: id, provider: 'codex', firstMessagePreview: 'Implement authentication', modelId: 'gpt-5', requestCount: 12, lastUpdatedMs: Date.now(), sessionStartedAtMs: Date.now() }]) } as unknown as typeof window.oxe.session
    const user = userEvent.setup()
    render(<TerminalPane pane={{ ...createPane(), agentProfileId: 'agent-codex' }} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await user.click(screen.getByTestId('btn-terminal-more'))
    await user.click(screen.getByRole('menuitem', { name: 'Restore provider session…' }))
    await user.click(await screen.findByRole('button', { name: /Implement authentication/ }))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'pane-1', workspaceId: 'workspace-1', agentCommand: 'codex', agentArgs: ['resume', id, '--no-alt-screen'] })))
    expect(window.oxe.terminal.stop).toHaveBeenCalledWith({ paneId: 'pane-1' })
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

  // OXE-319: start() read terminalPrefs without listing them, so a Caveman toggle made after the pane mounted was
  // ignored by the next start; and the phone's size lease was cleared by a setState inside the effect.
  test('TerminalPane starts with latest terminalPrefs and clears sizeLease cleanly without effect sync setState', async () => {
    const prefs = useTerminalPrefsStore.getState()
    prefs.clearOverrides('workspace-1')
    prefs.setGlobal({ cavemanModeEnabled: false })
    try {
      const user = userEvent.setup()
      const { unmount } = render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
      act(() => useTerminalPrefsStore.getState().setOverride('workspace-1', 'cavemanModeEnabled', true))
      await user.click(screen.getByLabelText('Start terminal'))
      await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith(expect.objectContaining({ paneId: 'pane-1', initialPrompt: expect.stringContaining('smart caveman') })))
      unmount()

      // A lease belongs to its pane: when the view moves to another pane, the old one's size is not shown while the new
      // pane's lease is still being read.
      window.oxe.terminal.sizeLease = vi.fn((paneId: string) => paneId === 'pane-1' ? Promise.resolve({ cols: 40, rows: 20 }) : new Promise(() => undefined)) as unknown as typeof window.oxe.terminal.sizeLease
      window.oxe.terminal.onSizeLeaseChanged = vi.fn(() => vi.fn()) as unknown as typeof window.oxe.terminal.onSizeLeaseChanged
      useTerminalStore.getState().setStatus('pane-1', 'running')
      useTerminalStore.getState().setStatus('pane-2', 'running')
      const { rerender } = render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
      expect(await screen.findByText(/Sized for your phone \(40 × 20\)/)).toBeInTheDocument()
      rerender(<TerminalPane pane={{ ...createPane(), id: 'pane-2' }} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
      expect(screen.queryByText(/Sized for your phone/)).not.toBeInTheDocument()
      expect(window.oxe.terminal.sizeLease).toHaveBeenCalledWith('pane-2')
    } finally {
      useTerminalPrefsStore.getState().clearOverrides('workspace-1')
    }
  })

  test('OXE-436: passes estimated initial cols/rows on start and measured FitAddon cols/rows on restart', async () => {
    const user = userEvent.setup()
    const { container } = render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    const idleBox = container.querySelector<HTMLElement>('.terminal-idle')!
    idleBox.getBoundingClientRect = () => ({ width: 1000, height: 600 } as DOMRect)

    await user.click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith(
      expect.objectContaining({ paneId: 'pane-1', workspaceId: 'workspace-1', cols: expect.any(Number), rows: expect.any(Number) })
    ))
    const firstCall = vi.mocked(window.oxe.terminal.start).mock.calls[0][0]
    expect(firstCall.cols).toBeGreaterThan(80)
    expect(firstCall.rows).toBeGreaterThan(20)

    // Once TerminalView reports exact FitAddon dimensions via onResize, restart uses those exact cols/rows.
    await user.click(screen.getByText('resize'))
    vi.mocked(window.oxe.terminal.start).mockClear()
    window.dispatchEvent(new CustomEvent('oxe:terminal-new-session', { detail: { paneId: 'pane-1' } }))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith(
      expect.objectContaining({ paneId: 'pane-1', workspaceId: 'workspace-1', cols: 120, rows: 32 })
    ))
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
