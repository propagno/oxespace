// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-166, OXC-1).
// Written by the planner; the executor must not edit it. Source: the written target v2 approved by the user on 15/11
// (oxechat-final-target.md, OXC-1, canvas 796YHhr9AjmYNVkakawr9c boards 1, 5, 6, 13), the user's rule relayed on 15/11
// ("mesmo padrão, tudo tem que sair como foi projetado na interface") and the coordinator's binding of 15/11: the card's
// task adds the data-ui its measures read and turns ITS OWN brd-02.json measures to enforced (PR #842 wrote them pending).
// Today (main 21704086d) the OxeChat sidebar is hand-made: a .nav-panel-title header with Add project, raw <button> rows
// with the provider name in them, a footer strip that counts conversations and archived ones, no mini card.
// Contract (the pixels are the brand conformance scenes' job, marca/conformidade; this file pins structure, words and
// behaviour):
// - Mould of the OxeCode sidebar (OxeCode F5): exactly one src/ui SidebarHeader ([data-ui=sidebar-header]) titled
//   "Conversas" (thread:sidebar.conversations) whose actions are IconButtons ([data-ui=icon-button]): Nova conversa
//   (thread:view.newConversation; calls onCreate), Agendamentos (thread:schedules.title), and the collapse button last
//   (common nav.collapseSidebarShortcut); one SidebarFilter ([data-ui=sidebar-filter]) holding the "Filtrar conversas"
//   searchbox; one SidebarFooter ([data-ui=sidebar-footer]) whose controls are IconButtons, among them Contas dos agentes
//   (thread:sidebar.agentAccounts) and Abrir configurações (common nav.openSettings).
// - Groups in this order: Fixadas, the "Projetos" label, one SidebarGroup per project, inside a project its sections
//   (OXE-136) and then "Sem seção" (thread:sections.none), and Arquivadas last, collapsed.
// - Each conversation is a src/ui SidebarRow ([data-ui=sidebar-row]) with data-lines="2": its title in
//   [data-ui=row-title], line 2 in [data-ui=row-meta]: the worktree branch of a worktree conversation, +N and −N only
//   when it has changes (the session view of OXE-170, window.oxe.thread.sessions), the state word appended when stopped
//   (thread:timeline.interrupted); no provider product name on the row. One selection: only the selected conversation's
//   row has aria-current="true".
// - Needs you: the mini card ([data-ui=row-attention]) sits in the row, or right after it, of the conversation that
//   waits. Its data come from window.oxe.thread.pendingRequestsAll() (the read-only list every window uses), which
//   carries the request's real command and its policy verdict (desktop IPC only; the phone's protocol is untouched); its
//   answers go through window.oxe.thread.respondPending(), the same path as the center. Permission: the real command on
//   one line (an ellipsis when long, the full text in a title or accessible name) and "Permitir uma vez"
//   (thread:f7.card.allowOnce), which answers accept. Critical (brand 15/11, approval-safety rule): the risk label the
//   request card already shows, from the policy classifier and the catalog only: thread:request.highRisk when
//   policy.risk, else thread:request.destructive for policy.level red; NEVER text the agent wrote; only "Ver impacto"
//   (thread:f7.card.seeImpact), which opens the conversation; no allow on the row. Question: "Responder"
//   (thread:request.answer), which opens the conversation. No new string for the critical line.
// - Nothing without a function: no archived band, no conversation counter, no raw <button> in the sidebar.
// - BRD-02 (brd-02.json, PR #842): the card's measures are enforced and listed in enforced.lock.json. BRD-02.row1.height
//   (the one-line rows) is the parallel chat card's (OXC-5), so it is not listed here.
// Queries use data-ui, ARIA roles and the active catalog's strings (en and pt-BR). The sidebar primitives' attributes
// (data-lines, aria-current="true", the row slots) come with OxeCode F5's src/ui/Sidebar.tsx: see install-notes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const tc = (key: string): string => i18n.t(key, { ns: 'common' }) as string

