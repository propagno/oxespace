// Frozen acceptance test for 1.5.2 OxeChat F5 (OXE program oxespace-152-chat, phase F1, Jira OXE-170 OXC-5, F5 A34
// and A35). Written by the planner; the executor must not edit it. These are the CAs that F4's frozen
// tests/oxe152/chat/oxc-5-parallel-ui.test.tsx states in its header but never checks. Its harness is reused here as it
// is. Contract (the same as oxc-5's header):
// - Create: a parent row offers "Nova conversa paralela" (thread:sidebar.newParallel) as its "+" IconButton and in its
//   ⋯ menu; both call ThreadSidebar's onCreateParallel(parentId). A child row offers neither (chats do not nest) (A34,
//   CA-7).
// - No keyboard shortcut creates a parallel chat: no keybinding names it, and the entries show none (A35, CA-8).
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

import { KEYBINDINGS } from '../../../src/keyboard/keybindings'

describe('OXE-170 OXC-5 how a parallel chat is started (F5 A34, A35)', () => {
  it('a parent row offers "Nova conversa paralela" as its + and in its ⋯ menu, both for that parent; a child row offers neither', async () => {
    await renderSidebar()
    const parent = rowOf('Fix the login bug')
    const scope = (parent.closest('.thread-navigation-row') as HTMLElement | null) ?? parent
    fireEvent.click(within(scope).getByRole('button', { name: tt('sidebar.newParallel') }))
    expect(onCreateParallel).toHaveBeenCalledWith('a')
    onCreateParallel.mockReset()
    fireEvent.click(within(scope).getByRole('button', { name: tt('sidebar.actionsFor', { name: 'Fix the login bug' }) }))
    fireEvent.click(await screen.findByRole('menuitem', { name: tt('sidebar.newParallel') }))
    expect(onCreateParallel).toHaveBeenCalledWith('a')
    const child = rowOf('Try the cookie route')
    const childScope = (child.closest('.thread-navigation-row') as HTMLElement | null) ?? child
    expect(within(childScope).queryByRole('button', { name: tt('sidebar.newParallel') }), 'a child row has no +').toBeNull()
  })

  it('no keyboard shortcut creates a parallel chat, and its entries show none', async () => {
    expect(KEYBINDINGS.filter(binding => /parallel/i.test(String(binding.id))), 'no keybinding names a parallel chat').toEqual([])
    await renderSidebar()
    const plus = within(rowOf('Fix the login bug').closest('.thread-navigation-row') as HTMLElement ?? rowOf('Fix the login bug')).getByRole('button', { name: tt('sidebar.newParallel') })
    expect(plus.getAttribute('aria-keyshortcuts'), 'the + shows no shortcut').toBeNull()
    expect(said(plus), 'no chord in its name or title').not.toMatch(/ctrl|cmd|⌘|alt|shift/i)
  })
})
