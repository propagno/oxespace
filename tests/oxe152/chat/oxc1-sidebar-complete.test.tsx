import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reduceThreadEvent } from '../../../electron/main/services/conversation/kernel/event-reducer'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { ThreadRail } from '../../../src/components/Threads/ThreadRail'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary, ThreadSnapshot } from '../../../shared/types/thread'

/**
 * OXE-166 · Remaining acceptance criteria proofs (CA-4, CA-5, CA-7, CA-8, CA-9) completing the
 * frozen OXC-1 contract in tests/oxe152/chat/oxc-1-sidebar.test.tsx.
 */
const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const SIDEBAR_CSS = readFileSync(join(ROOT, 'src/components/Threads/ThreadSidebar.module.css'), 'utf8')
const UI_SIDEBAR_CSS = readFileSync(join(ROOT, 'src/ui/Sidebar.module.css'), 'utf8')

const project = (projectId: string, displayName: string, hidden = false): ThreadProjectSummary => ({
  projectId, displayName, identityLabel: `/repos/${projectId}`, hidden, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }]
})
const conversation = (id: string, title: string, projectId: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `thread:${projectId}`, projectId, rootPath: `/repos/${projectId}`, provider: 'claude', title, pinned: false,
  status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 60_000, ...extra
} as ConversationThread)

function setupSidebar({
  threads,
  projects = [project('p1', 'Atlas')],
  selectedId = null,
  unreadIds = [],
  hiddenProjects = [],
  collapsed = false,
  onAddProject = vi.fn()
}: {
  threads: ConversationThread[]
  projects?: ThreadProjectSummary[]
  selectedId?: string | null
  unreadIds?: string[]
  hiddenProjects?: string[]
  collapsed?: boolean
  onAddProject?: ReturnType<typeof vi.fn>
}) {
  const api = {
    list: vi.fn(async () => threads),
    projects: vi.fn(async () => ({ projects, unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: threads.find(item => item.id === id)!, events: [] })),
    command: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })),
    saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []),
    respondPending: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async () => []),
    onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { app: { platform: 'win32' }, thread: api as unknown as ThreadApi } })
  useThreadStore.setState({
    threads, projects, unavailableProjects: [], loading: false, listLoaded: true, selectedId, secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects, expanded: { p1: true }, unreadIds
  } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: collapsed } })
  return render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={onAddProject} onOpenInCode={vi.fn(async () => undefined)} />)
}

const rowOf = (title: string): HTMLElement => {
  const rows = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
  const found = rows.filter(node => node.querySelector('[data-ui="row-title"]')?.textContent?.includes(title))
  expect(found, `one row for "${title}"`).toHaveLength(1)
  return found[0]
}

