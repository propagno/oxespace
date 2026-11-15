// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-170, OXC-5 UI).
// Written by the planner; the executor must not edit it. Source: the written target v2 approved by the user on 15/11
// (oxechat-final-target.md, OXC-5, canvas boards 5 and 6) on top of OxeChat F3 (OXE-170 backend: parallel chats are
// conversations with parentThreadId = the session's main conversation, created by window.oxe.thread.createChat, and the
// session view window.oxe.thread.sessions sums their changes), the user's rule "mesmo padrão, tudo tem que sair como foi
// projetado na interface" and the coordinator's binding of 15/11.
// Today (main 21704086d) the sidebar knows no parent and child, and nothing creates a parallel chat.
// Contract (pixels and the guide line are the conformance scene's and marca/fidelidade's; this file pins structure,
// words and behaviour):
// - Sidebar: the children of a conversation (threads whose parentThreadId is its id) are one-line rows,
//   [data-ui=sidebar-row][data-lines="1"], right under their parent's row, in the order the session lists them, before
//   the next conversation; a child is never listed again as a conversation of its own. The parent's line 2
//   ([data-ui=row-meta]) shows the session's sum of +N and −N. A child that waits shows the mini card
//   ([data-ui=row-attention], OXC-1) on its own row, never on its parent's.
// - Create: a parent row offers "Nova conversa paralela" (thread:sidebar.newParallel) as its "+" IconButton and in its
//   ⋯ menu; both call ThreadSidebar's onCreateParallel(parentId); a child row offers neither (chats do not nest); no
//   keyboard shortcut is shown (none is confirmed free).
// - Screen: NewConversationScreen({ projectId, parentThreadId }) (OXC-3's module) headed by thread:parallel.title with the
//   parent's title; the project picker is locked on the parent's project, the worktree shows thread:parallel.locked
//   (the child never owns it), the agent stays choosable; the info notice thread:parallel.notice; the first message calls
//   window.oxe.thread.createChat(parentId, { provider }) and then sends the text to the new chat, never thread.create.
// - New strings in en and pt-BR: sidebar.newParallel, parallel.title, parallel.notice, parallel.locked.
// - Brand 15/11: the chat-conversation scene seeds no child, so this card extends the e2e fixture: e2e/helpers/
//   thread-fixtures.ts installs one child ConversationThread whose parentThreadId is the conversation openThreadWithState
//   opens (one single-line child row in the brand scene and the visual baselines; SOURCE-TEXT check, marked), and then
//   BRD-02.row1.height is enforced and in enforced.lock.json.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewConversationScreen } from '../../../src/components/Threads/NewConversationScreen'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const flat = (value: unknown, prefix = ''): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
  typeof item === 'string' ? { [prefix + key]: item } : flat(item, `${prefix}${key}.`)))
const catalog = (locale: string): Record<string, string> => flat(JSON.parse(readFileSync(join(ROOT, `shared/locales/${locale}/thread.json`), 'utf8')))
function notEnforced(ids: readonly string[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05'].flatMap(name => (JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}

const project = (projectId: string, displayName: string): ThreadProjectSummary => ({ projectId, displayName, identityLabel: `/repos/${projectId}`, hidden: false, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }] })
const WORKTREE = '/repos/p1-worktrees/fix-login'
const conversation = (id: string, title: string, extra: Partial<ConversationThread> & { parentThreadId?: string } = {}): ConversationThread => ({
  id, workspaceId: 'thread:p1', projectId: 'p1', rootPath: WORKTREE, provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 120_000, ...extra
} as ConversationThread)
const THREADS = [
  conversation('a', 'Fix the login bug', { createdAt: 60, ownedWorktree: { path: WORKTREE, branch: 'fix/login', projectRoot: '/repos/p1', baseSha: '0'.repeat(40), createdAt: 1 } }),
  conversation('a1', 'Try the cookie route', { parentThreadId: 'a', provider: 'codex', createdAt: 61 }),
  conversation('a2', 'Write the migration', { parentThreadId: 'a', status: 'approval', createdAt: 62 }),
  conversation('b', 'Tune the query', { createdAt: 50, rootPath: '/repos/p1' })
]
const chat = (id: string, provider: string, main: boolean, additions: number, deletions: number) => ({ id, provider, main, status: 'idle', changes: { additions, deletions } })
const SESSIONS = [
  { id: 'a', rootPath: WORKTREE, chats: [chat('a', 'claude', true, 2, 1), chat('a1', 'codex', false, 5, 3), chat('a2', 'claude', false, 2, 0)], openChatId: 'a', archived: false, changes: { additions: 9, deletions: 4 } },
  { id: 'b', rootPath: '/repos/p1', chats: [chat('b', 'claude', true, 0, 0)], openChatId: 'b', archived: false, changes: { additions: 0, deletions: 0 } }
]
const PENDING = [{ threadId: 'a2', workspaceId: 'thread:p1', threadTitle: 'Write the migration', requestId: 'r-a2', kind: 'approval', title: 'Claude wants to run a command', createdAt: 1, generation: 2, command: 'npm run migrate', impact: { risk: 'medium', reversible: true, kind: 'command' } }]

