// Frozen acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-181 CA-9, A5; user decision of 16/11: the OxeQuery
// place in the Activity bell is a new task). Written by the planner; the executor must not edit it. PQ-07·7's live
// event is on main (OXE-220, #902), so OxeQuery joins the bell: an agent's request on a connection is listed while it
// waits, and says where it happened, "{project} · OxeQuery", in --tx-muted like OxeChat and OxeCode (A2's place line).
// Contract (backend first, then the line):
// - src/store/activity.store.ts: ActivitySource gains 'query'; ActivityItem.place.mode gains 'query'.
// - src/hooks/useOxeQueryAttention.ts (new), mounted by src/hooks/useActivitySources.ts: for each request waiting in the
//   approvals queue (src/components/Approvals/approvals.store.ts, useApprovalsStore().queue) whose kind is 'oxequery',
//   it records { source: 'query', id: <request id>, kind: 'needs-you', place: { project, mode: 'query' } } with the
//   target of the agent that asked. From requester.id, 'thread:<id>' → { type: 'thread', threadId } with the
//   conversation's project name (the same name threadPlace gives OxeChat entries); 'pane:<id>' → { type: 'pane',
//   workspaceId, paneId } with the pane's workspace name (as OxeCode entries). A request that leaves the queue is
//   resolved the A1 way (read, outcome 'answered'). Only the fact that something waits: never the SQL nor the
//   request text in the entry.
// - src/components/Activity/ActivityPanel.tsx: the place line for mode 'query' reads "{project} · OxeQuery" (the mode
//   name never translates), in the same element and class as the OxeChat/OxeCode line, whose --tx-muted colour A2's
//   frozen test (ag09-activity-panel.test.tsx) proves.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { ActivityPanel } from '../../../src/components/Activity/ActivityPanel'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { useOxeQueryAttention } from '../../../src/hooks/useOxeQueryAttention'
import { useActivityStore } from '../../../src/store/activity.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

type Entry = ReturnType<typeof useActivityStore.getState>['items'][number] & { place?: { project: string; mode: string } }
const entryFor = (id: string) => useActivityStore.getState().items.find(item => (item.source as string) === 'query' && item.id === id) as Entry | undefined

/** An agent's read on a connection, waiting for the person. Only the fields the producer reads matter here. */
const request = (id: string, requesterId: string) => ({
  id, generation: 1, kind: 'oxequery', risk: 'read', tool: 'oxespace_db_query',
  requester: { kind: 'agent', id: requesterId, label: { code: 'approvals.requester.pane', params: {} } },
  title: { code: 'approvals.title.oxequery', params: {} }, summary: { code: 'approvals.summary.oxequery.read', params: {} },
  agentText: 'SELECT secret FROM users', appNotes: [], options: [], defaultOptionId: 'deny', createdAt: 1
}) as never

const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null } as unknown as WorkspacePane
const workspace = { id: 'ws-1', name: 'api', rootPath: 'C:/dev/api', defaultShellProfileId: 'builtin-claude', panes: [pane] } as unknown as Workspace

beforeEach(() => {
  useActivityStore.getState().reset()
  useApprovalsStore.setState({ queue: [] })
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] })
  useThreadStore.setState({
    projects: [{ projectId: 'p1', displayName: 'shop', identityLabel: 'shop', hidden: false, contexts: [{ rootPath: 'C:/dev/shop', label: 'shop' }] }] as never,
    threads: [{ id: 't1', workspaceId: 'thread:p1', projectId: 'p1', rootPath: 'C:/dev/shop', provider: 'claude', title: 'Checkout fix', status: 'approval', createdAt: 1, updatedAt: 1, nativeSessionId: null, pinned: false }] as never
  })
})
afterEach(() => { cleanup() })

describe('OXE-181 CA-9 · OxeQuery in the Activity bell', () => {
  test('an OxeQuery entry says "{project} · OxeQuery" in --tx-muted', () => {
    const { record } = useActivityStore.getState()
    record({ source: 'thread', id: 't9', kind: 'needs-you', target: { type: 'thread', threadId: 't9' }, title: 'Fix the login bug', at: 1, place: { project: 'shop', mode: 'chat' } } as never)
    record({ source: 'query', id: 'q1', kind: 'needs-you', target: { type: 'pane', workspaceId: 'ws-1', paneId: 'p1' }, title: 'Claude reads orders', at: 2, place: { project: 'shop', mode: 'query' } } as never)
    render(<ActivityPanel onClose={() => undefined} onSelectView={() => undefined} />)
    const placeOf = (title: string) => screen.getByRole('button', { name: new RegExp(title) }).querySelector<HTMLElement>('[data-ui="activity-place"]')
    const query = placeOf('Claude reads orders')
    const chat = placeOf('Fix the login bug')
    expect(query?.textContent?.trim()).toBe('shop · OxeQuery')
    // --tx-muted like the other modes: the same element and class as the OxeChat line (A2's frozen test proves its colour).
    expect(query?.tagName).toBe(chat?.tagName)
    expect(query?.className).toBe(chat?.className)
  })

  test('a request waiting from a pane is listed with its workspace and OxeQuery, never with its SQL', () => {
    renderHook(() => useOxeQueryAttention())
    act(() => { useApprovalsStore.setState({ queue: [request('r1', 'pane:p1')] }) })
    const entry = entryFor('r1')
    expect(entry?.kind).toBe('needs-you')
    expect(entry?.place).toEqual({ project: 'api', mode: 'query' })
    expect(entry?.target).toEqual({ type: 'pane', workspaceId: 'ws-1', paneId: 'p1' })
    expect(JSON.stringify(entry)).not.toContain('SELECT secret')
  })

  test('a request waiting from a conversation is listed with its project and OxeQuery', () => {
    renderHook(() => useOxeQueryAttention())
    act(() => { useApprovalsStore.setState({ queue: [request('r2', 'thread:t1')] }) })
    const entry = entryFor('r2')
    expect(entry?.place).toEqual({ project: 'shop', mode: 'query' })
    expect(entry?.target).toMatchObject({ type: 'thread', threadId: 't1' })
  })

  test('a request answered elsewhere leaves Needs you: read, with Answered', () => {
    renderHook(() => useOxeQueryAttention())
    act(() => { useApprovalsStore.setState({ queue: [request('r3', 'pane:p1')] }) })
    act(() => { useApprovalsStore.setState({ queue: [] }) })
    const entry = entryFor('r3') as (Entry & { outcome?: string }) | undefined
    expect(entry?.read).toBe(true)
    expect(entry?.outcome).toBe('answered')
  })
})