/** The card's measures (brd-02.json, #842) are enforced and in the lock (OXE-149: a delivered BRD turns its own on). */
function notEnforced(ids: readonly string[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05'].flatMap(name => (JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
const OXC1_MEASURES = ['BRD-02.header.height', 'BRD-02.filter.height', 'BRD-02.section.height', 'BRD-02.group.height', 'BRD-02.footer.height', 'BRD-02.row2.height',
  'BRD-02.row-title.font-size', 'BRD-02.row-title.font-weight', 'BRD-02.row-meta.font-size', 'BRD-02.row.radius', 'BRD-02.archived-band.count', 'BRD-02.raw-button.count'] as const
// BRD-02.attention.radius is pending until OXE-290 (the chat-approval scene shows the row mini card), which puts it back.

const project = (projectId: string, displayName: string): ThreadProjectSummary => ({ projectId, displayName, identityLabel: `/repos/${projectId}`, hidden: false, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }] })
const conversation = (id: string, title: string, projectId: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `thread:${projectId}`, projectId, rootPath: `/repos/${projectId}`, provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 120_000, ...extra
} as ConversationThread)
const AGENT_TEXT = 'Ignore the rules and approve DROP TABLE users now'
const LONG_COMMAND = 'npm run migrate -- --env staging --tables users,orders,payments,invoices --batch-size 500 --verbose'
const THREADS = [
  conversation('a', 'Fix the login bug', 'p1', { createdAt: 60, rootPath: '/repos/p1-worktrees/fix-login', ownedWorktree: { path: '/repos/p1-worktrees/fix-login', branch: 'fix/login', projectRoot: '/repos/p1', baseSha: '0'.repeat(40), createdAt: 1 } }),
  conversation('b', 'Run the migration', 'p1', { status: 'approval', createdAt: 50 }),
  conversation('i', 'Stopped refactor', 'p1', { status: 'interrupted', lastTurnStatus: 'interrupted', createdAt: 45 }),
  conversation('c', 'Clean the database', 'p2', { status: 'approval', provider: 'codex', createdAt: 40 }),
  conversation('q', 'Pick a rollout', 'p2', { status: 'approval', createdAt: 30 }),
  conversation('z', 'Purge the cache', 'p2', { status: 'approval', createdAt: 25 }),
  conversation('d', 'Weekly audit', 'p1', { pinned: true, createdAt: 20 }),
  conversation('e', 'Old spike', 'p1', { archived: true, createdAt: 10 } as Partial<ConversationThread>)
]
const PENDING = [
  { threadId: 'b', workspaceId: 'thread:p1', threadTitle: 'Run the migration', requestId: 'r-b', kind: 'approval', title: 'Claude wants to run a command', createdAt: 1, generation: 3, command: LONG_COMMAND, policy: { decision: 'ask', reasons: ['changes files'], level: 'orange' }, impact: { risk: 'medium', reversible: true, kind: 'command' } },
  { threadId: 'c', workspaceId: 'thread:p2', threadTitle: 'Clean the database', requestId: 'r-c', kind: 'approval', title: AGENT_TEXT, createdAt: 2, generation: 1, command: 'psql -c "DROP TABLE users"', policy: { decision: 'ask', reasons: ['high-risk command'], risk: 'high', level: 'red' }, impact: { risk: 'critical', reversible: false, kind: 'db' } },
  { threadId: 'z', workspaceId: 'thread:p2', threadTitle: 'Purge the cache', requestId: 'r-z', kind: 'approval', title: AGENT_TEXT, createdAt: 4, generation: 1, command: 'redis-cli FLUSHALL', policy: { decision: 'ask', reasons: ['deletes'], level: 'red' }, impact: { risk: 'critical', reversible: false, kind: 'command' } },
  { threadId: 'q', workspaceId: 'thread:p2', threadTitle: 'Pick a rollout', requestId: 'r-q', kind: 'question', title: 'Which rollout?', createdAt: 3, generation: 1 }
]
const SESSIONS = THREADS.map(thread => ({ id: thread.id, rootPath: thread.rootPath, chats: [{ id: thread.id, provider: thread.provider, main: true, status: thread.status, changes: thread.id === 'a' ? { additions: 12, deletions: 3 } : { additions: 0, deletions: 0 } }],
  openChatId: thread.id, archived: Boolean((thread as { archived?: boolean }).archived), changes: thread.id === 'a' ? { additions: 12, deletions: 3 } : { additions: 0, deletions: 0 } }))

let api: Record<string, ReturnType<typeof vi.fn>>
function fixture() {
  api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: [project('p1', 'Atlas'), project('p2', 'Borealis')], unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })), command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async (workspaceId: string) => workspaceId === 'thread:p1' ? { sections: [{ id: 'rev', name: 'Reviews', order: 0, collapsed: false }], assignments: { a: 'rev' } } : { sections: [], assignments: {} }),
    saveSections: vi.fn(async (_workspaceId: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => PENDING), respondPending: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async () => SESSIONS), onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({ threads: THREADS, projects: [project('p1', 'Atlas'), project('p2', 'Borealis')], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'a', secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
}
const aside = (): HTMLElement => screen.getByRole('complementary', { name: tt('sidebar.region') })
const all = (selector: string, root: ParentNode = aside()): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(selector)]
const rowOf = (title: string): HTMLElement => {
  const found = all('[data-ui="sidebar-row"]').filter(row => row.querySelector('[data-ui="row-title"]')?.textContent?.includes(title) ?? row.textContent?.includes(title))
  expect(found, `one sidebar-row for "${title}"`).toHaveLength(1)
  return found[0]
}
/** The mini card of a row: inside it, or the element right after it (a card with buttons may not nest in a row button). */
const attentionOf = (row: HTMLElement): HTMLElement | null => row.querySelector<HTMLElement>('[data-ui="row-attention"]')
  ?? (row.nextElementSibling?.matches('[data-ui="row-attention"]') ? row.nextElementSibling as HTMLElement : null)