let api: Record<string, ReturnType<typeof vi.fn>>
function fixture() {
  const created = { thread: conversation('a3', '', { parentThreadId: 'a' }), events: [] }
  api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: [project('p1', 'Atlas')], unavailable: [] })), read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id) ?? created.thread, events: [] })),
    command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}), sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn(async (_id: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => PENDING), respondPending: vi.fn(async () => ({ ok: true })), sessions: vi.fn(async () => SESSIONS),
    session: vi.fn(async (id: string) => SESSIONS.find(item => item.id === id)), createChat: vi.fn(async () => created), create: vi.fn(async () => created), send: vi.fn(async () => {}),
    models: vi.fn(async () => ({ defaultModel: 'm', models: [] })), commands: vi.fn(async () => ({ commands: [] })), newConversationAccess: vi.fn(async () => 'full-access')
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  useThreadStore.setState({ threads: THREADS, projects: [project('p1', 'Atlas')], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'b', secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
}
const aside = (): HTMLElement => screen.getByRole('complementary', { name: tt('sidebar.region') })
const rows = (): HTMLElement[] => [...aside().querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
const rowOf = (title: string): HTMLElement => {
  const found = rows().filter(row => (row.querySelector('[data-ui="row-title"]')?.textContent ?? row.textContent ?? '').includes(title))
  expect(found, `one sidebar-row for "${title}"`).toHaveLength(1)
  return found[0]
}
const attentionOf = (row: HTMLElement): HTMLElement | null => row.querySelector<HTMLElement>('[data-ui="row-attention"]')
  ?? (row.nextElementSibling?.matches('[data-ui="row-attention"]') ? row.nextElementSibling as HTMLElement : null)
const said = (el: Element): string => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ')
const onCreateParallel = vi.fn()
async function renderSidebar(): Promise<void> {
  render(<ThreadSidebar onCreate={vi.fn()} onCreateParallel={onCreateParallel} />)
  await waitFor(() => expect(within(aside()).getAllByText('Fix the login bug').length).toBeGreaterThan(0))
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests(); onCreateParallel.mockReset(); fixture() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-170 OXC-5 parallel chats in the sidebar and their screen (A15)', () => {
  it('draws the children as one-line rows right under their parent, once, before the next conversation', async () => {
    await renderSidebar()
    const order = rows().map(row => row.querySelector('[data-ui="row-title"]')?.textContent?.trim() ?? '')
    const parent = order.findIndex(title => title.includes('Fix the login bug'))
    expect(order.slice(parent, parent + 3).map(title => title.slice(0, 18)), `rows: ${order.join(' | ')}`).toEqual(['Fix the login bug', 'Try the cookie rou', 'Write the migratio'])
    for (const title of ['Try the cookie route', 'Write the migration']) expect(rowOf(title), title).toHaveAttribute('data-lines', '1')
    expect(rowOf('Fix the login bug')).toHaveAttribute('data-lines', '2')
    expect(order.filter(title => title.includes('Try the cookie route')), 'a child is listed once').toHaveLength(1)
  })

  it('sums the children\'s changes on the parent\'s line 2', async () => {
    await renderSidebar()
    await waitFor(() => expect(rowOf('Fix the login bug').querySelector('[data-ui="row-meta"]')).toHaveTextContent(/\+9/))
    expect(rowOf('Fix the login bug').querySelector('[data-ui="row-meta"]')!.textContent).toMatch(/[−-]4/)
  })

  it('puts a waiting child\'s mini card on the child\'s row, not on the parent\'s', async () => {
    await renderSidebar()
    await waitFor(() => expect(attentionOf(rowOf('Write the migration'))).toBeTruthy())
    expect(attentionOf(rowOf('Write the migration'))).toHaveTextContent('npm run migrate')
    expect(attentionOf(rowOf('Fix the login bug'))).toBeNull()
  })

  it.each(['en', 'pt-BR'])('offers Nova conversa paralela (%s) on a parent row and in its menu, never on a child, with no shortcut', async locale => {
    await changeLanguage(locale)
    await renderSidebar()
    const label = tt('sidebar.newParallel')
    const plus = within(rowOf('Fix the login bug')).queryAllByRole('button').filter(button => said(button).includes(label))
    expect(plus.length, 'a + on the parent row').toBeGreaterThan(0)
    expect(plus[0]).toHaveAttribute('data-ui', 'icon-button')
    expect(said(plus[0]), 'no shortcut is shown').not.toMatch(/Ctrl|⌘|Alt\+/)
    fireEvent.click(plus[0])
    expect(onCreateParallel).toHaveBeenCalledWith('a')
    for (const child of ['Try the cookie route', 'Write the migration']) expect(within(rowOf(child)).queryAllByRole('button').filter(button => said(button).includes(label)), `${child} offers none`).toEqual([])
    onCreateParallel.mockReset()
    fireEvent.contextMenu(rowOf('Fix the login bug'))
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${label}`) }))
    expect(onCreateParallel).toHaveBeenCalledWith('a')
  })

  it.each(['en', 'pt-BR'])('the parallel screen (%s) is headed by the parent, locks project and worktree, keeps the agent free, says what it does', async locale => {
    await changeLanguage(locale)
    render(<NewConversationScreen projectId="p1" parentThreadId="a" />)
    await waitFor(() => expect(screen.getAllByText(tt('parallel.title', { title: 'Fix the login bug' })).length).toBeGreaterThan(0))
    expect(screen.getByText(tt('parallel.notice'))).toBeInTheDocument()
    const row = screen.getByRole('group', { name: tt('opening.context') })
    const pickers = [...row.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
    const projectPicker = pickers.find(el => said(el).includes('Atlas'))
    expect(projectPicker, 'the project picker shows Atlas').toBeTruthy()
    const locked = (el: HTMLElement): boolean => el.matches(':disabled, [aria-disabled="true"]') || !!el.querySelector(':disabled, [aria-disabled="true"]') || el.getAttribute('data-locked') === 'true'
    expect(locked(projectPicker!), 'the project is locked').toBe(true)
    expect(row).toHaveTextContent(tt('parallel.locked'))
    expect(within(row).queryByRole('switch', { name: tt('dialogs.inWorktree') }), 'no worktree choice for a child').toBeNull()
    const agent = pickers.find(el => said(el).includes('Claude'))
    expect(agent && !locked(agent), 'the agent stays choosable').toBe(true)
  })

  it('the first message creates the child with createChat on the parent and sends to it, never thread.create', async () => {
    render(<NewConversationScreen projectId="p1" parentThreadId="a" />)
    const box = await screen.findByRole('textbox', { name: tt('composer.message') })
    fireEvent.change(box, { target: { value: 'Try another approach' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(api.createChat).toHaveBeenCalledWith('a', expect.objectContaining({ provider: 'claude' })))
    await waitFor(() => expect(api.send.mock.calls.some(call => call[0] === 'a3' && call[1] === 'Try another approach'), 'send(a3, the text)').toBe(true))
    expect(api.create).not.toHaveBeenCalled()
  })

  it('adds the new strings in en and pt-BR', () => {
    const en = catalog('en'), pt = catalog('pt-BR')
    expect([en['sidebar.newParallel'], pt['sidebar.newParallel']]).toEqual(['New parallel conversation', 'Nova conversa paralela'])
    expect([en['parallel.title'], pt['parallel.title']]).toEqual(['New parallel conversation in {{title}}', 'Nova conversa paralela em {{title}}'])
    expect([en['parallel.notice'], pt['parallel.notice']]).toEqual(['This conversation works in the same folder and starts from the session\'s changes. Both see the same files.',
      'Esta conversa trabalha na mesma pasta e parte das alterações da sessão. As duas veem os mesmos arquivos.'])
    expect([en['parallel.locked'], pt['parallel.locked']]).toEqual(['session worktree', 'worktree da sessão'])
  })

  it('seeds one child in the e2e conversation fixture, so the brand scene shows a one-line row (SOURCE-TEXT check, marked)', () => {
    const fixture = readFileSync(join(ROOT, 'e2e/helpers/thread-fixtures.ts'), 'utf8')
    expect(fixture, 'the e2e fixture installs a child conversation').toMatch(/parentThreadId\s*:/)
  })

  it('turns the one-line row measure to enforced', () => {
    expect(notEnforced(['BRD-02.row1.height'])).toEqual([])
  })
})
