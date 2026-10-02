import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../src/store/account.store'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { AddThreadProjectDialog } from '../src/components/Threads/ThreadDialogs'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { ThreadView } from '../src/components/Threads/ThreadView'
import type { Workspace } from '../shared/types/workspace'
import type { ThreadApi, ThreadCommandCatalog, ThreadSnapshot } from '../shared/types/thread'

vi.mock('../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function fixture() {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }
  const api: ThreadApi = { commands: vi.fn(async () => ({ commands: [{ name: 'oxe-plan', description: 'Plan a change', source: 'claude' as const }, { name: 'compact', description: 'Compact history', source: 'claude' as const }] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), addProject: vi.fn(async () => ({ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] })), setProjectHidden: vi.fn(async () => {}), list: vi.fn(async () => [snapshot.thread]), create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'A native catalog entry', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async (_id, configuration, revision) => { Object.assign(snapshot.thread, configuration, { configurationRevision: revision + 1 }); return { ...snapshot, thread: { ...snapshot.thread } } }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  const writeText = vi.fn(async () => true)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] })
  return { snapshot, api, workspace, writeText }
}

describe('Thread workspace UI', () => {
  it('offers explicit prose replies for review without sending automatically', async () => {
    const f = fixture()
    f.snapshot.events = [
      { type: 'message', id: 'prompt', role: 'user', text: 'Choose a rollout' },
      { type: 'message', id: 'answer', role: 'assistant', text: 'As opções:\n- **A (Recomendado):** Stage it.\n- **B:** Wait.' },
      { type: 'completed', status: 'completed' }
    ]
    render(<ThreadView workspace={f.workspace} />)
    const replies = screen.getByLabelText('Suggested replies')
    fireEvent.click(replies.querySelector('button')!)
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('A')
    expect(f.api.send).not.toHaveBeenCalled()
  })
  it('shows native opt-in choices and forwards the selected answer', async () => {
    const f = fixture()
    f.api.respond = vi.fn(async () => {})
    f.snapshot.thread.status = 'approval'
    f.snapshot.events = [{ type: 'request', id: 'choice', request: { id: 'choice', nativeId: 'native-choice', nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', state: 'pending', generation: 1, createdAt: 1, questions: [{ id: 'rollout', question: 'Which rollout?', options: [{ label: 'Staged' }, { label: 'Immediate' }] }] } }]
    render(<ThreadView workspace={f.workspace} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Staged' }))
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    await waitFor(() => expect(f.api.respond).toHaveBeenCalledWith('thread', 'choice', { answers: { rollout: ['Staged'] } }))
  })
  it('shows a submitted message before the native send completes and reconciles the saved event', async () => {
    const f = fixture()
    let finishSend!: () => void
    vi.mocked(f.api.send).mockImplementation(() => new Promise(resolve => { finishSend = resolve }))
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Instant message' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(f.api.send).toHaveBeenCalledWith('thread', 'Instant message', [])
    expect(screen.getByLabelText('Sending message')).toHaveTextContent('Instant message')
    expect(input).toHaveValue('')
    act(() => useThreadStore.setState({ snapshot: { ...f.snapshot, events: [{ type: 'message', id: 'new-turn', role: 'user', text: 'Instant message' }] } }))
    expect(screen.queryByLabelText('Sending message')).not.toBeInTheDocument()
    expect(screen.getAllByText('Instant message')).toHaveLength(1)
    await act(async () => finishSend())
  })
  it('opens the side-by-side review when a newly completed wide-screen turn reports file changes', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440)
    vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([], this as unknown as ResizeObserver) } disconnect() {} })
    try {
      const f = fixture()
      render(<ThreadView workspace={f.workspace} />)
      act(() => useThreadStore.setState({ snapshot: { ...f.snapshot, events: [
        { type: 'message', id: 'prompt', role: 'user', text: 'Update docs' },
        { type: 'turn-diff', id: 'turn-diff:native', turnId: 'native', files: [{ path: 'docs/thread-view.md', kind: 'update', source: 'native-patch', state: 'completed' }] },
        { type: 'completed', status: 'completed' }
      ] } }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open thread review' })).toHaveAttribute('aria-expanded', 'true'))
      expect(screen.getByLabelText('Thread workbench')).toBeVisible()
    } finally { width.mockRestore() }
  })
  it('keeps the composed request when the native session is busy elsewhere', async () => {
    const f = fixture()
    vi.mocked(f.api.send).mockRejectedValueOnce(Error('This native session is active elsewhere.'))
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Update the docs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'Update the docs', []))
    await waitFor(() => expect(screen.getByText(/native session is active elsewhere/i)).toBeVisible())
    expect(screen.queryByLabelText('Sending message')).not.toBeInTheDocument()
    expect(input).toHaveValue('Update the docs')
  })
  it('adds a Thread project through a folder-only flow without Code layout choices', async () => {
    const onAdd = vi.fn(async () => {})
    const onPickFolder = vi.fn(async () => 'C:\\projects\\thread-app')
    render(<AddThreadProjectDialog onPickFolder={onPickFolder} onAdd={onAdd} onClose={vi.fn()} />)
    expect(screen.queryByText(/layout/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^agents$/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Project folder path' })).toHaveValue('C:\\projects\\thread-app'))
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('C:\\projects\\thread-app'))
  })
  it('restores one removed project without restoring the others', async () => {
    const f = fixture()
    useThreadStore.setState({ projects: [
      { projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: true, contexts: [{ rootPath: '/repo', label: 'Repo' }] },
      { projectId: 'other', displayName: 'Other', identityLabel: '/other', hidden: true, contexts: [{ rootPath: '/other', label: 'Other' }] }
    ], hiddenProjects: ['project', 'other'] })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Repo Restore' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Other Restore' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Repo Restore' }))
    await waitFor(() => expect(useThreadStore.getState().hiddenProjects).toEqual(['other']))
    expect(screen.getByRole('button', { name: 'New thread in Repo' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Other Restore' })).toBeVisible()
  })
  it('creates a thread in the project context and requires confirmation before deleting a conversation', async () => {
    const f = fixture(), onCreate = vi.fn()
    const user = userEvent.setup()
    f.api.command = vi.fn(async () => ({ kind: 'navigate' }))
    vi.mocked(f.api.list).mockResolvedValue([])
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'New thread in Repo' }))
    expect(onCreate).toHaveBeenCalledWith('project', '/repo')
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    expect(f.api.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(f.api.command).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete conversation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread', exact: true }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/delete confirm'))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBeNull())
  })
  it('keeps archived conversations discoverable and restores one directly from the sidebar', async () => {
    const f = fixture()
    f.snapshot.thread.archived = true
    f.api.command = vi.fn(async () => { f.snapshot.thread.archived = false; return { kind: 'navigate', threadId: 'thread' } })
    useThreadStore.setState({ threads: [f.snapshot.thread] })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Archived 1' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Restore Auth investigation' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archived 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore Auth investigation' }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/resume thread'))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('thread'))
    expect(useThreadStore.getState().threads.find(thread => thread.id === 'thread')?.archived).toBe(false)
  })
  it('pins and archives a session from its context menu, then exposes its recovery path', async () => {
    const f = fixture()
    const user = userEvent.setup()
    vi.mocked(f.api.pin).mockImplementation(async (_id, pinned) => { f.snapshot.thread.pinned = pinned })
    f.api.command = vi.fn(async () => { f.snapshot.thread.archived = true; return { kind: 'navigate' } })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Pin conversation' }))
    await waitFor(() => expect(f.api.pin).toHaveBeenCalledWith('thread', true))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Pinned' })).toBeVisible())
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive conversation' }))
    expect(f.api.command).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Archive conversation' }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/archive confirm'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Archived 1' })).toHaveAttribute('aria-expanded', 'true'))
  })
  it('renames a session from its context menu and refreshes the visible list', async () => {
    const f = fixture()
    const user = userEvent.setup()
    f.api.command = vi.fn(async () => { f.snapshot.thread.title = 'Auth follow-up'; return { kind: 'applied' } })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename conversation…' }))
    const name = screen.getByRole('textbox', { name: 'Conversation name' })
    await user.clear(name)
    await user.type(name, 'Auth follow-up')
    await user.click(screen.getByRole('button', { name: 'Rename conversation' }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/rename Auth follow-up'))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Auth follow-up/ })).toBeVisible())
  })
  it('marks a conversation unread in the session menu and clears the marker when opened', async () => {
    const f = fixture()
    const user = userEvent.setup()
    useThreadStore.setState({ unreadIds: [] })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Actions for Auth investigation' }))
    await user.click(screen.getByRole('menuitem', { name: 'Mark as unread' }))
    expect(screen.getByLabelText('Unread conversation')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Unread conversation Auth investigation/ }))
    await waitFor(() => expect(useThreadStore.getState().unreadIds).toEqual([]))
  })
  it('keeps execution status visible and independent from the unread marker', () => {
    const f = fixture()
    useThreadStore.setState({ unreadIds: ['thread'] })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    const status = () => screen.getByRole('button', { name: /^Unread conversation Auth investigation/ }).querySelector('.thread-session-state')
    expect(status()).toHaveTextContent('Ready')
    expect(screen.getByLabelText('Unread conversation')).toBeVisible()
    act(() => useThreadStore.setState({ threads: [{ ...f.snapshot.thread, status: 'running' }] }))
    expect(status()).toHaveTextContent('Running')
    expect(screen.getByLabelText('Unread conversation')).toBeVisible()
    act(() => useThreadStore.setState({ threads: [{ ...f.snapshot.thread, status: 'approval' }] }))
    expect(status()).toHaveTextContent('Needs input')
    act(() => useThreadStore.setState({ threads: [{ ...f.snapshot.thread, status: 'idle', lastTurnStatus: 'completed' }] }))
    expect(status()).toHaveTextContent('Completed')
  })
  it('uses the Code mode provider symbols for Claude Code and Codex threads', () => {
    const f = fixture()
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    const row = screen.getByText('Auth investigation').closest('button')!
    const icon = () => row.querySelector('.thread-session-provider .agent-provider-icon') as HTMLElement
    expect(icon()).toHaveStyle({ background: 'var(--provider-claude)' })
    expect(row.querySelector('.thread-session-provider')).toHaveTextContent('Claude Code')
    act(() => useThreadStore.setState({ threads: [{ ...f.snapshot.thread, provider: 'codex' }] }))
    expect(icon()).toHaveStyle({ background: 'var(--provider-codex)' })
    expect(row.querySelector('.thread-session-provider')).toHaveTextContent('Codex')
    expect(row.querySelector('.thread-session-indicator')).toHaveAttribute('data-status', 'ready')
  })
  it('ignores a late catalog from the previously selected thread', async () => {
    const f = fixture()
    let resolveFirst!: (catalog: ThreadCommandCatalog) => void
    vi.mocked(f.api.commands).mockImplementation(id => id === 'thread' ? new Promise(resolve => { resolveFirst = resolve })
      : Promise.resolve({ commands: [{ name: 'second-skill', description: 'Second project command', source: 'claude' }] }))
    render(<ThreadView workspace={f.workspace} />)
    await waitFor(() => expect(f.api.commands).toHaveBeenCalledWith('thread'))
    act(() => useThreadStore.setState({ selectedId: 'second', snapshot: { thread: { ...f.snapshot.thread, id: 'second', rootPath: '/second' }, events: [] } }))
    const input = screen.getByRole('textbox', { name: 'Message' })
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '/' } })
    await screen.findByRole('option', { name: /Second project command/ })
    await act(async () => resolveFirst({ commands: [{ name: 'stale', description: 'Previous project command', source: 'claude' }] }))
    expect(screen.queryByRole('option', { name: /Previous project command/ })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Second project command/ })).toBeVisible()
    expect(input).toHaveValue('/')
  })
  it('loads commands once and preserves focus while typing, reopening and refreshing the slash menu', async () => {
    const f = fixture(); render(<ThreadView workspace={f.workspace} />)
    await waitFor(() => expect(f.api.commands).toHaveBeenCalledTimes(1))
    const input = screen.getByRole('textbox', { name: 'Message' })
    act(() => input.focus())
    for (const value of ['/', '/m', '/mo', '/mod', '/mode', '/model']) {
      fireEvent.change(input, { target: { value } })
      fireEvent.select(input, { target: { selectionStart: 0, selectionEnd: 0 } })
      fireEvent.select(input, { target: { selectionStart: value.length, selectionEnd: value.length } })
      expect(input).toHaveFocus()
      expect(input).toHaveValue(value)
    }
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.change(input, { target: { value: '/' } })
    act(() => { input.blur(); input.focus() })
    await screen.findByRole('listbox', { name: 'Thread commands' })
    expect(f.api.commands).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Refresh commands' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh commands' }))
    await waitFor(() => expect(f.api.commands).toHaveBeenCalledWith('thread', true))
    expect(f.api.commands).toHaveBeenCalledTimes(2)
    expect(input).toHaveFocus()
    expect(input).toHaveValue('/')
    expect(f.api.send).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Native CLI', { exact: true })).not.toBeInTheDocument()
  })
  it('offers delegated native resume instead of a no-op entry for the current conversation', async () => {
    const f = fixture()
    f.api.command = vi.fn(async () => ({ kind: 'panel', surface: 'sessions', title: 'resume' }))
    const delegated = { id: 'task-1', workspaceId: 'ws', originWorkspaceId: 'ws', objective: 'Continue card 142', branch: 'feature/CARD-142',
      state: 'interrupted', destinationThreadId: 'delegated-thread', agentProfileId: 'codex', nativeSession: { provider: 'codex', nativeSessionId: 'native-142', resumable: true }, recoveryActions: ['resume'] }
    const status = vi.fn(async () => ({ enabled: true, tasks: [delegated], nextCursor: null }))
    const control = vi.fn(async () => {})
    Object.defineProperty(window, 'oxe', { configurable: true, value: { ...window.oxe, delegation: { status, control } } })
    vi.mocked(f.api.read).mockImplementation(async id => id === 'delegated-thread' ? { ...f.snapshot, thread: { ...f.snapshot.thread, id, title: 'Delegated work', provider: 'codex' } } : f.snapshot)
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '/resume' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('The current conversation is already open. Send a message to continue its native session.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Auth investigation' })).not.toBeInTheDocument()
    const delegatedButton = screen.getByRole('button', { name: /Continue card 142/ })
    await waitFor(() => expect(delegatedButton).toBeEnabled())
    fireEvent.click(delegatedButton)
    await waitFor(() => expect(control).toHaveBeenCalledWith('ws', 'task-1', 'resume'))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('delegated-thread'))
    expect(f.api.send).not.toHaveBeenCalled()
  })
  it('shows the provider resume ID separately from internal OXESpace IDs', async () => {
    const f = fixture()
    f.api.command = vi.fn(async () => ({ kind: 'panel', title: 'Conversation status', rows: [
      { label: 'Thread ID', detail: 'local-thread-id' }, { label: 'Project ID', detail: 'local-project-id' },
      { label: 'Workspace ID', detail: 'local-workspace-id' }, { label: 'Provider', detail: 'claude' },
      { label: 'Status', detail: 'idle' }, { label: 'Native session ID (resume)', detail: 'native-claude-id' },
      { label: 'Directory', detail: '/repo' }
    ] }))
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '/status' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const dialog = await screen.findByRole('dialog', { name: 'Conversation status' })
    expect(dialog).toHaveTextContent('Native session ID (resume)')
    expect(dialog).toHaveTextContent('native-claude-id')
    expect(Array.from(dialog.querySelectorAll('.desktop-detail-list:first-of-type dt')).slice(0, 2).map(node => node.textContent)).toEqual(['Provider', 'Native session ID (resume)'])
    expect(screen.getByText('local-thread-id')).not.toBeVisible()
    fireEvent.click(screen.getByText('Internal OXESpace IDs and runtime'))
    expect(screen.getByText('local-thread-id')).toBeVisible()
  })
  it('lists provider sessions from this project and resumes the selected native Codex conversation', async () => {
    const f = fixture()
    f.snapshot.thread.provider = 'codex'
    const nativeId = '01234567-89ab-4cde-8f01-23456789abcd'
    f.api.command = vi.fn(async (_id: string, command: string) => command === '/resume'
      ? { kind: 'panel' as const, surface: 'sessions' as const, title: 'resume' }
      : { kind: 'navigate' as const, threadId: 'imported' })
    vi.mocked(f.api.read).mockImplementation(async id => id === 'imported'
      ? { ...f.snapshot, thread: { ...f.snapshot.thread, id, nativeSessionId: nativeId, title: 'Imported Codex session' } }
      : f.snapshot)
    const list = vi.fn(async () => [{
      sessionId: nativeId, provider: 'codex', modelId: 'gpt-5.6', requestCount: 4,
      sessionStartedAtMs: new Date('2026-09-21T22:57:48Z').getTime(), lastUpdatedMs: new Date('2026-09-21T23:05:00Z').getTime(),
      totalTokens: 0, estimatedCostUsd: 0, filePath: null, isFork: false, parentSessionId: null,
      label: null, firstMessagePreview: null, workspaceRootPath: '/repo'
    }])
    Object.defineProperty(window, 'oxe', { configurable: true, value: {
      ...window.oxe, session: { list }, delegation: { status: vi.fn(async () => ({ enabled: true, tasks: [], nextCursor: null })) }
    } })
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '/resume' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const nativeButton = await screen.findByRole('button', { name: new RegExp(nativeId) })
    expect(nativeButton).toHaveTextContent('Started')
    expect(nativeButton).toHaveTextContent('gpt-5.6')
    expect(list).toHaveBeenCalledWith({ workspaceId: 'ws', workspaceRootPath: '/repo', provider: 'codex' })
    await waitFor(() => expect(nativeButton).toBeEnabled())
    fireEvent.click(nativeButton)
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', `/resume ${nativeId}`))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('imported'))
    expect(useThreadStore.getState().snapshot?.thread.nativeSessionId).toBe(nativeId)
    expect(f.api.send).not.toHaveBeenCalled()
  })
  it('renders a model selector inside the conversation, applies native effort and preserves an ordinary draft', async () => {
    const f = fixture()
    f.snapshot.thread.provider = 'codex'
    f.snapshot.events = [{ type: 'message', id: 'answer', role: 'assistant', text: 'Existing conversation' }, { type: 'model-picker', id: 'picker', models: [
      { id: 'native-model', label: 'Native model', description: 'A native catalog entry', efforts: ['low', 'high'], defaultEffort: 'low' }
    ] }]
    useThreadStore.getState().setDraft('thread', 'Preserve this draft')
    render(<ThreadView workspace={f.workspace} />)
    expect(screen.getByText('Existing conversation')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Select model' }))
    fireEvent.click(await screen.findByRole('button', { name: /Native model A native catalog entry/ }))
    await waitFor(() => expect(f.api.configure).toHaveBeenCalledWith('thread', { model: 'native-model', reasoningEffort: 'low' }, 0))
    fireEvent.click(screen.getByRole('button', { name: 'Select effort' }))
    fireEvent.click(await screen.findByRole('button', { name: 'High', exact: true }))
    await waitFor(() => expect(f.api.configure).toHaveBeenLastCalledWith('thread', { model: 'native-model', reasoningEffort: 'high' }, 1))
    expect(f.api.send).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Preserve this draft')
    expect(screen.queryByLabelText('Native CLI', { exact: true })).not.toBeInTheDocument()
  })
  it('keeps history and composer mounted for a legacy active CLI and offers return without showing the terminal', async () => {
    const f = fixture()
    f.snapshot.thread.cliActive = true
    f.snapshot.events = [{ type: 'message', id: 'answer', role: 'assistant', text: 'Existing conversation' }]
    render(<ThreadView workspace={f.workspace} />)
    expect(screen.getByText('Existing conversation')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recover conversation' })).toBeEnabled()
    expect(screen.queryByLabelText('Native CLI', { exact: true })).not.toBeInTheDocument()
    await waitFor(() => expect(window.oxe.agentAccount.read).toHaveBeenCalled())
  })
  it('gives native CLI aliases priority over local Thread actions', async () => {
    const f = fixture(), onNewThread = vi.fn()
    vi.mocked(f.api.commands).mockResolvedValue({ commands: [{ name: 'new', description: 'Clear native context', source: 'claude' }] })
    render(<ThreadView workspace={f.workspace} onNewThread={onNewThread} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '/new' } })
    await screen.findByRole('option', { name: /Clear native context/ })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', '/new', []))
    expect(onNewThread).not.toHaveBeenCalled()
  })
  it('filters slash commands, selects by keyboard without submitting, and sends arguments', async () => {
    const f = fixture(); render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '/oxe' } })
    await screen.findByRole('option', { name: /oxe-plan/ })
    expect(screen.queryByRole('option', { name: /compact/ })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('/oxe-plan ')
    expect(f.api.send).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '/oxe-plan Review auth' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', '/oxe-plan Review auth', []))
  })
  it('keeps drafts on Escape and leaves slash characters in ordinary messages alone', async () => {
    const f = fixture(); render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '/' } })
    await screen.findByRole('listbox', { name: 'Thread commands' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('/')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Review /api/login' } })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: '/', ctrlKey: true, altKey: true })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(f.api.send).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'Review /api/login', []))
  })
  it('runs local commands without sending model prompts, including stop during a turn', async () => {
    const f = fixture(), onNewThread = vi.fn(), onAccounts = vi.fn()
    f.snapshot.thread.status = 'running'
    render(<ThreadView workspace={f.workspace} onNewThread={onNewThread} onAccounts={onAccounts} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: '/stop' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f.api.interrupt).toHaveBeenCalledWith('thread'))
    await waitFor(() => expect(input).toHaveValue(''))
    fireEvent.change(input, { target: { value: '/accounts' } }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAccounts).toHaveBeenCalledOnce()
    fireEvent.change(input, { target: { value: '/new' } }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNewThread).not.toHaveBeenCalled()
    expect(input).toHaveValue('/new')
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', '/new', []))
  })
  it('handles arrows, Tab, Ctrl+/ and button selection without losing focus', async () => {
    const f = fixture(); render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    act(() => input.focus()); fireEvent.keyDown(input, { key: '/', ctrlKey: true })
    await screen.findByRole('option', { name: /oxe-plan/ })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const selected = screen.getAllByRole('option').find(option => option.getAttribute('aria-selected') === 'true')!
    expect(input).toHaveAttribute('aria-activedescendant', selected.id)
    fireEvent.change(input, { target: { value: '/comp' } })
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input).toHaveValue('/compact ')
    fireEvent.click(screen.getByRole('button', { name: 'Show thread commands' }))
    fireEvent.click(await screen.findByRole('option', { name: /oxe-plan/ }))
    expect(input).toHaveValue('/oxe-plan ')
    expect(f.api.send).not.toHaveBeenCalled()
  })
  it('keeps a failed auth-preflight draft and does not send automatically after connection', async () => {
    const f = fixture(), onAccounts = vi.fn()
    vi.mocked(f.api.send).mockRejectedValueOnce(Error('THREAD_AUTH_REQUIRED'))
    render(<ThreadView workspace={f.workspace} onAccounts={onAccounts} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'My unsent request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onAccounts).toHaveBeenCalledOnce())
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('My unsent request')
    act(() => useAccountStore.getState().changed({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 2 }))
    expect(f.api.send).toHaveBeenCalledOnce()
    expect(f.snapshot.events).toEqual([])
  })
  it('sends a message to the selected Claude thread', async () => {
    const f = fixture(); render(<ThreadView workspace={f.workspace} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Investigate auth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'Investigate auth', []))

  })
  it('shows structured history and interruption for a running thread', async () => {
    const f = fixture(); f.snapshot.thread.status = 'running'
    f.snapshot.events = [{ type: 'message', id: 'message', role: 'assistant', text: '**Verified** decision' }]
    render(<ThreadView workspace={f.workspace} />)

    await screen.findByText('Verified')
    fireEvent.click(screen.getByRole('button', { name: 'Stop turn' }))
    await waitFor(() => expect(f.api.interrupt).toHaveBeenCalledWith('thread'))
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  })
  it('locks the composer synchronously so repeated submit events cannot duplicate a turn', async () => {
    const f = fixture()
    let release!: () => void
    vi.mocked(f.api.send).mockImplementation(() => new Promise<void>(resolve => { release = resolve }))
    render(<ThreadView workspace={f.workspace} />)
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'Only once' } })
    const send = screen.getByRole('button', { name: 'Send' })
    fireEvent.click(send); fireEvent.click(send)
    expect(f.api.send).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(input).toHaveValue(''))
  })
  it('rewinds a Codex turn only after confirmation and restores its prompt to the composer', async () => {
    const f = fixture()
    f.snapshot.thread.provider = 'codex'
    f.snapshot.events = [{ type: 'message', id: 'turn-one', role: 'user', text: 'Original prompt' }, { type: 'message', id: 'answer', role: 'assistant', text: 'Answer' }, { type: 'completed', status: 'completed' }]
    f.api.command = vi.fn(async () => ({ kind: 'applied' }))
    render(<ThreadView workspace={f.workspace} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    await waitFor(() => expect(f.writeText).toHaveBeenCalledWith('Original prompt'))
    expect(screen.getByRole('button', { name: 'Message copied' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Edit and retry this message' }))
    expect(f.api.command).not.toHaveBeenCalled()
    expect(screen.getByText(/Project files are not reverted/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Rewind and edit' }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/rewind 1'))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Original prompt'))
  })
  it('shows the persisted reason for an interrupted turn', async () => {
    const f = fixture(); f.snapshot.thread.status = 'interrupted'
    f.snapshot.events = [{ type: 'message', id: 'user', role: 'user', text: 'Continue the audit' },
      { type: 'completed', status: 'interrupted', error: 'OXESpace restarted before this turn completed.' }]
    await act(async () => { render(<ThreadView workspace={f.workspace} />) })
    expect(await screen.findByText('OXESpace restarted before this turn completed.')).toBeVisible()
  })
  it('provides explicit authentication recovery and retry for legacy failed history', async () => {
    const f = fixture(); f.snapshot.thread.status = 'failed'
    f.snapshot.events = [{ type: 'message', id: 'user', role: 'user', text: 'oi' },
      { type: 'message', id: 'bad', role: 'assistant', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' },
      { type: 'completed', status: 'failed' }]
    render(<ThreadView workspace={f.workspace} />)

    await screen.findByText('Sign in to Claude Code')
    expect(screen.queryByText(/could not be refreshed/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'oi', []))
  })
  it('presents older imported messages without provider metadata and collapses long user prompts', async () => {
    const f = fixture()
    f.snapshot.events = [
      { type: 'message', id: 'native:metadata', role: 'user', text: '<environment_context><current_date>2026-09-24</current_date><root>private path</root></environment_context>' },
      { type: 'message', id: 'native:prompt', role: 'user', text: '<image name=[Image #1] path="C:\\private\\capture.png"> </image>\nAjuste o layout. ' + 'Detalhes adicionais. '.repeat(60) }
    ]
    render(<ThreadView workspace={f.workspace} />)
    expect(screen.queryByText(/private path/)).not.toBeInTheDocument()
    expect(screen.queryByText(/capture\.png/)).not.toBeInTheDocument()
    const expand = await screen.findByRole('button', { name: 'Show full message' })
    fireEvent.click(expand)
    expect(screen.getByText(/Image #1 attached/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })
  it('shows the provider label once for multiple assistant updates in one turn', async () => {
    const f = fixture()
    f.snapshot.events = [
      { type: 'message', id: 'question', role: 'user', text: 'Investigate this' },
      { type: 'message', id: 'update', role: 'assistant', text: 'I will check the code.' },
      { type: 'tool', id: 'search', name: 'Grep', state: 'completed', detail: 'rg -n issue' },
      { type: 'message', id: 'answer', role: 'assistant', text: 'Found the cause.' }
    ]
    render(<ThreadView workspace={f.workspace} />)
    await screen.findByText('Found the cause.')
    expect(document.querySelectorAll('.thread-agent-label')).toHaveLength(1)
  })
  it('groups and filters conversations without changing Code selection', async () => {
    const f = fixture()
    useWorkspaceStore.setState({ activeWorkspaceId: 'code-workspace' })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^(?:Unread conversation )?Auth investigation/ }))
    await waitFor(() => expect(f.api.read).toHaveBeenCalledWith('thread'))
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('code-workspace')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter threads' }), { target: { value: 'missing' } })
    expect(screen.getByText('No conversations found.')).toBeInTheDocument()
  })
  it('opens delegated work from the conversation header without sidebar task rows', async () => {
    const f = fixture(), onDelegations = vi.fn()
    render(<><ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} /><ThreadView workspace={f.workspace} onDelegations={onDelegations} /></>)
    expect(screen.queryByRole('button', { name: /Implement worktree fix/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delegated work' }))
    expect(onDelegations).toHaveBeenCalledOnce()
  })
  it('retains distinct drafts when selecting another thread', async () => {
    const f = fixture()
    useThreadStore.getState().setDraft('thread', 'first draft')
    useThreadStore.getState().setDraft('second', 'second draft')
    await useThreadStore.getState().select('second')
    expect(useThreadStore.getState().drafts).toEqual({ thread: 'first draft', second: 'second draft' })
    expect(f.api.read).toHaveBeenCalledWith('second')
  })

})
