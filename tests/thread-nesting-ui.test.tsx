import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadChildrenSummary, ThreadCommandResult } from '../shared/types/thread'
import { threadArchiveWithChildren } from '../shared/threadConfirmations'
import { childCounts, MAX_NESTING_DEPTH, nestConversations, nestingDepth } from '../src/components/Threads/threadNesting'
import { ThreadChildren } from '../src/components/Threads/ThreadChildren'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { resetSectionsMockForTests } from '../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../src/store/thread.store'

const base: ConversationThread = { id: 'a', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Plan', pinned: false, status: 'idle', nativeSessionId: 's', createdAt: 9, updatedAt: 9 }
const child = (id: string, parent: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({ ...base, id, title: id, parent: { threadId: parent, via: 'thread_create' }, ...extra })

beforeEach(() => { localStorage.clear(); resetSectionsMockForTests() })
afterEach(() => { cleanup() })

describe('nesting', () => {
  it('puts each conversation right after the one that started it, and keeps orphans where they were', () => {
    const list = [base, { ...base, id: 'b', title: 'Other' }, child('a1', 'a'), child('a1x', 'a1'), child('lost', 'gone')]
    expect(nestConversations(list).map(item => item.id)).toEqual(['a', 'a1', 'a1x', 'b', 'lost'])
  })
  it('never loses a conversation in a cycle', () => {
    const list = [child('x', 'y'), child('y', 'x')]
    expect(nestConversations(list).map(item => item.id).sort()).toEqual(['x', 'y'])
  })
  it('measures depth up to the cap, and stops at a cycle', () => {
    const chain = [base, child('d1', 'a'), child('d2', 'd1'), child('d3', 'd2'), child('d4', 'd3')]
    const byId = new Map(chain.map(item => [item.id, item]))
    expect(chain.map(item => nestingDepth(item, byId))).toEqual([0, 1, 2, 3, MAX_NESTING_DEPTH])
    const loop = [child('x', 'y'), child('y', 'x')]
    expect(nestingDepth(loop[0], new Map(loop.map(item => [item.id, item])))).toBeLessThanOrEqual(MAX_NESTING_DEPTH)
  })
  it('counts the children still listed, by what they do', () => {
    const threads = [base, child('w', 'a', { status: 'running' }), child('q', 'a', { status: 'approval' }), child('f', 'a', { status: 'failed' }), child('old', 'a', { archived: true })]
    expect(childCounts('a', threads)).toEqual({ total: 3, working: 1, waiting: 1, failed: 1 })
  })
})

describe('the sidebar shows the tree', () => {
  it('a child is indented under its parent, and the parent says what its children do', async () => {
    const threads = [base, { ...base, id: 'b', title: 'Other', createdAt: 8 }, child('Fix tests', 'a', { createdAt: 7, status: 'approval' })]
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { list: vi.fn(async () => threads), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), onChanged: vi.fn(() => () => {}) } } })
    useThreadStore.setState({ threads, projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], selectedId: null, secondaryId: null, errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] })
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await waitFor(() => expect([...document.querySelectorAll('.thread-session-title')].map(node => node.textContent)).toEqual(['Plan', 'Fix tests', 'Other']))
    const rows = [...document.querySelectorAll<HTMLElement>('.thread-navigation-row')]
    expect(rows[1].dataset.depth).toBe('1')
    expect(rows[0].dataset.depth).toBeUndefined()
    expect(within(rows[0]).getByTestId('thread-started-count')).toHaveTextContent('1')
    expect(rows[0]).toHaveTextContent('Started 1 conversation: 0 working, 1 waiting for you, 0 failed')
  })
})

describe('the conversations it started', () => {
  const summary: ThreadChildrenSummary = { threadId: 'a', aggregate: { running: 1, approval: 0, failed: 0, done: 1 }, children: [
    { id: 'c1', title: 'Write tests', status: 'running', via: 'thread_create', archived: false, updatedAt: 1 },
    { id: 'c2', title: '', status: 'idle', via: 'work', archived: true, updatedAt: 1 }
  ] }
  it('lists them from main with their state, and opens one here or beside this one', async () => {
    const user = userEvent.setup()
    const children = vi.fn(async () => summary)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { children } } })
    const select = vi.fn(async () => undefined), openSecondary = vi.fn(async () => undefined)
    useThreadStore.setState({ threads: [base, child('c1', 'a', { status: 'running' })], select, openSecondary } as never)
    render(<ThreadChildren thread={base} />)
    const button = screen.getByTestId('thread-children-button')
    expect(button).toHaveAccessibleName('Started 1 conversation: 1 working, 0 waiting for you')
    await user.click(button)
    const list = await screen.findByTestId('thread-children-list')
    expect(children).toHaveBeenCalledWith('a')
    expect(list).toHaveTextContent('Write tests')
    // An unnamed child reads "New conversation"; an archived one says so.
    expect(list).toHaveTextContent('New conversationArchived')
    await user.click(within(list).getByRole('button', { name: 'Open Write tests beside this one' }))
    expect(openSecondary).toHaveBeenCalledWith('c1')
    await user.click(button)
    await user.click((await screen.findAllByTestId('thread-child-open'))[0])
    expect(select).toHaveBeenCalledWith('c1')
  })
  it('is not there when the conversation started none', () => {
    useThreadStore.setState({ threads: [base] })
    const { container } = render(<ThreadChildren thread={base} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('archiving a conversation whose children still work', () => {
  it('main asks again: the archive is undone, the question names them, and confirming takes them along', async () => {
    const results: ThreadCommandResult[] = [
      { kind: 'confirm', refusal: 'hasActiveChildren', confirm: threadArchiveWithChildren({ active: 2, total: 3 }, 'Plan') },
      { kind: 'applied' }
    ]
    const command = vi.fn(async () => results.shift()!)
    const threads = [base]
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { command, list: vi.fn(async () => threads), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), onChanged: vi.fn(() => () => {}) } } })
    useThreadStore.setState({ threads, projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], selectedId: null, secondaryId: null, errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] })
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Actions for Plan' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive conversation' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive conversation' }))
    const again = await screen.findByRole('dialog', { name: 'Archive this conversation and the ones it started?' })
    expect(again).toHaveTextContent('2 conversations that “Plan” started are still working')
    expect(command).toHaveBeenNthCalledWith(1, 'a', '/archive confirm')
    // Undone while main asks.
    expect(useThreadStore.getState().threads[0].archived).toBeFalsy()
    fireEvent.click(within(again).getByRole('button', { name: 'Archive all' }))
    await waitFor(() => expect(command).toHaveBeenNthCalledWith(2, 'a', '/archive confirm-with-children'))
  })
})
