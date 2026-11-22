// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-188, AG-06, CA-3 and CA-4; A19, A20). Written by the planner; the
// executor must not edit it. On main f65fa5374 the active cell of the side-by-side view is only an inner box-shadow
// (.thread-cell.is-active), both titles look the same, and a click on a conversation in the sidebar always replaces the
// left column (ThreadSidebar → select), even when the person is working in the right one.
// Contract:
// - ThreadView.css, split mode only (.thread-grid.is-split): the active cell (.thread-cell.is-active) shows a 2px
//   var(--accent) bar at the top of its header (border-top or an inset box-shadow of 2px), its title
//   (.thread-heading-title-main, present on main and in OxeChat F5's header) in var(--tx-primary); the other cell's title
//   (.thread-cell:not(.is-active)) in var(--tx-secondary). One conversation alone looks as today.
// - src/store/thread.store.ts: openInActiveCell(id): side by side with the right cell active, the conversation replaces
//   the right cell (secondaryId = id; the left one stays); with the left cell active, or with one conversation, it is
//   select(id). A click on the conversation already in the other cell makes that cell active. ThreadSidebar's row
//   (onSelect) calls openInActiveCell; "Abrir lado a lado" (openSecondary) keeps opening the other column.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const CSS = readFileSync(join(process.cwd(), 'src/components/Threads/ThreadView.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = (): Array<{ selector: string; body: string }> => [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }))
const decl = (body: string, property: string): string | undefined => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim()

const project = (projectId: string, displayName: string): ThreadProjectSummary => ({ projectId, displayName, identityLabel: `/repos/${projectId}`, hidden: false, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }] })
const conversation = (id: string, title: string, createdAt: number): ConversationThread => ({
  id, workspaceId: 'thread:p1', projectId: 'p1', rootPath: '/repos/p1', provider: 'claude', title, pinned: false, status: 'idle', nativeSessionId: null, createdAt, updatedAt: Date.now() - 60_000
} as ConversationThread)
const THREADS = [conversation('a', 'Alpha work', 50), conversation('b', 'Beta review', 40), conversation('c', 'Gamma fix', 30), conversation('d', 'Delta spike', 20), conversation('e', 'Epsilon notes', 10)]

beforeEach(() => {
  localStorage.clear(); resetSectionsForTests()
  const api = {
    list: vi.fn(async () => THREADS), projects: vi.fn(async () => ({ projects: [project('p1', 'Atlas')], unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: THREADS.find(item => item.id === id)!, events: [] })), command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []), respondPending: vi.fn(async () => ({ ok: true })), sessions: vi.fn(async () => []), onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
  useThreadStore.setState({ threads: THREADS, projects: [project('p1', 'Atlas')], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'a', secondaryId: 'b', activeCell: 'secondary',
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

const rowOf = (title: string): HTMLElement => {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')].filter(row => row.textContent?.includes(title))
  expect(rows, `one row for ${title}`).toHaveLength(1)
  return rows[0]
}

describe('OXE-188 · AG-06 the active column', () => {
  test('active column renders 2 px --accent header bar and --tx-primary title while inactive uses --tx-secondary', () => {
    const split = rules().filter(rule => rule.selector.split(',').some(part => part.includes('.is-split') && part.includes('.thread-cell')))
    const bar = split.filter(rule => /\.thread-cell\.is-active/.test(rule.selector) && /2px/.test(rule.body) && /var\(--accent\)/.test(rule.body) && /border-top|box-shadow/.test(rule.body))
    expect(bar.length, 'a 2px --accent bar on the active cell, split mode only').toBeGreaterThan(0)
    const title = (active: boolean) => split.filter(rule => rule.selector.split(',').some(part => part.includes(active ? '.thread-cell.is-active' : '.thread-cell:not(.is-active)') && part.includes('.thread-heading-title-main')))
    expect(title(true).map(rule => decl(rule.body, 'color')), 'the active title').toContain('var(--tx-primary)')
    expect(title(false).map(rule => decl(rule.body, 'color')), 'the other title').toContain('var(--tx-secondary)')
    // No legacy names: the generated short tokens (#845).
    for (const rule of [...bar, ...title(true), ...title(false)]) expect(rule.body).not.toMatch(/--text-(primary|secondary)/)
  })

  test('sidebar click replaces the active column while Open to the side targets the other column', async () => {
    render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
    await waitFor(() => expect(screen.getAllByText('Gamma fix').length).toBeGreaterThan(0))
    // The right cell is active: the clicked conversation replaces it, the left one stays.
    await act(async () => { fireEvent.click(rowOf('Gamma fix')) })
    await waitFor(() => expect(useThreadStore.getState().secondaryId).toBe('c'))
    expect(useThreadStore.getState().selectedId).toBe('a')
    expect(useThreadStore.getState().activeCell).toBe('secondary')
    // The left cell active: a click replaces the left one.
    act(() => { useThreadStore.getState().setActiveCell('primary') })
    await act(async () => { fireEvent.click(rowOf('Delta spike')) })
    await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('d'))
    expect(useThreadStore.getState().secondaryId).toBe('c')
    // Open side by side still targets the other column.
    act(() => { useThreadStore.getState().setActiveCell('primary') })
    const side = within(rowOf('Epsilon notes').closest('[data-thread-row]') as HTMLElement ?? rowOf('Epsilon notes').parentElement!).getByRole('button', { name: tt('sidebar.openSideNamed', { name: 'Epsilon notes' }) })
    await act(async () => { fireEvent.click(side) })
    await waitFor(() => expect(useThreadStore.getState().secondaryId).toBe('e'))
    expect(useThreadStore.getState().selectedId).toBe('d')
  })
})
