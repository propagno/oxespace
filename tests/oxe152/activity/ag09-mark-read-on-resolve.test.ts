// Frozen acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-181, AG-09, CA-6 and the data of CA-5), the backend
// of the Activity bell. Written by the planner; the executor must not edit it. MARCA (HANDOFF-3D, AG-09 verdict): "a
// request answered somewhere else leaves the unread", auto-marked as read; the bell is the history (RN-2), so the entry
// stays, read, instead of disappearing. Every entry also says where it happened: "{project} · OxeChat / OxeCode".
// Contract (src/store/activity.store.ts and its producers, the real hooks driven here):
// - ActivityItem gains an optional `place: { project: string; mode: 'chat' | 'code' | 'query' }`.
// - src/hooks/useThreadAttention.ts records a conversation's entries (the needs-you one, the seeded ones of a request
//   already waiting at start, and the outcomes) with place { project: the conversation's project name, the same one
//   the notification names (threadPlace), mode: 'chat' }.
// - src/hooks/useAgentNotifications.ts records a pane's entries with place { project: the workspace's name, mode: 'code' }.
// - Resolution: when the conversation leaves "approval" (answered in the queue, the card or the floating notice) or the
//   pane leaves "needs a decision", its needs-you entry is marked read (markRead) and kept; the bell's unread count no
//   longer counts it. A new wait afterwards is unread again.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useAgentNotifications } from '../../../src/hooks/useAgentNotifications'
import { useThreadAttention } from '../../../src/hooks/useThreadAttention'
import { unreadActivityCount, useActivityStore } from '../../../src/store/activity.store'
import { useSettingsStore } from '../../../src/store/settings.store'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

type Status = 'idle' | 'running' | 'approval' | 'failed'
type Row = { id: string; workspaceId: string; projectId: string; rootPath: string; provider: string; title: string; status: Status; createdAt: number; updatedAt: number; nativeSessionId: null; pinned: boolean }
const row = (id: string, status: Status, title = 'Checkout fix'): Row => ({ id, workspaceId: 'thread:p1', projectId: 'p1', rootPath: 'C:/dev/shop', provider: 'claude', title, status, createdAt: 1, updatedAt: 1, nativeSessionId: null, pinned: false })
const entryFor = (source: string, id: string) => useActivityStore.getState().items.find(item => item.source === source && item.id === id) as (ReturnType<typeof useActivityStore.getState>['items'][number] & { place?: { project: string; mode: string } }) | undefined
const unread = () => unreadActivityCount(useActivityStore.getState().items)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  useActivityStore.getState().reset()
  useSettingsStore.setState({ notificationsEnabled: false })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('AG-09 · a conversation request answered elsewhere is read, and says where it is', () => {
  let rows: Row[] = []
  let pending: unknown[] = []
  let changed: () => void = () => undefined
  beforeEach(() => {
    rows = [row('t1', 'idle')]
    pending = []
    useThreadStore.setState({ projects: [{ projectId: 'p1', displayName: 'shop', identityLabel: 'shop', hidden: false, contexts: [{ rootPath: 'C:/dev/shop', label: 'shop' }] }] as never, selectedId: null, secondaryId: null })
    ;(window as unknown as { oxe: unknown }).oxe = { thread: {
      list: vi.fn(async () => rows.map(item => ({ ...item }))),
      onChanged: vi.fn((listener: () => void) => { changed = listener; return () => undefined }),
      pendingRequestsAll: vi.fn(async () => pending)
    }, notifications: { notify: vi.fn(async () => true) } }
  })
  const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
  const change = async (status: Status) => {
    rows = [row('t1', status)]
    changed()
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
  }

  test('the needs-you entry of a conversation carries its project and OxeChat as its place', async () => {
    renderHook(() => useThreadAttention('code'))
    await settle()
    await change('approval')
    const item = entryFor('thread', 't1')
    expect(item, 'the request is listed').toBeTruthy()
    expect(item!.kind).toBe('needs-you')
    expect(item!.read).toBe(false)
    expect(item!.place).toEqual({ project: 'shop', mode: 'chat' })
  })

  test('answered somewhere else (it leaves approval), the entry stays in the history, read, and the bell stops counting it', async () => {
    renderHook(() => useThreadAttention('code'))
    await settle()
    await change('approval')
    expect(unread()).toBe(1)
    await change('running')
    const item = entryFor('thread', 't1')
    expect(item, 'the bell is the history: the entry stays').toBeTruthy()
    expect(item!.read, 'marked read on resolution').toBe(true)
    expect(unread()).toBe(0)
  })

  test('a new wait after the answer is unread again', async () => {
    renderHook(() => useThreadAttention('code'))
    await settle()
    await change('approval')
    await change('running')
    await change('approval')
    expect(entryFor('thread', 't1')?.read).toBe(false)
    expect(unread()).toBe(1)
  })

  test('a request already waiting at start is listed with its place, and read once it is answered', async () => {
    rows = [row('t1', 'approval')]
    pending = [{ threadId: 't1', requestId: 'r1', workspaceId: 'thread:p1', threadTitle: 'Checkout fix', title: 'Run the tests', createdAt: 5 }]
    renderHook(() => useThreadAttention('code'))
    await settle()
    await settle()
    const seeded = entryFor('thread', 't1')
    expect(seeded, 'seeded from pendingRequestsAll').toBeTruthy()
    expect(seeded!.place).toEqual({ project: 'shop', mode: 'chat' })
    await change('running')
    expect(entryFor('thread', 't1')?.read).toBe(true)
    expect(unread()).toBe(0)
  })
})

describe('AG-09 · a pane decision answered elsewhere is read, and says where it is', () => {
  const running = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null }
  const terminal = (over: Partial<TerminalStateEntry>): TerminalStateEntry => ({ ...running, agentState: null, agentSource: null, location: null, detached: false, ...over } as TerminalStateEntry)
  const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null } as unknown as WorkspacePane
  const workspace = { id: 'ws-1', name: 'api', rootPath: 'C:/dev/api', defaultShellProfileId: 'builtin-claude', panes: [pane] } as unknown as Workspace
  const setAgent = (state: TerminalStateEntry['agentState']) => act(() => useTerminalStore.getState().setAgentState('p1', state, 'hook'))
  const tick = () => act(() => { vi.advanceTimersByTime(1500) })
  beforeEach(() => {
    ;(window as unknown as { oxe: unknown }).oxe = { notifications: { notify: vi.fn(async () => true) } }
    useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] })
    useTerminalStore.setState({ panes: { p1: terminal({}) }, activePaneId: null })
  })

  test('a blocked pane is listed with its workspace and OxeCode; answered, it stays read and uncounted', () => {
    renderHook(() => useAgentNotifications())
    tick()
    setAgent('blocked')
    tick()
    const item = entryFor('code', 'p1')
    expect(item?.kind).toBe('needs-you')
    expect(item?.read).toBe(false)
    expect(item?.place).toEqual({ project: 'api', mode: 'code' })
    setAgent('working')
    tick()
    const after = entryFor('code', 'p1')
    expect(after, 'the bell is the history: the entry stays').toBeTruthy()
    expect(after!.read).toBe(true)
    expect(unread()).toBe(0)
  })
})
