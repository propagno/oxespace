import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../shared/types/workspace'
import { TerminalPane } from '../../src/components/Panes/TerminalPane'
import { useAgentStore } from '../../src/store/agent.store'
import { useTerminalStore } from '../../src/store/terminal.store'

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
        }
      ],
      readiness: [],
      isLoading: false,
      isDiscovering: false,
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
        setPaneAgent: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] })
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
      }
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    })
  })


  test('starts, writes and resizes a terminal', async () => {
    const user = userEvent.setup()
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    await user.click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith({ paneId: 'pane-1', workspaceId: 'workspace-1' }))

    await user.click(screen.getByText('input'))
    await user.click(screen.getByText('resize'))

    expect(window.oxe.terminal.write).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'a' })
    expect(window.oxe.terminal.resize).toHaveBeenCalledWith({ paneId: 'pane-1', cols: 120, rows: 32 })

    // The Stop control was removed from the status bar — only Restart (on exit) remains.
    expect(screen.queryByLabelText('Stop terminal')).not.toBeInTheDocument()
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

  test('surfaces a branch lookup failure with a clear fallback label', async () => {
    window.oxe.git.getBranch = vi.fn().mockRejectedValue(new Error('lookup failed'))

    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    // summarizeBranchError() maps known git failure messages to short labels
    // (git not found / not a git repo / etc). An unknown failure ("lookup
    // failed") falls back to the generic but still diagnostic "branch error"
    // — never the legacy "branch unavailable" which sounded like a transient
    // network issue. The full error text remains in the chip's title.
    await waitFor(() => expect(screen.getByText('branch error')).toBeInTheDocument())
    const chip = screen.getByLabelText(/Worktree: branch error/i)
    expect(chip.getAttribute('title')).toMatch(/lookup failed/)
  })

  test('maps "Git executable not found" to "git not found"', async () => {
    window.oxe.git.getBranch = vi.fn().mockResolvedValue({
      branch: null,
      detached: false,
      shortSha: null,
      error: 'Git executable not found'
    })

    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await waitFor(() => expect(screen.getByText('git not found')).toBeInTheDocument())
  })

  test('maps "Not inside a Git work tree" to "not a git repo"', async () => {
    window.oxe.git.getBranch = vi.fn().mockResolvedValue({
      branch: null,
      detached: false,
      shortSha: null,
      error: 'Not inside a Git work tree'
    })

    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await waitFor(() => expect(screen.getByText('not a git repo')).toBeInTheDocument())
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

  test('shows enabled OXEVoice control when the terminal is running and voice is supported', async () => {
    useTerminalStore.getState().setStatus('pane-1', 'running')

    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    const voiceButton = screen.getByRole('button', { name: /OXEVoice/i })
    expect(voiceButton).toBeEnabled()
    expect(voiceButton).toHaveAttribute('aria-pressed', 'false')
  })

  test('disables OXEVoice control when the terminal is idle', () => {
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)

    expect(screen.getByRole('button', { name: /OXEVoice/i })).toBeDisabled()
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
    status: 'idle'
  }
}
