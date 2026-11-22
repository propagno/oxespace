// Frozen acceptance test for 1.5.2 HML fixes, pass 2 (Jira OXE-355; 152hml2). Written by the planner; the executor must
// not edit it. HML round 2 (f65fa5374): when an agent CLI or a script fails and exits (code ≠ 0), TerminalPane unmounts the
// terminal at once (isRunning turns false on exit, src/components/Panes/TerminalPane.tsx) and shows only "Exited with code
// N" and Start: the error and its stack trace are gone before anyone can read or copy them.
// Contract: after a non-zero exit the TerminalView stays on screen (its output readable and selectable), no keystroke goes
// to the dead process, and the pane offers the way to start again ("Start terminal", the existing terminalPane.start
// label) next to "Exited with code N".
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { TerminalPane } from '../../../src/components/Panes/TerminalPane'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

vi.mock('../../../src/components/Terminal/TerminalView', () => ({
  TerminalView: ({ onInput, onExit }: { onInput: (data: string) => void; onExit?: (code: number) => void }) => (
    <div data-testid="terminal-view">
      <pre>Error: boom at main.js:12</pre>
      <button type="button" onClick={() => onInput('x')}>type</button>
      <button type="button" onClick={() => onExit?.(1)}>exit 1</button>
    </div>
  )
}))

const pane = (): WorkspacePane => ({
  id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-powershell',
  status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null
})

beforeEach(() => {
  useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  useWorkspaceStore.setState({
    workspaces: [{ id: 'workspace-1', name: 'repo', rootPath: 'C:/repo', layout: '1x1', layoutPreset: 1, themeId: 'dracula', uiDensity: 'compact', defaultShellProfileId: 'builtin-powershell', autoStart: false, isActive: true, panes: [] }],
    shellProfiles: [{ id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: [], isBuiltin: true }],
    activeWorkspaceId: 'workspace-1', isLoading: false, error: null
  } as never)
  window.oxe = {
    app: { version: '0.1.0' },
    workspace: { setPaneAgent: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] }), updateWorktreeState: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] }) },
    terminal: {
      start: vi.fn().mockResolvedValue(undefined), write: vi.fn().mockResolvedValue(undefined), resize: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined), restart: vi.fn().mockResolvedValue(undefined),
      attach: vi.fn().mockResolvedValue({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }),
      detach: vi.fn().mockResolvedValue(undefined), status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false }),
      onData: vi.fn(() => vi.fn()), onExit: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn())
    },
    git: { getBranch: vi.fn().mockResolvedValue({ branch: 'main', detached: false, shortSha: null }), getDiff: vi.fn(), onDiffUpdate: vi.fn(() => vi.fn()) }
  } as unknown as typeof window.oxe
})
afterEach(() => { cleanup() })

describe('OXE-355 · a failed process leaves its output on screen', () => {
  test('after a non-zero exit the output stays, keystrokes go nowhere, and Start terminal is offered', async () => {
    const user = userEvent.setup()
    render(<TerminalPane pane={pane()} workspaceId="workspace-1" workspaceRootPath="C:/repo" autoStart={false} />)
    await user.click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalled())
    await act(async () => { useTerminalStore.getState().setStatus('pane-1', 'running') })
    await user.click(await screen.findByText('exit 1'))
    await waitFor(() => expect(useTerminalStore.getState().panes['pane-1']?.status).toBe('exited'))
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(screen.getByText('Error: boom at main.js:12')).toBeInTheDocument()
    expect(screen.getAllByText('Exited with code 1').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Start terminal')).toBeInTheDocument()
    vi.mocked(window.oxe.terminal.write).mockClear()
    await user.click(screen.getByText('type'))
    expect(window.oxe.terminal.write).not.toHaveBeenCalled()
  })
})
