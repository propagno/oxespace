import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { deriveStatusOrigin, derivePaneDisplayState, deriveStatusTone, type PaneDisplayTerminalState } from '../../src/utils/paneDisplay'
import { useTerminalStore, type TerminalStateEntry } from '../../src/store/terminal.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { useActivityStore } from '../../src/store/activity.store'
import { useSettingsStore } from '../../src/store/settings.store'
import { describeAttention, useAttentionSummary } from '../../src/hooks/useAttentionSummary'
import { useAgentNotifications } from '../../src/hooks/useAgentNotifications'
import { PaneSessionRow } from '../../src/components/Sidebar/PaneSessionRow'
import { ModeSwitch } from '../../src/components/Navigation/ModeSwitch'
import { explainRows } from '../../src/components/Grid/StatusExplainDialog'

// The header's content and branch badge read terminals and Git; they are not what this file checks.
vi.mock('../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))
vi.mock('../../src/components/Workspace/PaneBranchBadge', () => ({ PaneBranchBadge: () => null }))
const { PaneContainer } = await import('../../src/components/Grid/PaneContainer')

const running: PaneDisplayTerminalState = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null }
const entry = (over: Partial<TerminalStateEntry>): TerminalStateEntry => ({ ...running, agentState: null, agentSource: null, location: null, detached: false, ...over } as TerminalStateEntry)

const pane = (id: string): WorkspacePane => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null } as WorkspacePane)
const workspace = (panes: WorkspacePane[]): Workspace => ({ id: 'ws-1', name: 'demo', rootPath: 'C:/dev/demo', defaultShellProfileId: 'builtin-claude', panes } as unknown as Workspace)
const display = (terminal: PaneDisplayTerminalState) => derivePaneDisplayState({ pane: pane('p'), workspace: workspace([]), terminal, profile: null, paneIndex: 0 })

beforeEach(() => {
  useActivityStore.getState().reset()
  useTerminalStore.setState({ panes: {}, activePaneId: null })
  useWorkspaceStore.setState({ workspaces: [], shellProfiles: [] })
})

describe('a decision is not a finished turn', () => {
  it('gives blocked its own tone, label and reason, and leaves done as it was', () => {
    expect(deriveStatusTone({ ...running, agentState: 'blocked' })).toBe('needs-decision')
    expect(deriveStatusTone({ ...running, agentState: 'done' })).toBe('awaiting')
    const blocked = display({ ...running, agentState: 'blocked', agentSource: 'hook' })
    const done = display({ ...running, agentState: 'done', agentSource: 'hook' })
    expect(blocked.statusLabel).toBe('Needs your decision')
    expect(blocked.subtitle).toBe('Claude · Needs your decision')
    expect(blocked.attentionReason).toBe('Needs your approval or answer')
    expect(done.statusLabel).toBe('Awaiting')
    expect(done.attentionReason).toBe('Finished, not seen yet')
  })

  it('says where the status comes from, and marks a timing guess as estimated', () => {
    expect(deriveStatusOrigin({ ...running, agentState: 'blocked', agentSource: 'hook' })).toBe('hook')
    expect(deriveStatusOrigin({ ...running, agentState: 'working', agentSource: 'screen' })).toBe('screen')
    expect(deriveStatusOrigin({ ...running, agentState: 'idle' })).toBe('lifecycle')
    expect(deriveStatusOrigin({ ...running, hookState: 'working', hookAt: Date.now() })).toBe('hook')
    expect(deriveStatusOrigin({ ...running, isWorking: true })).toBe('heuristic')
    expect(deriveStatusOrigin({ ...running, status: 'exited' })).toBeNull()
    expect(display({ ...running, agentState: 'blocked', agentSource: 'hook' })).toMatchObject({ originLabel: "Reported by the agent's hooks", statusEstimated: false })
    expect(display({ ...running, agentState: 'working', agentSource: 'screen' }).originLabel).toBe("Read from the agent's screen")
    expect(display({ ...running, agentState: 'idle' }).originLabel).toBe("From the agent's lifecycle")
    expect(display({ ...running, isWorking: true })).toMatchObject({ originLabel: 'Estimated from terminal activity', statusEstimated: true })
    // A plain idle shell has nothing to explain.
    expect(display({ ...running })).toMatchObject({ originLabel: null, statusEstimated: false })
  })
})

