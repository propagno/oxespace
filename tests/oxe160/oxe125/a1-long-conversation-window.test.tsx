// Frozen acceptance test for 1.6.0 program 160-125 (Jira OXE-125, A1: CA-1's window). Written by the planner; the
// executor must not edit it. The timeline is virtualized on main b3491f620 (ThreadTimelineWindow, useThreadVirtualizer):
// this pins it for an 80-turn conversation with rich answers, which the worker change must keep: at most 25 rows of the
// timeline are mounted at once, while the virtual space still counts every row.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'
import { RICH_ANSWER } from './render-worker-stub'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const TURNS = 80

function longConversation(): ThreadSnapshot {
  const events = Array.from({ length: TURNS }, (_, turn) => [
    { type: 'message', id: `u-${turn}`, role: 'user', text: `Question ${turn}` },
    { type: 'message', id: `a-${turn}`, role: 'assistant', text: `Answer ${turn}\n\n${RICH_ANSWER}` },
    { type: 'completed', status: 'completed' }
  ]).flat() as ThreadSnapshot['events']
  return { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Long conversation', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events }
}

describe('OXE-125 · A1 a long conversation stays windowed', () => {
  it('an 80-turn conversation mounts at most 25 turns', () => {
    const snapshot = longConversation()
    const api = { commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), read: vi.fn(async () => snapshot),
      models: vi.fn(async () => ({ defaultModel: 'm', models: [] })), configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) } as unknown as ThreadApi
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn() }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
    const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
    useAccountStore.setState({ scopes: {}, snapshots: {} })
    useWorkspaceStore.setState({ workspaces: [workspace] })
    useThreadStore.setState({ threads: [snapshot.thread], projects: [], snapshot, selectedId: 'thread', secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] })
    const { container } = render(<ThreadView workspace={workspace} threadId="thread" />)
    const space = container.querySelector('.thread-virtual-space')
    expect(space, 'the timeline is a virtual space').not.toBeNull()
    const total = Number(space!.getAttribute('data-total-rows'))
    const mounted = Number(space!.getAttribute('data-mounted-rows'))
    expect(total).toBeGreaterThanOrEqual(TURNS)
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThanOrEqual(25)
    expect(container.querySelectorAll('[data-thread-row]').length).toBeLessThanOrEqual(25)
  })
})
