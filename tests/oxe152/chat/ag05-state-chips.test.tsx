// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-187, AG-05, CA-3 and CA-4; A25, A26). Written by the planner; the
// executor must not edit it. On main f65fa5374 the OxeChat sidebar filter ("Filtrar conversas", SidebarFilter) matches
// text only: there is no way to list just the conversations that need you, are working, failed or are unread.
// Contract:
// - Empty and not focused, the filter has no strip under it (BRD-02 heights unchanged). Focused, or while a chip is on,
//   a strip [data-ui=thread-state-chips] appears, one row tall: the rule .stateChips of
//   src/components/Threads/ThreadSidebar.module.css declares height: var(--row-1) (28 px compact, 32 px comfortable).
// - Its chips are src/ui Buttons ([data-ui=button]) with aria-pressed, in this order: thread:status.attention,
//   thread:status.running, thread:status.failed, then thread:sidebar.filterUnread (new: "Não lidas" / "Unread"; thread:sidebar.unread is the row marker's "Conversa não lida"), a condition
//   and not a state: last, with no StatusSignal (RN-2). One chip at a time; pressing it again turns it off.
// - A chip on lists only the conversations that match it (threadGroupSignal.ts exports
//   matchesStateFilter(thread, filter, unreadIds), filter "needs-you" | "working" | "failed" | "unread"), and opens the
//   projects and sections that have one while it lasts, without changing what the person had collapsed (the store's
//   `expanded`); turning it off brings the previous view back.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { matchesStateFilter } from '../../../src/components/Threads/threadGroupSignal'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string
const project = (projectId: string, displayName: string): ThreadProjectSummary => ({ projectId, displayName, identityLabel: `/repos/${projectId}`, hidden: false, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }] })
const conversation = (id: string, title: string, projectId: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `thread:${projectId}`, projectId, rootPath: `/repos/${projectId}`, provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 60_000, ...extra
} as ConversationThread)
const THREADS = [
  conversation('w1', 'Rotate the keys', 'p1', { status: 'approval', createdAt: 90 }),
  conversation('w2', 'Broken deploy', 'p1', { status: 'failed', lastTurnStatus: 'failed', createdAt: 80 }),
  conversation('w3', 'Index the logs', 'p1', { status: 'running', createdAt: 70 }),
  conversation('w4', 'Write the runbook', 'p1', { lastTurnStatus: 'completed', createdAt: 60 }),
  conversation('m1', 'Flaky test', 'p2', { status: 'failed', lastTurnStatus: 'failed', createdAt: 50 }),
  conversation('m2', 'Release notes', 'p2', { lastTurnStatus: 'completed', createdAt: 40 })
]
const PROJECTS = [project('p1', 'cajui-infra'), project('p2', 'mandacaru')]
const MODULE_CSS = readFileSync(join(process.cwd(), 'src/components/Threads/ThreadSidebar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

beforeEach(() => {
  localStorage.clear(); resetSectionsForTests()
  const api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: PROJECTS, unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })), command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []), respondPending: vi.fn(async () => ({ ok: true })), sessions: vi.fn(async () => []), onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({ threads: THREADS, projects: PROJECTS, unavailableProjects: [], loading: false, listLoaded: true, selectedId: null, secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: { p1: false }, unreadIds: ['w4', 'm2'] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

const filter = (): HTMLElement => screen.getByRole('searchbox', { name: tt('sidebar.filter') })
const strip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-ui="thread-state-chips"]')
const shownTitles = (): string[] => [...document.querySelectorAll('[data-ui="sidebar-row"] [data-ui="row-title"]')].map(node => node.textContent ?? '').sort()
async function renderSidebar(): Promise<void> {
  render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
  await waitFor(() => expect(screen.getAllByText('mandacaru').length).toBeGreaterThan(0))
}

describe('OXE-187 · AG-05 filter by state', () => {
  test('filter chips strip stays hidden at rest and appears at --row-1 height on focus with aria-pressed order', async () => {
    const rule = [...MODULE_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => match[1].split(',').some(part => /\.stateChips\b/.test(part)) && /(?:^|;)\s*height\s*:\s*var\(--row-1\)/.test(match[2]))
    expect(rule, '.stateChips { height: var(--row-1) } in ThreadSidebar.module.css').toBeDefined()
    expect(tt('sidebar.filterUnread'), 'thread:sidebar.filterUnread exists').not.toBe('sidebar.filterUnread')
    await renderSidebar()
    expect(strip(), 'at rest: no strip').toBeNull()
    act(() => { filter().focus(); fireEvent.focus(filter()) })
    await waitFor(() => expect(strip()).not.toBeNull())
    const chips = within(strip()!).getAllByRole('button')
    expect(chips.map(chip => chip.textContent?.trim())).toEqual([tt('status.attention'), tt('status.running'), tt('status.failed'), tt('sidebar.filterUnread')])
    for (const chip of chips) {
      expect(chip).toHaveAttribute('data-ui', 'button')
      expect(chip).toHaveAttribute('aria-pressed', 'false')
    }
    expect(chips[3].querySelector('[data-ui="status-signal"]'), 'Unread is a condition: no signal').toBeNull()
    act(() => { fireEvent.blur(filter()); filter().blur() })
    await waitFor(() => expect(strip(), 'blurred with no chip on: gone').toBeNull())
  })

  test('active state chip filters conversations and temporarily expands matching groups before restoring previous state', async () => {
    const byId = (id: string) => THREADS.find(thread => thread.id === id)!
    expect(matchesStateFilter(byId('w1'), 'needs-you', [])).toBe(true)
    expect(matchesStateFilter(byId('w3'), 'working', [])).toBe(true)
    expect(matchesStateFilter(byId('m1'), 'failed', [])).toBe(true)
    expect(matchesStateFilter(byId('w4'), 'unread', ['w4'])).toBe(true)
    expect(matchesStateFilter(byId('w4'), 'needs-you', ['w4'])).toBe(false)

    await renderSidebar()
    const before = shownTitles()
    expect(before, 'p1 is collapsed: its conversations are hidden').not.toContain('Rotate the keys')
    act(() => { filter().focus(); fireEvent.focus(filter()) })
    await waitFor(() => expect(strip()).not.toBeNull())
    const chip = (label: string) => within(strip()!).getByRole('button', { name: label })
    await act(async () => { fireEvent.click(chip(tt('status.attention'))) })
    expect(chip(tt('status.attention'))).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(shownTitles()).toEqual(['Rotate the keys']))
    expect(useThreadStore.getState().expanded.p1, 'what the person collapsed is kept').toBe(false)
    // One chip at a time.
    await act(async () => { fireEvent.click(chip(tt('sidebar.filterUnread'))) })
    expect(chip(tt('status.attention'))).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(shownTitles()).toEqual(['Release notes', 'Write the runbook']))
    await act(async () => { fireEvent.click(chip(tt('status.failed'))) })
    await waitFor(() => expect(shownTitles()).toEqual(['Broken deploy', 'Flaky test']))
    // Off again: the previous view, p1 collapsed.
    await act(async () => { fireEvent.click(chip(tt('status.failed'))) })
    await waitFor(() => expect(shownTitles()).toEqual(before))
  })
})