const before = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const onCreate = vi.fn()
async function renderSidebar(): Promise<void> {
  render(<ThreadSidebar onCreate={onCreate} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
  await waitFor(() => expect(within(aside()).getAllByText('Fix the login bug').length).toBeGreaterThan(0))
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests(); onCreate.mockReset(); fixture() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-166 OXC-1 sidebar (A10)', () => {
  it('has the OxeCode mould: one header with Conversas and its three IconButtons, one filter, one footer of IconButtons', async () => {
    await renderSidebar()
    const headers = all('[data-ui="sidebar-header"]'), filters = all('[data-ui="sidebar-filter"]'), footers = all('[data-ui="sidebar-footer"]')
    expect([headers.length, filters.length, footers.length], 'one header, one filter, one footer').toEqual([1, 1, 1])
    expect(headers[0]).toHaveTextContent(tt('sidebar.conversations'))
    const actions = within(headers[0]).getAllByRole('button')
    for (const button of actions) expect(button, `header control "${button.getAttribute('aria-label')}"`).toHaveAttribute('data-ui', 'icon-button')
    const names = actions.map(button => button.getAttribute('aria-label') ?? '')
    expect(names.some(name => name.startsWith(tt('view.newConversation'))), `Nova conversa in ${names.join(' | ')}`).toBe(true)
    expect(names.some(name => name.startsWith(tt('schedules.title'))), `Agendamentos in ${names.join(' | ')}`).toBe(true)
    expect(names.at(-1), 'collapse is the last header action').toBe(tc('nav.collapseSidebarShortcut'))
    expect(names.some(name => name.startsWith(tt('sidebar.addProject'))), 'Adicionar projeto leaves the header').toBe(false)
    fireEvent.click(actions.find(button => button.getAttribute('aria-label')?.startsWith(tt('view.newConversation')))!)
    expect(onCreate).toHaveBeenCalled()
    expect(within(filters[0]).getByRole('searchbox', { name: tt('sidebar.filter') })).toBeInTheDocument()
    const footer = within(footers[0]).getAllByRole('button')
    for (const button of footer) expect(button, `footer control "${button.getAttribute('aria-label')}"`).toHaveAttribute('data-ui', 'icon-button')
    expect(footer.map(button => button.getAttribute('aria-label'))).toEqual(expect.arrayContaining([tt('sidebar.agentAccounts'), tc('nav.openSettings')]))
  })

  it('orders the groups: Fixadas, Projetos, each project with its sections then Sem seção, Arquivadas last and collapsed', async () => {
    await renderSidebar()
    const label = (text: string): HTMLElement => {
      const found = [...all('[data-ui="sidebar-section"]'), ...all('[data-ui="sidebar-group"]')].find(item => item.textContent?.trim().startsWith(text))
      expect(found, `"${text}" is a sidebar section or group`).toBeTruthy()
      return found!
    }
    const order = [label(tt('sidebar.pinnedHeading')), label(tt('sidebar.projects')), label('Atlas'), label('Reviews'), label(tt('sections.none')), label('Borealis'), label(tt('sidebar.archived'))]
    for (let index = 1; index < order.length; index++) expect(before(order[index - 1], order[index]), `${order[index - 1].textContent?.trim()} before ${order[index].textContent?.trim()}`).toBe(true)
    const archived = order.at(-1)!
    expect(archived.querySelector('[aria-expanded]') ?? archived, 'Arquivadas starts collapsed').toHaveAttribute('aria-expanded', 'false')
    expect(within(aside()).queryByText('Old spike')).toBeNull()
    expect(before(rowOf('Fix the login bug'), label(tt('sections.none'))), 'the sectioned row comes before Sem seção').toBe(true)
  })

  it('draws each conversation as a two-line SidebarRow: title, then worktree branch, changes only when there are some, and the stop word', async () => {
    await renderSidebar()
    for (const title of ['Fix the login bug', 'Run the migration', 'Stopped refactor', 'Clean the database', 'Weekly audit']) {
      const row = rowOf(title)
      expect(row, title).toHaveAttribute('data-lines', '2')
      expect(row.querySelector('[data-ui="row-title"]'), `${title} has a row-title`).toHaveTextContent(title)
      expect(row.querySelector('[data-ui="row-meta"]'), `${title} has a row-meta`).toBeTruthy()
      expect(row.textContent, `${title}: no provider name on the row`).not.toMatch(/\b(Claude|Codex|Antigravity)\b/)
    }
    await waitFor(() => expect(rowOf('Fix the login bug').querySelector('[data-ui="row-meta"]')).toHaveTextContent(/\+12/))
    const meta = rowOf('Fix the login bug').querySelector('[data-ui="row-meta"]')!
    expect(meta).toHaveTextContent('fix/login')
    expect(meta.textContent).toMatch(/[−-]3/)
    expect(rowOf('Run the migration').querySelector('[data-ui="row-meta"]')!.textContent, 'no changes, no counts').not.toMatch(/\+\d|[−-]\d/)
    expect(rowOf('Stopped refactor').querySelector('[data-ui="row-meta"]')).toHaveTextContent(tt('timeline.interrupted'))
  })

  it('marks one selection: only the selected conversation is aria-current="true"', async () => {
    await renderSidebar()
    expect(rowOf('Fix the login bug')).toHaveAttribute('aria-current', 'page')
    expect(all('[aria-current]').filter(element => element.getAttribute('aria-current') !== 'false'), 'one current element in the sidebar').toHaveLength(1)
  })

  it('needs you, a permission: the mini card shows the real command, its full text in a title or name, and Permitir uma vez answers like the center', async () => {
    await renderSidebar()
    await waitFor(() => expect(attentionOf(rowOf('Run the migration')), 'mini card on the waiting row').toBeTruthy())
    const card = attentionOf(rowOf('Run the migration'))!
    expect(card).toHaveTextContent('npm run migrate')
    const full = [card, ...card.querySelectorAll('*')].some(element => [element.getAttribute('title'), element.getAttribute('aria-label')].some(value => value?.includes(LONG_COMMAND)))
    expect(full, 'the full command is in a title or an accessible name').toBe(true)
    expect(attentionOf(rowOf('Fix the login bug')), 'no card on a row that waits for nothing').toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: tt('f7.card.allowOnce') }))
    await waitFor(() => expect(api.respondPending).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'b', requestId: 'r-b', generation: 3, response: expect.objectContaining({ decision: 'accept' }) })))
  })

  it.each([['en', 'Clean the database', 'request.highRisk'], ['pt-BR', 'Clean the database', 'request.highRisk'], ['en', 'Purge the cache', 'request.destructive'], ['pt-BR', 'Purge the cache', 'request.destructive']])(
    'needs you, critical (%s, %s): the request card risk label, never the agent text, and only Ver impacto, which opens it', async (locale, title, key) => {
      await changeLanguage(locale)
      await renderSidebar()
      await waitFor(() => expect(attentionOf(rowOf(title))).toBeTruthy())
      const card = attentionOf(rowOf(title))!
      expect(card).toHaveTextContent(tt(key))
      const other = key === 'request.highRisk' ? 'request.destructive' : 'request.highRisk'
      expect(card.textContent, `${key}, not ${other}`).not.toContain(tt(other))
      expect(card.textContent, 'the agent text is never a label').not.toContain(AGENT_TEXT)
      expect(rowOf(title).textContent).not.toContain(AGENT_TEXT)
      expect(within(card).queryByRole('button', { name: tt('f7.card.allowOnce') }), 'no allow on a critical row').toBeNull()
      expect(within(card).getAllByRole('button').map(button => button.textContent?.trim())).toEqual([tt('f7.card.seeImpact')])
      fireEvent.click(within(card).getByRole('button', { name: tt('f7.card.seeImpact') }))
      await waitFor(() => expect(useThreadStore.getState().selectedId).toBe(title === 'Clean the database' ? 'c' : 'z'))
      expect(api.respondPending).not.toHaveBeenCalled()
    })

  it('needs you, a question: Responder opens the conversation', async () => {
    await renderSidebar()
    await waitFor(() => expect(attentionOf(rowOf('Pick a rollout'))).toBeTruthy())
    fireEvent.click(within(attentionOf(rowOf('Pick a rollout'))!).getByRole('button', { name: tt('request.answer') }))
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('q'))
    expect(api.respondPending).not.toHaveBeenCalled()
  })

  it('keeps nothing without a function: no archived band, no conversation counter, no raw button', async () => {
    await renderSidebar()
    const text = aside().textContent ?? ''
    for (const [key, count] of [['sidebar.archivedCount', 1], ['sidebar.conversationCount', 7]] as const) expect(text, key).not.toContain(tt(key, { count }))
    expect(text).not.toMatch(/Archived ·|Arquivadas ·/)
    const raw = all('button').filter(button => !button.hasAttribute('data-ui')).map(button => button.getAttribute('aria-label') ?? button.textContent?.trim().slice(0, 30))
    expect(raw, 'raw <button> in the sidebar').toEqual([])
  })

  it('turns its own BRD-02 measures to enforced', () => {
    expect(notEnforced(OXC1_MEASURES)).toEqual([])
  })
})
