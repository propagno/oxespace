// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-187, AG-05, CA-1 and CA-2; A23, A24). Written by the planner; the
// executor must not edit it. On main f65fa5374 a collapsed project (SidebarGroup) or section (ThreadSectionGroup) of the
// OxeChat sidebar hides what its conversations are doing: the person opens group by group to find who needs them.
// Contract:
// - src/components/Threads/threadGroupSignal.ts (new) exports dominantGroupSignal(threads, unreadIds): the src/ui
//   StatusSignal state of the most urgent child, in the brand's order (RN-1): "needs-you" (status approval) > "failed" >
//   "working" (threadNavigationStatus kind running, background work included) > "done" (a finished turn still unread);
//   null when nothing of that kind is there.
// - ThreadSidebar: a COLLAPSED project shows, left of its count, the StatusSignal ([data-ui=status-signal], data-state)
//   of dominantGroupSignal over its conversations, labelled with thread:status.*; an open project shows none. Its row's
//   accessible name says the project, how many conversations and the dominant state (new key
//   thread:sidebar.groupSummary, e.g. "cajui-infra, 4 conversas, 1 precisa de você"). A collapsed section
//   (ThreadSectionGroup) shows the same signal next to its count; an open one none.
// - At rest (every group open, the filter empty and not focused) the sidebar is OXC-1's (tests/oxe152/chat/oxc-1-sidebar).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { dominantGroupSignal } from '../../../src/components/Threads/threadGroupSignal'
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

function fixture(expanded: Record<string, boolean>, sectionCollapsed: boolean): void {
  const api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: PROJECTS, unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })), command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async (workspaceId: string) => workspaceId === 'thread:p2' ? { sections: [{ id: 'bugs', name: 'Bugs', order: 0, collapsed: sectionCollapsed }], assignments: { m1: 'bugs' } } : { sections: [], assignments: {} }),
    saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []), respondPending: vi.fn(async () => ({ ok: true })), sessions: vi.fn(async () => []), onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({ threads: THREADS, projects: PROJECTS, unavailableProjects: [], loading: false, listLoaded: true, selectedId: null, secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded, unreadIds: ['w4', 'm2'] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
}
const groupRow = (name: string): HTMLElement => {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-group"]')].filter(row => row.textContent?.includes(name))
  expect(rows, `one group row for ${name}`).toHaveLength(1)
  return rows[0]
}
const signalsIn = (element: Element): string[] => [...element.querySelectorAll('[data-ui="status-signal"]')].map(node => node.getAttribute('data-state') ?? '')
const sectionToggle = (): HTMLElement => document.querySelector<HTMLElement>('[data-section-id="bugs"] .thread-section-toggle')!
async function renderSidebar(): Promise<void> {
  render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
  await waitFor(() => expect(screen.getAllByText('mandacaru').length).toBeGreaterThan(0))
  await waitFor(() => expect(document.querySelector('[data-section-id="bugs"]')).not.toBeNull())
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-187 · AG-05 a collapsed group says who needs you', () => {
  test('collapsed project and section groups show highest-priority child StatusSignal while expanded groups show none', async () => {
    const byId = (...ids: string[]) => THREADS.filter(thread => ids.includes(thread.id))
    expect(dominantGroupSignal(byId('w1', 'w2', 'w3', 'w4'), ['w4'])).toBe('needs-you')
    expect(dominantGroupSignal(byId('w2', 'w3', 'w4'), ['w4'])).toBe('failed')
    expect(dominantGroupSignal(byId('w3', 'w4'), ['w4'])).toBe('working')
    expect(dominantGroupSignal(byId('w4'), ['w4'])).toBe('done')
    expect(dominantGroupSignal(byId('w4'), []), 'a finished turn already read').toBeNull()
    expect(dominantGroupSignal([], [])).toBeNull()

    fixture({ p1: false }, true)
    await renderSidebar()
    expect(signalsIn(groupRow('cajui-infra')), 'collapsed: the most urgent child').toEqual(['needs-you'])
    expect(groupRow('cajui-infra').querySelector('[data-ui="status-signal"]')).toHaveAttribute('aria-label', tt('status.attention'))
    expect(signalsIn(groupRow('mandacaru')), 'open: no inherited signal').toEqual([])
    expect(signalsIn(sectionToggle()), 'a collapsed section: its child failed').toEqual(['failed'])
    cleanup()
    resetSectionsForTests() // CR-33: the second render reads its own fixture, not the first render's cached sections

    fixture({ p1: true }, false)
    await renderSidebar()
    expect(signalsIn(groupRow('cajui-infra'))).toEqual([])
    expect(signalsIn(sectionToggle()), 'an open section: none').toEqual([])
  })

  test('collapsed group accessible name announces group name, count and dominant child status', async () => {
    await changeLanguage('pt-BR')
    fixture({ p1: false }, false)
    await renderSidebar()
    const name = groupRow('cajui-infra').getAttribute('aria-label') ?? ''
    expect(name).toContain('cajui-infra')
    expect(name).toMatch(/\b4\b/)
    expect(name.toLowerCase()).toContain(tt('status.attention').toLowerCase())
    expect(tt('sidebar.groupSummary'), 'thread:sidebar.groupSummary exists').not.toBe('sidebar.groupSummary')
    act(() => { useThreadStore.setState({ expanded: { p1: true } } as never) })
    await waitFor(() => expect(groupRow('cajui-infra').getAttribute('aria-label') ?? '').not.toContain(tt('status.attention')))
  })
})
