import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../src/store/account.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { ThreadView } from '../../src/components/Threads/ThreadView'
import type { Workspace } from '../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../shared/types/thread'

const timelineEntryRenders = vi.fn()

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null })
}))

vi.mock('../../src/components/Threads/ThreadTimelineEntry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/Threads/ThreadTimelineEntry')>()
  return {
    ...actual,
    ThreadTimelineEntry: (props: Parameters<typeof actual.ThreadTimelineEntry>[0]) => {
      timelineEntryRenders(props.row.key)
      return actual.ThreadTimelineEntry(props)
    }
  }
})

function setupFixture() {
  const snapshot: ThreadSnapshot = {
    thread: {
      id: 'thread-perf',
      workspaceId: 'ws',
      projectId: 'project',
      rootPath: '/repo',
      provider: 'claude',
      title: 'Keystroke perf',
      pinned: false,
      status: 'idle',
      nativeSessionId: 'native-1',
      createdAt: 1,
      updatedAt: 1
    },
    events: [
      { type: 'message', id: 'u1', role: 'user', text: 'First prompt' },
      { type: 'message', id: 'a1', role: 'assistant', text: 'First response with prose.' },
      { type: 'completed', status: 'completed' },
      { type: 'message', id: 'u2', role: 'user', text: 'Second prompt' },
      { type: 'message', id: 'a2', role: 'assistant', text: 'Second response.' },
      { type: 'completed', status: 'completed' }
    ]
  }
  const api: ThreadApi = {
    commands: vi.fn(async () => ({ commands: [{ name: 'compact', description: 'Compact history', source: 'claude' as const }] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [snapshot.thread]),
    create: vi.fn(async () => snapshot),
    read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })),
    configure: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: api,
      clipboard: { writeText: vi.fn(async () => true) },
      agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) }
    }
  })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({
    threads: [snapshot.thread],
    projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot,
    selectedId: 'thread-perf',
    secondaryId: null,
    snapshotCache: {},
    snapshotCacheOrder: [],
    drafts: {},
    attachments: {},
    previewElements: {},
    errors: {},
    hiddenProjects: []
  })
  return { snapshot, api, workspace }
}

afterEach(() => {
  cleanup()
  timelineEntryRenders.mockClear()
  vi.restoreAllMocks()
})

describe('OXE-348 · ThreadView composer keystroke isolation', () => {
  it('does not re-render message timeline rows or force timeline scrollHeight reflows while typing in the composer', async () => {
    const f = setupFixture()
    const { container } = render(<ThreadView workspace={f.workspace} />)

    // Wait for initial mount effects (account read, command catalog load) to settle.
    await waitFor(() => expect(f.api.commands).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })

    expect(timelineEntryRenders).toHaveBeenCalled()
    timelineEntryRenders.mockClear()

    const timelineEl = container.querySelector<HTMLElement>('.thread-timeline')!
    expect(timelineEl).toBeTruthy()
    const scrollHeightSpy = vi.fn(() => 1200)
    Object.defineProperty(timelineEl, 'scrollHeight', { configurable: true, get: scrollHeightSpy })

    const input = screen.getByRole('textbox', { name: 'Message' })
    act(() => { input.focus() })

    for (const value of ['H', 'He', 'Hel', 'Hell', 'Hello', 'Hello world', 'Hello world\nLine 2']) {
      fireEvent.change(input, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
      fireEvent.select(input, { target: { selectionStart: value.length, selectionEnd: value.length } })
    }

    expect(input).toHaveValue('Hello world\nLine 2')
    expect(timelineEntryRenders, 'typing in composer must never re-render timeline message rows').not.toHaveBeenCalled()
    expect(scrollHeightSpy, 'typing in composer must not trigger synchronous timeline scrollHeight reads').not.toHaveBeenCalled()

    // Submitting still reads the live draft from the composer/store and dispatches send.
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread-perf', 'Hello world\nLine 2', []))
  })
})