beforeEach(() => {
  localStorage.clear()
  resetSectionsForTests()
  useNavigationPrefs.setState({ width: 280, expanded: {}, stateFilter: { code: 'all', thread: 'all' } })
})
afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-166 · complete sidebar acceptance proofs', () => {
  it.each([
    ['en', 'Unconfirmed', 'Sign-in required', 'Read-only'],
    ['pt-BR', 'Não confirmado', 'Login necessário', 'Somente leitura']
  ])('CA-4 (%s): renders Unconfirmed, failure.title.*, and Read-only meta suffixes', async (locale, unconfirmedText, failureTitle, readOnlyText) => {
    await changeLanguage(locale)
    const threads = [
      conversation('u1', 'Interrupted sync', 'p1', {
        status: 'interrupted',
        providerObservation: { state: 'unknown', observedAt: Date.now(), source: 'unavailable', detail: 'restart' }
      }),
      conversation('f1', 'Auth expired', 'p1', { status: 'failed', lastFailureCode: 'authentication' }),
      conversation('r1', 'Audit codebase', 'p1', { status: 'idle', access: 'read-only' })
    ]
    setupSidebar({ threads })
    await waitFor(() => expect(screen.getByText('Interrupted sync')).toBeInTheDocument())

    expect(rowOf('Interrupted sync').querySelector('[data-ui="row-meta"]')).toHaveTextContent(unconfirmedText)
    expect(rowOf('Auth expired').querySelector('[data-ui="row-meta"]')).toHaveTextContent(failureTitle)
    expect(rowOf('Audit codebase').querySelector('[data-ui="row-meta"]')).toHaveTextContent(readOnlyText)
  })

  it('CA-4 (main reducer): records lastFailureCode on failed turns and clears it on success', () => {
    const snap: ThreadSnapshot = { thread: conversation('f2', 'Deploy', 'p1', { status: 'running' }), events: [], turns: [] }
    reduceThreadEvent(snap, { type: 'completed', status: 'failed', errorCode: 'usage', error: 'Quota' }, {
      now: () => 1000, invalidated: [], pendingRequestCount: () => 0, needsVerifiedDiff: false, needsCheckpoint: false
    })
    expect(snap.thread.lastFailureCode).toBe('usage')

    reduceThreadEvent(snap, { type: 'completed', status: 'completed' }, {
      now: () => 2000, invalidated: [], pendingRequestCount: () => 0, needsVerifiedDiff: false, needsCheckpoint: false
    })
    expect(snap.thread.lastFailureCode).toBeUndefined()
  })

  it('CA-5: unread title weight/marker, selected row background token, and focus ring token', async () => {
    const threads = [
      conversation('s1', 'Selected task', 'p1', { createdAt: 20 }),
      conversation('u1', 'Unread task', 'p1', { createdAt: 10 })
    ]
    setupSidebar({ threads, selectedId: 's1', unreadIds: ['u1'] })
    await waitFor(() => expect(screen.getByText('Selected task')).toBeInTheDocument())

    // Unread row carries unread class, accessible marker, and bold title CSS rule.
    const unreadRow = rowOf('Unread task')
    const unreadWrap = unreadRow.closest('.thread-navigation-row')!
    expect(unreadWrap.className).toContain('is-unread')
    expect(within(unreadRow).getByLabelText(tt('sidebar.unread'))).toHaveClass('thread-unread-marker')
    expect(SIDEBAR_CSS).toMatch(/\.unread\s+\.title\s*\{\s*font-weight:\s*var\(--weight-bold\)/)
    expect(SIDEBAR_CSS).toMatch(/\.unreadMark\s*\{[^}]*background:\s*var\(--accent\)/)

    // Selected row uses aria-current="page" and shared Sidebar.module.css var(--fill-selected) + var(--focus-ring).
    const selectedRow = rowOf('Selected task')
    expect(selectedRow).toHaveAttribute('aria-current', 'page')
    expect(UI_SIDEBAR_CSS).toMatch(/\.selected[^{]*\{[^}]*background:\s*var\(--fill-selected\)/)
    expect(UI_SIDEBAR_CSS).toMatch(/\.row:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/)
  })

  it('CA-7: exposes complete row menu and project menu items', async () => {
    const threads = [conversation('a1', 'Refactor router', 'p1')]
    setupSidebar({ threads, selectedId: 'a1' })
    await waitFor(() => expect(screen.getByText('Refactor router')).toBeInTheDocument())

    // Row menu via context menu on the row.
    fireEvent.contextMenu(rowOf('Refactor router'))
    const rowItems = (await screen.findAllByRole('menuitem')).map(node => node.textContent?.trim())
    expect(rowItems).toEqual(expect.arrayContaining([
      tt('sidebar.openToSide'),
      tt('sidebar.renameMenu'),
      tt('sidebar.pin'),
      tt('sections.moveTo'),
      tt('sidebar.markUnread'),
      tt('confirm.archive.confirm'),
      tt('confirm.delete.confirm')
    ]))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    // Project menu via its actions trigger.
    const projectMenuTrigger = document.querySelector<HTMLElement>('[data-project-actions="p1"]')!
    expect(projectMenuTrigger).toBeTruthy()
    fireEvent.pointerDown(projectMenuTrigger, { button: 0, ctrlKey: false })
    fireEvent.click(projectMenuTrigger)
    const projectItems = (await screen.findAllByRole('menuitem')).map(node => node.textContent?.trim())
    expect(projectItems).toEqual(expect.arrayContaining([
      tt('sidebar.projectSettings'),
      tt('sections.newSection'),
      tt('sidebar.openInCode'),
      tt('sidebar.removeProjectMenu')
    ]))
  })

  it('CA-8: shows the three sidebar empty states (addToStart, noMatches, restoreOrAdd)', async () => {
    // 1. No projects yet -> sidebar.addToStart
    setupSidebar({ threads: [], projects: [], hiddenProjects: [] })
    expect(screen.getByText(tt('sidebar.addToStart'))).toBeInTheDocument()
    cleanup()

    // 2. All projects removed/hidden -> sidebar.restoreOrAdd
    setupSidebar({ threads: [], projects: [project('p1', 'Atlas', true)], hiddenProjects: ['p1'] })
    expect(screen.getByText(tt('sidebar.restoreOrAdd'))).toBeInTheDocument()
    cleanup()

    // 3. Text filter matches nothing -> sidebar.noMatches
    setupSidebar({ threads: [conversation('a1', 'Refactor router', 'p1')], projects: [project('p1', 'Atlas')] })
    await waitFor(() => expect(screen.getByText('Refactor router')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('searchbox', { name: tt('sidebar.filter') }), { target: { value: 'zzz-no-hit' } })
    expect(screen.getByText(tt('sidebar.noMatches'))).toBeInTheDocument()
  })

  it('CA-9: collapsed ThreadRail renders 36 px targets with accessible names', () => {
    const onSelect = vi.fn(), onArchived = vi.fn()
    render(<ThreadRail
      conversations={[
        { id: 'c1', title: 'Deploy API', needsYou: true, current: true, status: 'attention' },
        { id: 'c2', title: 'Fix tests', needsYou: false, current: false, status: 'failed' }
      ]}
      onSelect={onSelect}
      onArchived={onArchived}
    />)

    const nav = screen.getByRole('navigation', { name: tt('sidebar.conversations') })
    const buttons = within(nav).getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName(tt('sidebar.railNeedsDecision', { name: 'Deploy API' }))
    expect(buttons[0]).toHaveAttribute('aria-current', 'page')
    expect(buttons[0]).toHaveStyle({ width: '36px', height: '36px', minWidth: '36px', minHeight: '36px' })
    expect(buttons[1]).toHaveAccessibleName('Fix tests')
    expect(buttons[1]).toHaveStyle({ width: '36px', height: '36px' })

    const archived = screen.getByRole('button', { name: tt('sidebar.archived') })
    expect(archived).toHaveStyle({ width: '36px', height: '36px' })
    fireEvent.click(buttons[1])
    expect(onSelect).toHaveBeenCalledWith('c2')
    fireEvent.click(archived)
    expect(onArchived).toHaveBeenCalledOnce()
  })

  it('OXE-350: keeps ThreadSidebar hidden without IPC when active=false and reveals it warm without remounting', async () => {
    let onChangedCb: ((event: { threadId?: string }) => void) | null = null
    let onPlacesCb: (() => void) | null = null
    const threads = [
      conversation('w1', 'Waiting approval', 'p1', { status: 'approval' }),
      conversation('i1', 'Warm thread', 'p1', { status: 'idle' })
    ]
    const api = {
      list: vi.fn(async () => threads),
      projects: vi.fn(async () => ({ projects: [project('p1', 'Atlas')], unavailable: [] })),
      read: vi.fn(async (id: string) => ({ thread: threads.find(item => item.id === id)!, events: [] })),
      command: vi.fn(async () => undefined),
      onChanged: vi.fn((cb: (event: { threadId?: string }) => void) => { onChangedCb = cb; return () => {} }),
      sections: vi.fn(async () => ({ sections: [], assignments: {} })),
      saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
      pendingRequestsAll: vi.fn(async () => []),
      respondPending: vi.fn(async () => ({ ok: true })),
      sessions: vi.fn(async () => []),
      onPlacesChanged: vi.fn((cb: () => void) => { onPlacesCb = cb; return () => {} })
    }
    Object.defineProperty(window, 'oxe', { configurable: true, value: { app: { platform: 'win32' }, thread: api as unknown as ThreadApi } })
    useThreadStore.setState({
      threads, projects: [project('p1', 'Atlas')], unavailableProjects: [], loading: false, listLoaded: true, selectedId: 'i1', secondaryId: null,
      snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: { p1: true }, unreadIds: []
    } as never)
    useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })

    const props = { onCreate: vi.fn(), onAccounts: vi.fn(), onAddProject: vi.fn(), onOpenInCode: vi.fn(async () => undefined) }
    const view = render(<ThreadSidebar active={false} {...props} />)
    const aside = document.querySelector('aside.thread-navigation') as HTMLElement
    expect(aside).toBeTruthy()
    expect(aside).toHaveStyle({ display: 'none' })
    expect(aside).toHaveAttribute('aria-hidden', 'true')
    expect(api.pendingRequestsAll).not.toHaveBeenCalled()
    expect(api.sessions).not.toHaveBeenCalled()

    // Revealing the sidebar flushes the initial dirty state and shows the same DOM node without remounting.
    view.rerender(<ThreadSidebar active {...props} />)
    expect(document.querySelector('aside.thread-navigation')).toBe(aside)
    expect(aside.style.display).toBe('')
    expect(aside).not.toHaveAttribute('aria-hidden')
    await waitFor(() => {
      expect(api.pendingRequestsAll).toHaveBeenCalledTimes(1)
      expect(api.sessions).toHaveBeenCalledTimes(1)
    })

    // Local filter state survives hide -> show, and a clean warm switch fires zero extra IPC.
    const filter = screen.getByRole('searchbox', { name: tt('sidebar.filter') }) as HTMLInputElement
    fireEvent.change(filter, { target: { value: 'Warm' } })
    expect(filter.value).toBe('Warm')

    view.rerender(<ThreadSidebar active={false} {...props} />)
    expect(aside).toHaveStyle({ display: 'none' })
    expect(aside).toHaveAttribute('aria-hidden', 'true')

    // Clean warm switch back: zero IPC and filter input state preserved.
    view.rerender(<ThreadSidebar active {...props} />)
    expect(document.querySelector('aside.thread-navigation')).toBe(aside)
    expect(filter.value).toBe('Warm')
    expect(api.pendingRequestsAll).toHaveBeenCalledTimes(1)
    expect(api.sessions).toHaveBeenCalledTimes(1)

    // Events arriving while hidden do not fire IPC until active flips back to true.
    view.rerender(<ThreadSidebar active={false} {...props} />)
    onChangedCb?.({ threadId: 'w1' })
    onPlacesCb?.()
    expect(api.pendingRequestsAll).toHaveBeenCalledTimes(1)
    expect(api.sessions).toHaveBeenCalledTimes(1)

    view.rerender(<ThreadSidebar active {...props} />)
    await waitFor(() => {
      expect(api.pendingRequestsAll).toHaveBeenCalledTimes(2)
      expect(api.sessions).toHaveBeenCalledTimes(2)
    })
  })
})
