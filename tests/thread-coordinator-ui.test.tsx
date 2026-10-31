import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadPendingRequestSummary } from '../shared/types/thread'
import { ThreadCoordinatorOverview } from '../src/components/Threads/ThreadCoordinatorOverview'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { resetSectionsMockForTests } from '../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../src/store/thread.store'

const base: ConversationThread = { id: 'a', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Plan', pinned: false, status: 'idle', nativeSessionId: 's', createdAt: 9, updatedAt: 9 }
const thread = (id: string, title: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({ ...base, id, title, ...extra })
const PROJECT = [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }]

function setup(threads: ConversationThread[], setCoordinator = vi.fn(async (id: string, on: boolean) => {
  // Main keeps one per project, as the store shows it.
  const target = threads.find(item => item.id === id)!
  for (const item of threads) if (item.projectId === target.projectId) item.coordinator = item.id === id && on ? true : undefined
})) {
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: {
    setCoordinator, read: vi.fn(async (id: string) => ({ thread: threads.find(item => item.id === id), events: [] })),
    list: vi.fn(async () => threads), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), onChanged: vi.fn(() => () => {})
  } } })
  useThreadStore.setState({ threads, projects: PROJECT, selectedId: null, secondaryId: null, errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] })
  return setCoordinator
}
const titles = () => [...document.querySelectorAll('.thread-session-title')].map(node => node.textContent)

beforeEach(() => { localStorage.clear(); resetSectionsMockForTests() })
afterEach(() => { cleanup() })

describe('the project coordinator in the list', () => {
  it('making one asks first, saying what it can and cannot do, then pins it at the top with a badge', async () => {
    const setCoordinator = setup([thread('a', 'Plan'), thread('b', 'Lead', { createdAt: 1 })])
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect(titles()).toEqual(['Plan', 'Lead']))
    await user.click(screen.getByRole('button', { name: 'Actions for Lead' }))
    await user.click(screen.getByRole('menuitem', { name: 'Make it the coordinator…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Make “Lead” the coordinator of this project?' })
    expect(dialog).toHaveTextContent('never answers a request or an approval')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.click(within(dialog).getByRole('button', { name: 'Make coordinator' }))
    expect(setCoordinator).toHaveBeenCalledWith('b', true)
    const pinned = await screen.findByTestId('thread-coordinator-row')
    expect(pinned).toHaveTextContent('Lead')
    expect(pinned).toHaveTextContent('Coordinator')
    expect(titles()).toEqual(['Lead', 'Plan'])
  })

  it('a new coordinator replaces the previous one, and the question says so', async () => {
    setup([thread('a', 'Old lead', { coordinator: true }), thread('b', 'New lead', { createdAt: 1 })])
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for New lead' }))
    await user.click(screen.getByRole('menuitem', { name: 'Make it the coordinator…' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('“Old lead” stops being the coordinator.')
    await user.click(within(dialog).getByRole('button', { name: 'Make coordinator' }))
    await waitFor(() => expect(useThreadStore.getState().threads.filter(item => item.coordinator).map(item => item.id)).toEqual(['b']))
  })

  it('stopping needs no question; a failed save puts the previous coordinator back', async () => {
    const setCoordinator = setup([thread('a', 'Lead', { coordinator: true })], vi.fn(async () => { throw new Error('db locked') }))
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Lead' }))
    await user.click(screen.getByRole('menuitem', { name: 'Stop being the coordinator' }))
    expect(setCoordinator).toHaveBeenCalledWith('a', false)
    await waitFor(() => expect(useThreadStore.getState().threads[0].coordinator).toBe(true))
  })
})

describe('the coordinator\'s overview', () => {
  it('lists the other conversations of the project, waiting ones first with their requests, and opens one', async () => {
    const lead = thread('lead', 'Lead', { coordinator: true })
    const threads = [lead, thread('w', 'Needs you', { status: 'approval' }), thread('r', 'Runs', { status: 'running' }), thread('q', 'Has a request'), thread('i', 'Idle one'),
      thread('x', 'Other project', { projectId: 'other' }), thread('z', 'Archived', { archived: true })]
    const pending: ThreadPendingRequestSummary[] = [{ threadId: 'q', workspaceId: '', threadTitle: 'Has a request', requestId: 'r1', kind: 'approval', title: 'Run npm test', createdAt: 1 },
      { threadId: 'q', workspaceId: '', threadTitle: 'Has a request', requestId: 'r2', kind: 'approval', title: 'Edit README', createdAt: 2 }]
    const select = vi.fn(async () => undefined)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { pendingRequestsAll: vi.fn(async () => pending) } } })
    useThreadStore.setState({ threads, select } as never)
    const user = userEvent.setup()
    render(<ThreadCoordinatorOverview thread={lead} />)
    // Before the requests are read, the list's own state already says one waits.
    expect(screen.getByTestId('thread-coordinator-overview')).toHaveAccessibleName('Project overview: 4 other conversations, 1 waiting for you')
    await user.click(screen.getByTestId('thread-coordinator-overview'))
    const waiting = await screen.findByTestId('thread-coordinator-waiting')
    await waitFor(() => expect(within(waiting).getAllByRole('listitem').map(item => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Needs you'), expect.stringContaining('Has a request2 requests')])))
    expect(screen.getByTestId('thread-coordinator-working')).toHaveTextContent('Runs')
    expect(screen.getByTestId('thread-coordinator-rest')).toHaveTextContent('Idle one')
    expect(document.body).not.toHaveTextContent('Other project')
    expect(document.body).not.toHaveTextContent('Archived')
    await user.click(within(waiting).getByRole('button', { name: /^(?!Open ).*Needs you/ }))
    expect(select).toHaveBeenCalledWith('w')
  })

  it('is only on the coordinator', () => {
    useThreadStore.setState({ threads: [base] })
    const { container } = render(<ThreadCoordinatorOverview thread={base} />)
    expect(container).toBeEmptyDOMElement()
  })
})
