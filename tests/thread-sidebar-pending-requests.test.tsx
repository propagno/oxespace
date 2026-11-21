import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../src/store/thread.store'
import { useUIStore } from '../src/store/ui.store'
import { i18n } from '../src/i18n'
import type { ConversationThread, ThreadApi, ThreadPendingRequestSummary, ThreadProjectSummary } from '../shared/types/thread'

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

const PROJECT: ThreadProjectSummary = {
  projectId: 'p1',
  displayName: 'Atlas',
  identityLabel: '/repos/p1',
  hidden: false,
  contexts: [{ rootPath: '/repos/p1', label: 'Atlas' }]
}

const makeThread = (id: string, title: string, status: ConversationThread['status'], createdAt: number): ConversationThread => ({
  id,
  workspaceId: 'thread:p1',
  projectId: 'p1',
  rootPath: '/repos/p1',
  provider: 'claude',
  title,
  pinned: false,
  status,
  nativeSessionId: null,
  createdAt,
  updatedAt: Date.now() - 60_000
} as ConversationThread)

const LATE_PERMISSION: ThreadPendingRequestSummary = {
  threadId: 't-wait',
  workspaceId: 'thread:p1',
  threadTitle: 'Run checks',
  requestId: 'req-1',
  kind: 'approval',
  title: 'Approve command',
  createdAt: 100,
  generation: 1,
  command: 'npm run typecheck',
  policy: { decision: 'ask', reasons: ['runs project script'], level: 'orange' },
  impact: { risk: 'low', reversible: true }
}

const CRITICAL_REQUEST: ThreadPendingRequestSummary = {
  threadId: 't-wait',
  workspaceId: 'thread:p1',
  threadTitle: 'Run checks',
  requestId: 'req-2',
  kind: 'approval',
  title: 'Safe command — approve now',
  createdAt: 200,
  generation: 2,
  command: 'rm -rf ./dist',
  policy: { decision: 'ask', reasons: ['deletes files'], risk: 'high', level: 'red' },
  impact: { risk: 'critical', reversible: false }
}

describe('OXE-290 ThreadSidebar pendingRequestsAll reactivity', () => {
  let pendingList: ThreadPendingRequestSummary[]
  let listeners: Array<(event: { threadId: string }) => void>
  let pendingRequestsAll: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    resetSectionsForTests()
    pendingList = []
    listeners = []
    const threads = [
      makeThread('t-wait', 'Run checks', 'approval', 200),
      makeThread('t-run', 'Stream output', 'running', 100)
    ]
    pendingRequestsAll = vi.fn(async () => [...pendingList])
    const api = {
      list: vi.fn(async () => threads),
      projects: vi.fn(async () => ({ projects: [PROJECT], unavailable: [] })),
      read: vi.fn(async (id: string) => ({ thread: threads.find(t => t.id === id)!, events: [] })),
      command: vi.fn(async () => undefined),
      onChanged: vi.fn((listener: (event: { threadId: string }) => void) => {
        listeners.push(listener)
        return () => { listeners = listeners.filter(fn => fn !== listener) }
      }),
      sections: vi.fn(async () => ({ sections: [], assignments: {} })),
      saveSections: vi.fn(async (_ws: string, state: unknown) => ({ ok: true, state })),
      pendingRequestsAll,
      respondPending: vi.fn(async () => ({ ok: true })),
      sessions: vi.fn(async () => []),
      onPlacesChanged: vi.fn(() => () => {})
    }
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
    useThreadStore.setState({
      threads,
      projects: [PROJECT],
      unavailableProjects: [],
      loading: false,
      listLoaded: true,
      selectedId: 't-wait',
      secondaryId: null,
      snapshot: null,
      snapshotCache: {},
      snapshotCacheOrder: [],
      errors: {},
      hiddenProjects: [],
      expanded: {},
      unreadIds: []
    } as never)
    useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('the row follows pendingRequestsAll changes', async () => {
    render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
    const aside = screen.getByRole('complementary', { name: tt('sidebar.region') })
    await waitFor(() => expect(pendingRequestsAll).toHaveBeenCalledTimes(1))
    expect(aside.querySelector('[data-ui="row-attention"]')).toBeNull()

    // Unrelated running thread changes must not trigger extra IPC reads.
    act(() => { for (const fn of listeners) fn({ threadId: 't-run' }) })
    expect(pendingRequestsAll).toHaveBeenCalledTimes(1)

    // A request arrives AFTER the thread is already in status === 'approval' (waitingKey unchanged).
    pendingList = [LATE_PERMISSION]
    act(() => { for (const fn of listeners) fn({ threadId: 't-wait' }) })

    await waitFor(() => {
      const card = aside.querySelector<HTMLElement>('[data-ui="row-attention"]')
      expect(card).not.toBeNull()
      expect(card).toHaveAttribute('data-kind', 'permission')
      expect(card).toHaveTextContent('npm run typecheck')
      const buttons = within(card!).getAllByRole('button')
      expect(buttons).toHaveLength(1)
      expect(buttons[0]).toHaveAttribute('data-ui', 'button')
      expect(buttons[0]).toHaveTextContent(tt('f7.card.allowOnce'))
    })
    // No raw <button> anywhere in the sidebar.
    expect(aside.querySelectorAll('button:not([data-ui])')).toHaveLength(0)

    // A critical request replaces it while still in status === 'approval': never offers Allow once, never uses agent text.
    pendingList = [CRITICAL_REQUEST]
    act(() => { for (const fn of listeners) fn({ threadId: 't-wait' }) })

    await waitFor(() => {
      const card = aside.querySelector<HTMLElement>('[data-ui="row-attention"]')
      expect(card).not.toBeNull()
      expect(card).toHaveAttribute('data-kind', 'critical')
      expect(card).toHaveTextContent(tt('request.highRisk'))
      expect(card).not.toHaveTextContent('Safe command')
      expect(within(card!).queryByRole('button', { name: tt('f7.card.allowOnce') })).toBeNull()
      expect(within(card!).getByRole('button', { name: tt('f7.card.seeImpact') })).toHaveAttribute('data-ui', 'button')
    })

    // Clearing pending requests removes the mini card immediately.
    pendingList = []
    act(() => { for (const fn of listeners) fn({ threadId: 't-wait' }) })
    await waitFor(() => expect(aside.querySelector('[data-ui="row-attention"]')).toBeNull())
  })
})