describe('the sidebar row and the pane header', () => {
  const ws = workspace([pane('blocked'), pane('done')])
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [ws] })
    useTerminalStore.setState({ panes: { blocked: entry({ agentState: 'blocked', agentSource: 'hook' }), done: entry({ agentState: 'done', agentSource: 'hook' }) } })
  })

  it('words a blocked row differently from a done one, with its origin for screen readers', () => {
    const { container } = render(<>
      <PaneSessionRow pane={ws.panes[0]} paneIndex={0} workspace={ws} isActive={false} agentProfiles={[]} onClick={() => undefined} onActivatePane={() => undefined} />
      <PaneSessionRow pane={ws.panes[1]} paneIndex={1} workspace={ws} isActive={false} agentProfiles={[]} onClick={() => undefined} onActivatePane={() => undefined} />
    </>)
    const [blocked, done] = [...container.querySelectorAll('[data-testid="pane-session-row"]')] as HTMLElement[]
    expect(within(blocked).getByTestId('pane-row-status')).toHaveTextContent('Claude · Needs your decision')
    expect(within(done).getByTestId('pane-row-status')).toHaveTextContent('Claude · Awaiting')
    expect(blocked.querySelector('.activity-needs-decision')).not.toBeNull()
    expect(done.querySelector('.activity-needs-decision')).toBeNull()
    expect(blocked).toHaveTextContent("needs your decision, Reported by the agent's hooks")
    expect(within(blocked).getByTestId('pane-row-status')).toHaveAttribute('title', "Needs your approval or answer · Reported by the agent's hooks")
  })

  it('shows "Needs your decision" in the blocked header, announces it politely, and explains the status from the menu', async () => {
    const explain = vi.fn(async () => ({ state: { paneId: 'blocked', workspaceId: 'ws-1', agent: 'claude', state: 'blocked', source: 'hook', seen: false, since: 1_700_000_000_000, stateChangeSeq: 1, completionSeq: 0 }, hook: { state: 'blocked', at: 1_700_000_000_000 }, screen: null, pendingIdle: false }))
    ;(window as unknown as { oxe: unknown }).oxe = { agentState: { explain } }
    const { container } = render(<>
      <PaneContainer pane={ws.panes[0]} workspace={ws} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />
      <PaneContainer pane={ws.panes[1]} workspace={ws} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />
    </>)
    const [blocked, done] = [...container.querySelectorAll('[data-testid="pane-container"]')] as HTMLElement[]
    expect(within(blocked).getByTestId('pane-decision-chip')).toHaveTextContent('Needs your decision')
    expect(within(done).queryByTestId('pane-decision-chip')).toBeNull()
    expect(within(blocked).getByRole('status')).toHaveTextContent('Claude needs your decision: Needs your approval or answer')
    expect(within(done).getByRole('status')).toBeEmptyDOMElement()
    expect(within(blocked).getByTestId('pane-status-text')).toHaveTextContent("Needs your decision · Reported by the agent's hooks")
    expect(within(done).getByTestId('pane-status-text')).toHaveTextContent("Awaiting · Reported by the agent's hooks")

    fireEvent.click(within(blocked).getByRole('button', { name: 'More pane actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Why this status?' }))
    const dialog = await screen.findByTestId('status-explain-dialog')
    expect(explain).toHaveBeenCalledWith('blocked')
    expect(await within(dialog).findByText('Waiting for a decision')).toBeInTheDocument()
    expect(within(dialog).getByText("Reported by the agent's hooks")).toBeInTheDocument()
    expect(within(dialog).getByText('Needs your decision')).toBeInTheDocument()
  })

  it('explains a pane main knows nothing about as an estimate', () => {
    expect(explainRows({ statusLabel: 'Thinking', originLabel: 'Estimated from terminal activity' }, null)).toEqual([
      { label: 'Shown', detail: 'Thinking' },
      { label: 'Comes from', detail: 'Estimated from terminal activity' }
    ])
  })
})

describe('the Code counter', () => {
  it('counts only the panes that need a decision, and says so', () => {
    const ws = workspace([pane('a'), pane('b'), pane('c')])
    act(() => {
      useWorkspaceStore.setState({ workspaces: [ws] })
      useTerminalStore.setState({ panes: { a: entry({ agentState: 'blocked' }), b: entry({ agentState: 'blocked' }), c: entry({ agentState: 'done' }) } })
    })
    const { result } = renderHook(() => useAttentionSummary())
    expect(result.current.code.needsYou).toBe(2)
    expect(describeAttention(result.current.code, 'code')).toBe('2 need your decision')
    expect(describeAttention({ needsYou: 1, failed: 0, working: 0 }, 'code')).toBe('1 needs your decision')
    render(<ModeSwitch mode="thread" onSelect={() => undefined} />)
    const badge = screen.getByTestId('attention-badge')
    expect(badge).toHaveTextContent('2')
    expect(badge).toHaveAttribute('aria-label', '2 need your decision')
    // A finished turn alone puts nothing on the counter.
    act(() => useTerminalStore.setState({ panes: { a: entry({ agentState: 'done' }), b: entry({ agentState: 'idle' }), c: entry({ agentState: 'done' }) } }))
    expect(screen.queryByTestId('attention-badge')).toBeNull()
  })
})

describe('notifications for a decision', () => {
  const notify = vi.fn(async (_payload: { title: string; body: string; paneId: string; workspaceId: string }) => true)
  beforeEach(() => {
    vi.useFakeTimers()
    notify.mockClear()
    ;(window as unknown as { oxe: unknown }).oxe = { notifications: { notify } }
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    useSettingsStore.setState({ notificationsEnabled: true })
    useWorkspaceStore.setState({ workspaces: [workspace([pane('p1')])] })
    useTerminalStore.setState({ panes: { p1: entry({}) } })
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  const tick = (ms = 1500) => act(() => { vi.advanceTimersByTime(ms) })
  const setState = (agentState: TerminalStateEntry['agentState']) => act(() => useTerminalStore.getState().setAgentState('p1', agentState, 'hook'))

  it('records and pings a blocked pane right away, even inside the finished-turn cooldown', () => {
    renderHook(() => useAgentNotifications())
    tick()
    setState('done')
    tick(12_000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ title: 'Claude — waiting for you' })

    setState('blocked')
    tick()
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls[1][0]).toMatchObject({ title: 'Claude — needs your decision', paneId: 'p1', workspaceId: 'ws-1' })
    expect(useActivityStore.getState().items[0]).toMatchObject({ kind: 'needs-you', id: 'p1', detail: 'demo: the agent stopped and is waiting for your approval or answer.' })

    // Held, it does not ping again; answered, the request leaves the list.
    tick(6000)
    expect(notify).toHaveBeenCalledTimes(2)
    setState('working')
    tick()
    expect(useActivityStore.getState().items.some(item => item.kind === 'needs-you')).toBe(false)
  })

  it('a finished turn still waits for the stability gate and the cooldown', () => {
    renderHook(() => useAgentNotifications())
    tick()
    setState('done')
    tick()
    expect(notify).not.toHaveBeenCalled()
    expect(useActivityStore.getState().items).toEqual([])
  })
})
