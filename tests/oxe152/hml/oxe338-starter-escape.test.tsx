// OXE-338: a welcome starter opens the new conversation with its prompt, one Escape in the composer does not stop
// a running turn (a second one does, with a hint between them), and the send key respects the length limit.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { threadStarters } from '../../../src/components/Threads/ThreadEmptyState'
import { consumePendingNewDraft, queueNewConversationDraft } from '../../../src/components/Terminal/terminalToChat'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../shared/threadLimits'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
afterEach(() => { cleanup(); vi.useRealTimers() })

const project = { projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }
function fixture(status: ThreadSnapshot['thread']['status'], selected = true) {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Work', pinned: false, status, nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [{ type: 'message', id: 'first', role: 'user', text: 'Start' }] }
  const api = { commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [project], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'm', models: [] })), configure: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn() }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: selected ? [snapshot.thread] : [], projects: [project], snapshot: selected ? snapshot : null, selectedId: selected ? 'thread' : null, secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] })
  return { api, workspace }
}

describe('OXE-338 starter prompt and composer Escape', () => {
  it('CA-1: a welcome starter asks for a new conversation with its own prompt', () => {
    const f = fixture('idle', false)
    const onNewThread = vi.fn()
    render(<ThreadView workspace={f.workspace} threadId={null} onNewThread={onNewThread} />)
    const starter = threadStarters()[0]!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(starter.label) }))
    expect(onNewThread).toHaveBeenCalledWith(starter.prompt)
    // The plain "New conversation" button still opens a blank one.
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(onNewThread).toHaveBeenLastCalledWith()
  })

  it('CA-1: the queued starter prompt becomes the new conversation draft', () => {
    fixture('idle', false)
    queueNewConversationDraft('project', 'Explain this repository')
    expect(consumePendingNewDraft({ threadId: 'created', projectId: 'project', rootPath: '/repo' })).toBe('Explain this repository')
    expect(useThreadStore.getState().drafts.created).toBe('Explain this repository')
    // A draft already waiting for that project (a terminal selection) is kept, with the starter after it.
    queueNewConversationDraft('project', 'selected lines')
    queueNewConversationDraft('project', 'Review my changes')
    expect(useThreadStore.getState().drafts['new:project']).toBe('selected lines\n\nReview my changes')
  })

  it('CA-2: one Escape while the agent runs does not stop the turn; a second one soon after does', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const f = fixture('running')
    render(<ThreadView workspace={f.workspace} threadId="thread" />)
    const input = screen.getByRole('textbox', { name: 'Message', exact: true })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(f.api.interrupt).not.toHaveBeenCalled()
    expect(screen.getByText('Press Esc again to stop the turn')).toBeVisible()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(f.api.interrupt).toHaveBeenCalledWith('thread')
  })

  it('CA-2: the hint expires, and an Escape after it only arms again', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const f = fixture('running')
    render(<ThreadView workspace={f.workspace} threadId="thread" />)
    const input = screen.getByRole('textbox', { name: 'Message', exact: true })
    fireEvent.keyDown(input, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByText('Press Esc again to stop the turn')).toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(f.api.interrupt).not.toHaveBeenCalled()
    expect(screen.getByText('Press Esc again to stop the turn')).toBeVisible()
  })

  it('CA-2: the send key does not send a message over the length limit', () => {
    const f = fixture('idle')
    useThreadStore.getState().setDraft('thread', 'x'.repeat(THREAD_MESSAGE_MAX_CHARS + 1))
    render(<ThreadView workspace={f.workspace} threadId="thread" />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message', exact: true }), { key: 'Enter' })
    expect(f.api.send).not.toHaveBeenCalled()
  })
})
