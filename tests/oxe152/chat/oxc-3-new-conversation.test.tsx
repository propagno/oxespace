// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-168, OXC-3).
// Written by the planner; the executor must not edit it. Source: the written target v2 approved by the user on 15/11
// (oxechat-final-target.md, OXC-3, canvas boards 3 and 4), the 7th string of 15/11 (dialogs.inWorktreeShort), the user's
// rule "mesmo padrão, tudo tem que sair como foi projetado na interface" and the coordinator's binding: the card's task
// adds the data-ui its measures read and turns ITS OWN measures of brd-05.json (PR #842, scene chat-new-session, added by
// the brand) to enforced.
// Today (main 21704086d) a new conversation starts in the NewThreadDialog (a modal), and the opening with its starters
// shows only after the conversation exists.
// Contract (pixels are the conformance scene's job, marca/conformidade; this file pins structure, words and behaviour):
// - New module src/components/Threads/NewConversationScreen.tsx exports NewConversationScreen({ projectId, rootPath?,
//   parentThreadId?, onCreated? }): an in-place screen, never a dialog, with the same data as the old dialog. App opens
//   it where the dialog was; NewThreadDialog is no longer mounted (SOURCE-TEXT check, marked).
// - Heading [data-ui=new-conversation-title]: thread:opening.title with the agent (threadAgentName) and the folder (the
//   worktree branch once isolated with a branch named).
// - Pickers row, a group named "Onde o agente trabalha" (thread:opening.context), of [data-ui=context-picker] controls:
//   Projeto (the project's name), Agente (the agent's name), the "Worktree isolada" switch (role switch named
//   thread:dialogs.inWorktree, its pill showing thread:dialogs.inWorktreeShort, off by default, remembered per project as
//   today) and Acesso (thread:opening.access.*). On, the panel shows the hint (thread:dialogs.inWorktreeHint) and the
//   Branch and Começar de fields (thread:dialogs.branchPlaceholder, dialogs.startFromPlaceholder).
// - Then the composer ([data-ui=composer], OXC-2b) and the four starters, [data-ui=starter], in the order of
//   thread:opening.starter.{tour,review,bugs,next}.label.
// - Sending the first message creates the conversation with the screen's choices (window.oxe.thread.create, with
//   worktree { branch } only when the switch is on) and sends the text to it (window.oxe.thread.send); it never creates a
//   parallel chat (that is OXC-5, with parentThreadId).
// - Sidebar: while the screen is open, ThreadSidebar's `draft={{ projectId }}` shows the row "Nova conversa · rascunho"
//   (thread:view.newConversation · thread:sidebar.draft) in its project, and it is the one selection.
// - New strings in en and pt-BR: sidebar.draft and dialogs.inWorktreeShort.
// - BRD-05 (PR #842): the card's measures are enforced and in enforced.lock.json, the new composer's radius included
//   (OXC-2b lands first; the measure lives in this card's scene).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewConversationScreen } from '../../../src/components/Threads/NewConversationScreen'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import { threadAgentName } from '../../../shared/threadProviders'
import type { ConversationThread, ThreadApi } from '../../../shared/types/thread'

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
const OXC3_MEASURES = ['BRD-05.new-title.font-size', 'BRD-05.new-title.font-weight', 'BRD-05.new-title.font-family', 'BRD-05.picker.height', 'BRD-05.starter.count', 'BRD-05.new-composer.radius'] as const

