import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextAttentionHost } from '../../src/components/Attention/NextAttentionHost'
import { changeLanguage, i18n } from '../../src/i18n'
import { dispatchKeybinding, setKeyboardView } from '../../src/keyboard/keybindings'
import {
  connectAttentionFeed,
  registerAttentionSummaryLoad,
  resetAttentionSummaryLoadForTests
} from '../../src/store/activity.feed'
import { useActivityStore } from '../../src/store/activity.store'
import { useTerminalStore, type TerminalStateEntry } from '../../src/store/terminal.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { Toaster, useToasts } from '../../src/ui/Toast'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

const base = {
  status: 'running',
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false,
  hookState: null,
  hookAt: null,
  agentSource: 'hook',
  location: null,
  detached: false
}
const blocked = { ...base, agentState: 'blocked' } as unknown as TerminalStateEntry
const pane = (id: string, workspaceId: string, displayName: string): WorkspacePane =>
  ({ id, workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName, shellProfileId: null, rootPath: null, createdAt: null }) as unknown as WorkspacePane
const ws = (id: string, panes: WorkspacePane[]): Workspace =>
  ({ id, name: id, rootPath: `/repo/${id}`, defaultShellProfileId: null, panes }) as unknown as Workspace
const thread = (id: string, status: string) => ({ id, workspaceId: 'ws-1', title: 'Review PR', status } as never)
const pressCtrlShiftU = () =>
  new KeyboardEvent('keydown', { key: 'U', code: 'KeyU', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })

describe('OXE-287 NextAttentionHost startup readiness', () => {
  const selectThread = vi.fn(async () => undefined)
  const setActiveWorkspace = vi.fn(async (id: string) => {
    useWorkspaceStore.setState({ activeWorkspaceId: id })
  })

  beforeEach(async () => {
    await changeLanguage('pt-BR')
    resetAttentionSummaryLoadForTests()
    useActivityStore.getState().reset()
    useToasts.setState({ toasts: [] })
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, shellProfiles: [], setActiveWorkspace } as never)
    useTerminalStore.setState({ panes: {}, activePaneId: null })
    useThreadStore.setState({ threads: [], unreadIds: [], select: selectThread } as never)
    setKeyboardView('code')
    selectThread.mockClear()
    setActiveWorkspace.mockClear()
  })

  afterEach(() => {
    cleanup()
    resetAttentionSummaryLoadForTests()
    useToasts.setState({ toasts: [] })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('a press before the summary loads still answers', async () => {
    let resolveLoad!: () => void
    const deferred = new Promise<void>(resolve => { resolveLoad = resolve })
    registerAttentionSummaryLoad(deferred)

    const selectView = vi.fn()
    render(<>
      <NextAttentionHost selectView={selectView} />
      <Toaster />
    </>)

    // Press Ctrl+Shift+U while the startup summary is still loading.
    act(() => { dispatchKeybinding(pressCtrlShiftU()) })
    expect(selectView).not.toHaveBeenCalled()
    expect(useToasts.getState().toasts).toHaveLength(0)

    // Summary finishes loading with a waiting conversation: the queued press navigates to it.
    act(() => {
      useThreadStore.setState({ threads: [thread('t-early', 'approval')] })
      resolveLoad()
    })
    await waitFor(() => {
      expect(selectView).toHaveBeenCalledWith('thread')
      expect(selectThread).toHaveBeenCalledWith('t-early')
    })

    // Second scenario: startup load rejects/fails with nothing waiting — must still settle and show the toast.
    useThreadStore.setState({ threads: [] })
    useActivityStore.getState().reset()
    useToasts.setState({ toasts: [] })
    let rejectLoad!: (err: Error) => void
    const failing = new Promise<void>((_resolve, reject) => { rejectLoad = reject })
    registerAttentionSummaryLoad(failing)

    act(() => { dispatchKeybinding(pressCtrlShiftU()) })
    expect(useToasts.getState().toasts).toHaveLength(0)

    act(() => { rejectLoad(new Error('offline')) })
    await waitFor(() => {
      const region = screen.getByRole('region', { name: 'Avisos' })
      expect(region).toHaveTextContent(i18n.t('activityCenter.nothingWaiting'))
    })
  })

  it('with the summary loaded the order is unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    connectAttentionFeed()
    const p1 = pane('p1', 'ws-1', 'api')
    const p2 = pane('p2', 'ws-2', 'web')
    useWorkspaceStore.setState({ workspaces: [ws('ws-1', [p1]), ws('ws-2', [p2])], activeWorkspaceId: 'ws-1', shellProfiles: [], setActiveWorkspace } as never)

    vi.setSystemTime(1000)
    useThreadStore.setState({ threads: [thread('t1', 'approval')] })
    vi.setSystemTime(2000)
    useTerminalStore.setState(state => ({ panes: { ...state.panes, p2: blocked } }))
    vi.setSystemTime(3000)
    useTerminalStore.setState(state => ({ panes: { ...state.panes, p1: blocked } }))

    const selectView = vi.fn()
    render(<NextAttentionHost selectView={selectView} />)

    const visited: Array<string | null> = []
    for (let press = 0; press < 4; press++) {
      act(() => { dispatchKeybinding(pressCtrlShiftU()) })
      visited.push(selectView.mock.calls.at(-1)?.[0] === 'thread' ? String(selectThread.mock.calls.at(-1)?.[0]) : useTerminalStore.getState().activePaneId)
    }
    expect(visited).toEqual(['t1', 'p2', 'p1', 't1'])
  })
})
