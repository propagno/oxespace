import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  const api: ThreadApi = { commands: vi.fn(async () => ({ commands: [{ name: 'oxe-plan', description: 'Plan a change', source: 'claude' as const }, { name: 'compact', description: 'Compact history', source: 'claude' as const }] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'A native catalog entry', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async (_id, configuration, revision) => { Object.assign(snapshot.thread, configuration, { configurationRevision: revision + 1 }); return { ...snapshot, thread: { ...snapshot.thread } } }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], snapshot, selectedId: 'thread', drafts: {}, errors: {}, hiddenProjects: [] })
  return { snapshot, api, workspace }
}

describe('Thread workspace UI', () => {
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
  it('creates a thread in the project context and requires confirmation before deleting a conversation', async () => {
    const f = fixture(), onCreate = vi.fn()
    f.api.command = vi.fn(async () => ({ kind: 'navigate' }))
    vi.mocked(f.api.list).mockResolvedValue([])
    useThreadStore.setState({ projects: [] })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: 'New thread in Repo' }))
    expect(onCreate).toHaveBeenCalledWith('ws', '/repo')
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread Auth investigation' }))
    expect(f.api.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    expect(f.api.command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread Auth investigation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread', exact: true }))
    await waitFor(() => expect(f.api.command).toHaveBeenCalledWith('thread', '/delete confirm'))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBeNull())
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
    expect(input).toHaveValue('/new ')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', '/new ', []))
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
  it('groups and filters conversations without changing Code selection', async () => {
    const f = fixture()
    useWorkspaceStore.setState({ activeWorkspaceId: 'code-workspace' })
    render(<ThreadSidebar workspaces={[f.workspace]} onCreate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Auth investigation/ }))
    await waitFor(() => expect(f.api.read).toHaveBeenCalledWith('thread'))
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('code-workspace')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter threads' }), { target: { value: 'missing' } })
    expect(screen.getByText('No conversations found.')).toBeInTheDocument()
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