const PROJECT = { projectId: 'p', displayName: 'Atlas', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'repo' }] }
const SELECTED = { id: 'a', workspaceId: 'thread:p', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'Fix the login bug', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 10, updatedAt: Date.now() - 60_000 } as ConversationThread
let api: Record<string, ReturnType<typeof vi.fn>>
function fixture() {
  const created = { thread: { ...SELECTED, id: 't-new', title: '' }, events: [] }
  api = {
    create: vi.fn(async () => created), createChat: vi.fn(async () => created), send: vi.fn(async () => {}), read: vi.fn(async () => created), list: vi.fn(async () => [SELECTED]),
    projects: vi.fn(async () => ({ projects: [PROJECT], unavailable: [] })), models: vi.fn(async () => ({ defaultModel: 'm', models: [] })), commands: vi.fn(async () => ({ commands: [] })),
    newConversationAccess: vi.fn(async () => 'full-access'), onChanged: vi.fn(() => () => {}), command: vi.fn(async () => undefined),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn(async (_id: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []), sessions: vi.fn(async () => [])
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  useThreadStore.setState({ threads: [SELECTED], projects: [PROJECT], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'a', secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
}
const one = (selector: string, root: ParentNode = document): HTMLElement => {
  const found = [...root.querySelectorAll<HTMLElement>(selector)]
  expect(found, `exactly one ${selector}`).toHaveLength(1)
  return found[0]
}
const said = (el: Element): string => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ')
const message = (): HTMLElement => screen.getByRole('textbox', { name: tt('composer.message') })
async function sendFirst(text: string): Promise<void> {
  fireEvent.change(message(), { target: { value: text } })
  fireEvent.keyDown(message(), { key: 'Enter' })
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests(); fixture() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-168 OXC-3 new conversation (A13)', () => {
  it.each(['en', 'pt-BR'])('is a screen in place (%s), not a dialog, headed by the opening title with agent and folder', async locale => {
    await changeLanguage(locale)
    render(<NewConversationScreen projectId="p" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(one('[data-ui="new-conversation-title"]')).toHaveTextContent(tt('opening.title', { agent: threadAgentName('claude'), folder: 'repo' }))
  })

  it('has the pickers row "Onde o agente trabalha": Projeto, Agente, the Worktree isolada switch and Acesso, as context pickers', async () => {
    render(<NewConversationScreen projectId="p" />)
    const row = screen.getByRole('group', { name: tt('opening.context') })
    const pickers = [...row.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
    expect(pickers.length, 'context pickers in the row').toBeGreaterThanOrEqual(3)
    const text = pickers.map(said).join(' | ')
    for (const word of ['Atlas', threadAgentName('claude'), tt('dialogs.inWorktreeShort')]) expect(text, `the pickers show ${word}`).toContain(word)
    await waitFor(() => expect(pickers.map(said).join(' | ')).toContain(tt('opening.access.full-access')))
    const toggle = within(row).getByRole('switch', { name: tt('dialogs.inWorktree') })
    expect(toggle).not.toBeChecked()
    expect(screen.queryByPlaceholderText(tt('dialogs.branchPlaceholder'))).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(screen.getByText(tt('dialogs.inWorktreeHint'))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(tt('dialogs.startFromPlaceholder'))).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(tt('dialogs.branchPlaceholder')), { target: { value: 'fix/login' } })
    expect(one('[data-ui="new-conversation-title"]')).toHaveTextContent(tt('opening.title', { agent: threadAgentName('claude'), folder: 'fix/login' }))
  })

  it('offers the composer and then the four starters in order', () => {
    render(<NewConversationScreen projectId="p" />)
    one('[data-ui="composer"]')
    const starters = [...document.querySelectorAll<HTMLElement>('[data-ui="starter"]')]
    expect(starters.map(el => el.textContent?.trim().slice(0, tt('opening.starter.tour.label').length + 40))).toEqual(
      ['tour', 'review', 'bugs', 'next'].map(id => expect.stringContaining(tt(`opening.starter.${id}.label`))))
  })

  it('the first message creates the conversation with the screen\'s choices and sends the text to it', async () => {
    render(<NewConversationScreen projectId="p" />)
    await sendFirst('Explain the auth flow')
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude' }))
    await waitFor(() => expect(api.send.mock.calls.some(call => call[0] === 't-new' && call[1] === 'Explain the auth flow'), 'send(t-new, the text)').toBe(true))
    expect(api.createChat).not.toHaveBeenCalled()
  })

  it('with the switch on, it asks for the worktree, and the choice is remembered for the project', async () => {
    const first = render(<NewConversationScreen projectId="p" />)
    fireEvent.click(screen.getByRole('switch', { name: tt('dialogs.inWorktree') }))
    fireEvent.change(screen.getByPlaceholderText(tt('dialogs.branchPlaceholder')), { target: { value: 'fix/login' } })
    await sendFirst('Fix it on its own branch')
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude', worktree: { branch: 'fix/login' } }))
    first.unmount()
    render(<NewConversationScreen projectId="p" />)
    expect(screen.getByRole('switch', { name: tt('dialogs.inWorktree') })).toBeChecked()
  })

  it('replaces the dialog: App mounts the screen and no longer the NewThreadDialog (SOURCE-TEXT check, marked)', () => {
    const list = (dir: string): string[] => readdirSync(dir).flatMap(name => { const full = join(dir, name); return statSync(full).isDirectory() ? list(full) : /\.tsx?$/.test(name) ? [full] : [] })
    expect(readFileSync(join(ROOT, 'src/App.tsx'), 'utf8')).not.toMatch(/NewThreadDialog/)
    const users = list(join(ROOT, 'src')).filter(file => !file.endsWith('NewConversationScreen.tsx') && /NewConversationScreen/.test(readFileSync(file, 'utf8')))
    expect(users.length, 'something in src opens NewConversationScreen').toBeGreaterThan(0)
  })

  it.each(['en', 'pt-BR'])('the sidebar shows the draft row (%s) in its project as the one selection', async locale => {
    await changeLanguage(locale)
    render(<ThreadSidebar onCreate={vi.fn()} draft={{ projectId: 'p' }} />)
    const label = `${tt('view.newConversation')} · ${tt('sidebar.draft')}`
    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    const row = screen.getByText(label).closest<HTMLElement>('[data-ui="sidebar-row"]')
    expect(row, 'the draft is a sidebar row').toBeTruthy()
    expect(row).toHaveAttribute('aria-current', 'true')
    const aside = screen.getByRole('complementary', { name: tt('sidebar.region') })
    expect([...aside.querySelectorAll('[aria-current="true"]')], 'the draft is the one selection').toEqual([row])
  })

  it('adds the new strings sidebar.draft and dialogs.inWorktreeShort in en and pt-BR', () => {
    expect([catalog('en')['sidebar.draft'], catalog('pt-BR')['sidebar.draft']]).toEqual(['draft', 'rascunho'])
    expect([catalog('en')['dialogs.inWorktreeShort'], catalog('pt-BR')['dialogs.inWorktreeShort']]).toEqual(['Isolated worktree', 'Worktree isolada'])
  })

  it('turns its own BRD-05 measures to enforced', () => {
    expect(notEnforced(OXC3_MEASURES)).toEqual([])
  })
})
