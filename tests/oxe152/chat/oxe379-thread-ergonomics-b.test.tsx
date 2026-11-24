import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ConversationThread, ThreadProjectSummary, ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { compactModelLabel } from '../../../src/components/Threads/threadModelName'
import { ThreadConfigurationBar } from '../../../src/components/Threads/ThreadConfigurationBar'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useViewSwitch } from '../../../src/app/viewSwitch'
import { changeLanguage } from '../../../src/i18n'

function makeThread(over: Partial<ConversationThread> & { id: string; projectId: string; rootPath: string }): ConversationThread {
  return {
    workspaceId: `ws:${over.projectId}`,
    provider: 'claude',
    title: over.id,
    pinned: false,
    status: 'idle',
    nativeSessionId: null,
    createdAt: 100,
    updatedAt: 100,
    access: 'workspace-write',
    mode: 'default',
    ...over
  }
}

function makeProject(projectId: string, displayName: string, rootPath: string): ThreadProjectSummary {
  return {
    projectId,
    displayName,
    identityLabel: rootPath,
    hidden: false,
    contexts: [{ rootPath, label: displayName }]
  }
}

function makeWorkspace(id: string, name: string, rootPath: string): Workspace {
  return {
    id,
    name,
    rootPath,
    layout: '1x1',
    layoutPreset: 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: '',
    autoStart: false,
    isActive: true,
    color: null,
    panes: []
  }
}

function makeSnapshot(thread: ConversationThread): ThreadSnapshot {
  return { thread, events: [] }
}

beforeEach(() => {
  localStorage.clear()
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null, isLoading: false, error: null })
  useThreadStore.setState({
    threads: [],
    projects: [],
    projectsState: 'loaded',
    unavailableProjects: [],
    selectedId: null,
    snapshot: null,
    secondaryId: null,
    activeCell: 'primary',
    snapshotCache: {},
    snapshotCacheOrder: [],
    drafts: {},
    attachments: {},
    previewElements: {},
    scrollPositions: {},
    expanded: {},
    errors: {},
    loading: false,
    listLoaded: true,
    hiddenProjects: [],
    unreadIds: [],
    syncedCodeRootPath: null,
    pendingCodeRootPath: null,
    syncedProjectId: null
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-379 Part B · readable compact model label in narrow composer', () => {
  test('compactModelLabel strips redundant vendor prefixes and parentheticals while keeping model identity', () => {
    expect(compactModelLabel('Claude Sonnet 4.6')).toBe('Sonnet 4.6')
    expect(compactModelLabel('Claude Opus 5.5')).toBe('Opus 5.5')
    expect(compactModelLabel('Claude Haiku 4.5')).toBe('Haiku 4.5')
    expect(compactModelLabel('Claude 3.5 Sonnet')).toBe('Sonnet 3.5')
    expect(compactModelLabel('Claude 3.7 Sonnet (Extended)')).toBe('Sonnet 3.7')
    expect(compactModelLabel('Anthropic Claude Sonnet 4.6 (1M context)')).toBe('Sonnet 4.6')
    expect(compactModelLabel('OpenAI GPT-5')).toBe('GPT-5')
    expect(compactModelLabel('GPT-5')).toBe('GPT-5')
    expect(compactModelLabel('GPT-5.1 Codex')).toBe('GPT-5.1 Codex')
    expect(compactModelLabel('Google Gemini 2.5 Pro')).toBe('Gemini 2.5 Pro')
    expect(compactModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(compactModelLabel('Native model')).toBe('Native model')
    expect(compactModelLabel('Claude')).toBe('Claude')
  })

  test('narrow ThreadConfigurationBar displays compact model name and preserves full name in title tooltip', async () => {
    const thread = makeThread({ id: 't-narrow', projectId: 'p1', rootPath: '/repo', model: 'claude-sonnet-4-6' })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'win32' },
        thread: {
          models: vi.fn(async () => ({
            defaultModel: 'claude-sonnet-4-6',
            models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Fast', efforts: ['low', 'high'], defaultEffort: 'low' }]
          })),
          configure: vi.fn(async () => makeSnapshot(thread))
        }
      }
    })

    render(
      <ThreadConfigurationBar
        thread={thread}
        narrow
        onConfigured={vi.fn()}
        onError={vi.fn()}
        openControl={null}
        onControlClosed={vi.fn()}
      />
    )

    const trigger = await screen.findByRole('button', { name: 'Turn settings' })
    expect(trigger.textContent).toContain('Sonnet 4.6')
    expect(trigger.textContent).not.toContain('Claude Sonnet 4.6')
    expect(trigger.getAttribute('title')).toContain('Claude Sonnet 4.6')
  })

  test('compact (medium width) ThreadConfigurationBar displays compact model name and keeps full name in aria-label and title', async () => {
    const thread = makeThread({ id: 't-compact', projectId: 'p1', rootPath: '/repo', model: 'claude-opus-5-5' })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'win32' },
        thread: {
          models: vi.fn(async () => ({
            defaultModel: 'claude-opus-5-5',
            models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Deep', efforts: ['low', 'high'], defaultEffort: 'high' }]
          })),
          configure: vi.fn(async () => makeSnapshot(thread))
        }
      }
    })

    render(
      <ThreadConfigurationBar
        thread={thread}
        narrow={false}
        compact
        onConfigured={vi.fn()}
        onError={vi.fn()}
        openControl={null}
        onControlClosed={vi.fn()}
      />
    )

    const trigger = await screen.findByRole('button', { name: /Model: Claude Opus 5\.5/ })
    expect(trigger.textContent).toContain('Opus 5.5')
    expect(trigger.textContent).not.toContain('Claude Opus 5.5')
    expect(trigger.getAttribute('title')).toBe('Model: Claude Opus 5.5')
  })
})

