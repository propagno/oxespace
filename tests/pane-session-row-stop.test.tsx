import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../shared/types/workspace'
import { PaneSessionRow } from '../src/components/Sidebar/PaneSessionRow'
import { useTerminalStore, type TerminalStateEntry } from '../src/store/terminal.store'
import { useWorkspaceStore } from '../src/store/workspace.store'

const pane = { id: 'p', workspaceId: 'ws', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: null, rootPath: null } as unknown as WorkspacePane
const workspace = { id: 'ws', name: 'demo', rootPath: 'C:/dev/demo', panes: [pane] } as unknown as Workspace
const running = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentState: null, agentSource: null, location: null, detached: false } as unknown as TerminalStateEntry

function row(): void {
  render(<PaneSessionRow pane={pane} paneIndex={0} workspace={workspace} isActive={false} agentProfiles={[]} onClick={() => undefined} onActivatePane={() => undefined} />)
}

describe('Stop terminal on a sidebar row', () => {
  const stop = vi.fn()
  beforeEach(() => {
    stop.mockReset()
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, terminal: { stop } } })
    useWorkspaceStore.setState({ workspaces: [workspace] })
    useTerminalStore.setState({ panes: { p: running }, activePaneId: null })
  })

  it('leaves the pane reading as exited once main stopped the shell', async () => {
    stop.mockResolvedValue(undefined)
    row()
    fireEvent.contextMenu(screen.getByTestId('pane-session-row'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop terminal' }))
    await waitFor(() => expect(useTerminalStore.getState().panes.p.status).toBe('exited'))
    expect(stop).toHaveBeenCalledWith({ paneId: 'p' })
    expect(screen.getByTestId('pane-session-row').getAttribute('data-tone')).toBe('exited')
    // Nothing left to stop.
    fireEvent.contextMenu(screen.getByTestId('pane-session-row'))
    expect(screen.queryByRole('menuitem', { name: 'Stop terminal' })).toBeNull()
  })

  it('keeps the pane as it was when the stop did not go through', async () => {
    stop.mockRejectedValue(new Error('gone'))
    row()
    fireEvent.contextMenu(screen.getByTestId('pane-session-row'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop terminal' }))
    await waitFor(() => expect(stop).toHaveBeenCalled())
    await Promise.resolve()
    expect(useTerminalStore.getState().panes.p.status).toBe('running')
  })
})
