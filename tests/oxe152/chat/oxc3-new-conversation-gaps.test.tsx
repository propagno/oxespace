// Frozen acceptance test for 1.5.2 OxeChat F5 (OXE program oxespace-152-chat, phase F1, Jira OXE-168 OXC-3, F5 A21
// and A22). Written by the planner; the executor must not edit it. These are the CAs that F4's frozen
// tests/oxe152/chat/oxc-3-new-conversation.test.tsx states in its header but never checks. Its harness is reused here
// as it is. Contract (the same as oxc-3's header):
// - Sidebar: while the new conversation screen is open, ThreadSidebar's `draft={{ projectId }}` shows one row
//   [data-thread-draft=<projectId>] in that project, titled "{thread:view.newConversation} · {thread:sidebar.draft}"
//   ("Nova conversa · rascunho"), and that row is the one selection (aria-current) of the sidebar (A21, CA-7).
// - Screen: NewConversationScreen's row "Onde o agente trabalha" (thread:opening.context) has exactly four context
//   pickers, [data-ui=context-picker]: Projeto, Agente, the Worktree isolada switch and Acesso. There is no Branch or
//   worktree selector before the switch is on, no computer picker, and no conversation without a folder (A22, CA-8).
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


describe('OXE-168 OXC-3 the draft row and what the screen leaves out (F5 A21, A22)', () => {
  it('while the screen is open, the sidebar shows "Nova conversa · rascunho" in its project, and it is the one selection', async () => {
    render(<ThreadSidebar onCreate={vi.fn()} draft={{ projectId: 'p' }} />)
    const aside = screen.getByRole('complementary', { name: tt('sidebar.region') })
    await waitFor(() => expect(within(aside).getAllByText('Fix the login bug').length).toBeGreaterThan(0))
    const draft = aside.querySelector<HTMLElement>('[data-thread-draft="p"]')
    expect(draft, 'the draft row of project p').not.toBeNull()
    expect(draft!.textContent).toContain(`${tt('view.newConversation')} · ${tt('sidebar.draft')}`)
    const selected = [...aside.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"][aria-current="true"]')]
    expect(selected, 'one selection in the sidebar').toHaveLength(1)
    expect(draft!.contains(selected[0]), 'the selection is the draft row').toBe(true)
  })

  it('offers no Branch or worktree selector, no computer picker and no conversation without a folder', async () => {
    render(<NewConversationScreen projectId="p" />)
    const row = screen.getByRole('group', { name: tt('opening.context') })
    await waitFor(() => expect([...row.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')].map(said).join(' | ')).toContain(tt('opening.access.full-access')))
    expect(row.querySelectorAll('[data-ui="context-picker"]'), 'Projeto, Agente, the worktree switch and Acesso').toHaveLength(4)
    expect(screen.queryByPlaceholderText(tt('dialogs.branchPlaceholder')), 'no Branch field while the switch is off').toBeNull()
    expect(screen.queryByRole('combobox', { name: /branch|worktree/i }), 'no Branch or worktree selector').toBeNull()
    const words = document.body.textContent ?? ''
    expect(words, 'no computer picker').not.toMatch(/computer|machine|computador|máquina/i)
    expect(words, 'no conversation without a folder').not.toMatch(/without a folder|no folder|sem pasta/i)
  })
})