describe('OXE-379 Part B · synchronize active project OxeCode -> OxeChat', () => {
  test('syncActiveCodeWorkspace selects the matching project thread, expands the project, and does not override explicit chat choice on repeat visit', async () => {
    const threadA = makeThread({ id: 't-a', projectId: 'proj-a', rootPath: 'C:\\repos\\alpha', updatedAt: 200 })
    const threadB = makeThread({ id: 't-b', projectId: 'proj-b', rootPath: 'C:\\repos\\beta', updatedAt: 150 })
    const projects = [
      makeProject('proj-a', 'Alpha', 'C:\\repos\\alpha'),
      makeProject('proj-b', 'Beta', 'C:\\repos\\beta')
    ]
    const snapshots: Record<string, ThreadSnapshot> = { 't-a': makeSnapshot(threadA), 't-b': makeSnapshot(threadB) }
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'win32' },
        thread: { read: vi.fn(async (id: string) => snapshots[id]) }
      }
    })

    useThreadStore.setState({
      threads: [threadA, threadB],
      projects,
      selectedId: 't-a',
      snapshot: snapshots['t-a'],
      expanded: { 'proj-a': true, 'proj-b': false },
      listLoaded: true
    })

    // Switching from OxeCode on Beta syncs OxeChat to Beta (case-insensitive on win32)
    const synced = await useThreadStore.getState().syncActiveCodeWorkspace('c:/repos/beta/', 'win32')
    expect(synced).toBe(true)
    expect(useThreadStore.getState().selectedId).toBe('t-b')
    expect(useThreadStore.getState().expanded['proj-b']).toBe(true)
    expect(useThreadStore.getState().syncedProjectId).toBe('proj-b')

    // User explicitly picks a thread in Alpha while in OxeChat
    await useThreadStore.getState().select('t-a')
    expect(useThreadStore.getState().selectedId).toBe('t-a')
    expect(useThreadStore.getState().syncedProjectId).toBeNull()

    // Returning to OxeChat while OxeCode is STILL on Beta keeps the explicit Alpha selection
    const repeated = await useThreadStore.getState().syncActiveCodeWorkspace('C:\\repos\\beta', 'win32')
    expect(repeated).toBe(false)
    expect(useThreadStore.getState().selectedId).toBe('t-a')
  })

  test('load() applies pendingCodeRootPath from cold OxeCode -> OxeChat switch before falling back to visible[0]', async () => {
    const threadA = makeThread({ id: 't-a', projectId: 'proj-a', rootPath: '/repos/alpha', updatedAt: 500 })
    const threadB = makeThread({ id: 't-b', projectId: 'proj-b', rootPath: '/repos/beta', updatedAt: 200 })
    const projects = [
      makeProject('proj-a', 'Alpha', '/repos/alpha'),
      makeProject('proj-b', 'Beta', '/repos/beta')
    ]
    const snapshots: Record<string, ThreadSnapshot> = { 't-a': makeSnapshot(threadA), 't-b': makeSnapshot(threadB) }
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'linux' },
        thread: {
          list: vi.fn(async () => [threadA, threadB]),
          read: vi.fn(async (id: string) => snapshots[id])
        }
      }
    })

    useThreadStore.setState({ listLoaded: false, threads: [], projects: [], selectedId: null, snapshot: null })
    // Switch arrives before thread catalog has loaded
    await useThreadStore.getState().syncActiveCodeWorkspace('/repos/beta', 'linux')
    expect(useThreadStore.getState().pendingCodeRootPath).toBe('/repos/beta')

    // Catalog loads: picks Beta instead of Alpha (even though Alpha has newer updatedAt)
    useThreadStore.setState({ projects })
    await useThreadStore.getState().load()
    expect(useThreadStore.getState().selectedId).toBe('t-b')
    expect(useThreadStore.getState().pendingCodeRootPath).toBeNull()
    expect(useThreadStore.getState().syncedProjectId).toBe('proj-b')
  })

  test('ThreadSidebar "+ New conversation" defaults to the synced OxeCode project when that project has no threads yet', async () => {
    const threadA = makeThread({ id: 't-a', projectId: 'proj-a', rootPath: '/repos/alpha', updatedAt: 200 })
    const projects = [
      makeProject('proj-a', 'Alpha', '/repos/alpha'),
      makeProject('proj-b', 'Beta', '/repos/beta')
    ]
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'linux' },
        thread: {
          read: vi.fn(async () => makeSnapshot(threadA)),
          onChanged: vi.fn(() => () => {}),
          onPlacesChanged: vi.fn(() => () => {}),
          sessions: vi.fn(async () => [])
        }
      }
    })

    useWorkspaceStore.setState({
      workspaces: [makeWorkspace('ws-a', 'Alpha', '/repos/alpha'), makeWorkspace('ws-b', 'Beta', '/repos/beta')],
      activeWorkspaceId: 'ws-b'
    })
    useThreadStore.setState({
      threads: [threadA],
      projects,
      selectedId: 't-a',
      snapshot: makeSnapshot(threadA),
      listLoaded: true
    })

    await useThreadStore.getState().syncActiveCodeWorkspace('/repos/beta', 'linux')
    const onCreate = vi.fn()
    render(<ThreadSidebar onCreate={onCreate} />)

    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(onCreate).toHaveBeenCalledWith('proj-b', '/repos/beta')
  })

  test('useViewSwitch triggers OxeCode -> OxeChat workspace sync when switching from code to thread', async () => {
    vi.useFakeTimers()
    try {
      const threadA = makeThread({ id: 't-a', projectId: 'proj-a', rootPath: '/repos/alpha', updatedAt: 200 })
      const threadB = makeThread({ id: 't-b', projectId: 'proj-b', rootPath: '/repos/beta', updatedAt: 150 })
      const projects = [
        makeProject('proj-a', 'Alpha', '/repos/alpha'),
        makeProject('proj-b', 'Beta', '/repos/beta')
      ]
      const snapshots: Record<string, ThreadSnapshot> = { 't-a': makeSnapshot(threadA), 't-b': makeSnapshot(threadB) }
      Object.defineProperty(window, 'oxe', {
        configurable: true,
        value: {
          app: { platform: 'linux' },
          thread: { read: vi.fn(async (id: string) => snapshots[id]) }
        }
      })
      useWorkspaceStore.setState({
        workspaces: [makeWorkspace('ws-b', 'Beta', '/repos/beta')],
        activeWorkspaceId: 'ws-b'
      })
      useThreadStore.setState({
        threads: [threadA, threadB],
        projects,
        selectedId: 't-a',
        snapshot: snapshots['t-a'],
        listLoaded: true
      })

      const commit = vi.fn()
      let selectView: ((view: 'code' | 'thread' | 'data') => void) | null = null
      function Harness() {
        const sw = useViewSwitch('code', commit)
        selectView = sw.select
        return null
      }
      render(<Harness />)

      act(() => { selectView!('thread') })
      await act(async () => { vi.advanceTimersByTime(350) })

      expect(commit).toHaveBeenCalledWith('thread')
      expect(useThreadStore.getState().selectedId).toBe('t-b')
      expect(useThreadStore.getState().syncedProjectId).toBe('proj-b')
    } finally {
      vi.useRealTimers()
    }
  })
})
