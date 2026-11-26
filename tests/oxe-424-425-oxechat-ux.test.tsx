import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewConversationScreen } from '../src/components/Threads/NewConversationScreen'
import { ThreadSidebar } from '../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../src/components/Threads/sections/sectionsApi'
import { SidebarSection } from '../src/ui'
import { changeLanguage, i18n } from '../src/i18n'
import { useNavigationPrefs } from '../src/store/navigation-prefs.store'
import { useThreadStore } from '../src/store/thread.store'
import { useUIStore } from '../src/store/ui.store'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const project = (projectId: string, displayName: string, hidden = false): ThreadProjectSummary => ({
  projectId, displayName, identityLabel: `/repos/${projectId}`, hidden, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }]
})
const conversation = (id: string, title: string, projectId: string, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `thread:${projectId}`, projectId, rootPath: `/repos/${projectId}`, provider: 'claude', title, pinned: false,
  status: 'idle', nativeSessionId: null, createdAt: 100, updatedAt: Date.now() - 60_000, ...extra
} as ConversationThread)

function setupStore({
  projects,
  threads = [],
  hiddenProjects = []
}: {
  projects: ThreadProjectSummary[]
  threads?: ConversationThread[]
  hiddenProjects?: string[]
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
    onPlacesChanged: vi.fn(() => () => {}),
    setProjectHidden: vi.fn(async () => undefined),
    newConversationAccess: vi.fn(async () => 'full-access')
  }
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      app: { platform: 'win32' },
      thread: api as unknown as ThreadApi,
      agent: {
        getReadiness: vi.fn(async () => [
          { provider: 'claude', command: 'claude', status: 'ready' },
          { provider: 'codex', command: 'codex', status: 'ready' }
        ])
      }
    }
  })
  useThreadStore.setState({
    threads, projects, unavailableProjects: [], loading: false, listLoaded: true, selectedId: null, secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects, expanded: {}, unreadIds: []
  } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
  return api
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

describe('OXE-424 · Removed projects disclosure in OxeChat sidebar', () => {
  it('collapses Removed projects by default when active projects exist, expands on click, and restores cleanly', async () => {
    const api = setupStore({
      projects: [project('p1', 'Atlas'), project('p2', 'Legacy', true), project('p3', 'ArchiveLab', true)],
      threads: [conversation('t1', 'Ship release', 'p1')],
      hiddenProjects: ['p2', 'p3']
    })
    render(<ThreadSidebar onCreate={vi.fn()} onAddProject={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ship release')).toBeInTheDocument())

    const section = document.querySelector<HTMLElement>('[data-ui="thread-hidden-section"]')
    expect(section).not.toBeNull()
    const toggle = within(section!).getByRole('button', { name: `${tt('sidebar.removedProjects')} 2` })
    expect(toggle).toHaveAttribute('data-ui', 'sidebar-group')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(section!).queryByRole('button', { name: /Legacy/ })).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const restoreLegacy = within(section!).getByRole('button', { name: `Legacy ${tt('sidebar.restore')}` })
    expect(restoreLegacy).toBeVisible()

    fireEvent.click(restoreLegacy)
    await waitFor(() => expect(api.setProjectHidden).toHaveBeenCalledWith('p2', false))
    await waitFor(() => expect(useThreadStore.getState().hiddenProjects).toEqual(['p3']))
    // Still open while another removed project remains, and collapses on toggle click.
    const remainingToggle = within(section!).getByRole('button', { name: `${tt('sidebar.removedProjects')} 1` })
    expect(remainingToggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(remainingToggle)
    expect(remainingToggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('auto-opens Removed projects only when the search query matches a removed project', async () => {
    setupStore({
      projects: [project('p1', 'Atlas'), project('p2', 'LegacyApp', true)],
      threads: [conversation('t1', 'Ship release', 'p1')],
      hiddenProjects: ['p2']
    })
    render(<ThreadSidebar onCreate={vi.fn()} onAddProject={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Ship release')).toBeInTheDocument())

    const filter = screen.getByRole('searchbox', { name: tt('sidebar.filter') })
    fireEvent.change(filter, { target: { value: 'Legacy' } })
    const section = document.querySelector<HTMLElement>('[data-ui="thread-hidden-section"]')!
    expect(within(section).getByRole('button', { name: `${tt('sidebar.removedProjects')} 1` })).toHaveAttribute('aria-expanded', 'true')
    expect(within(section).getByRole('button', { name: `LegacyApp ${tt('sidebar.restore')}` })).toBeVisible()

    // Non-matching query hides the removed section instead of cluttering the empty search result.
    fireEvent.change(filter, { target: { value: 'does-not-match-anything' } })
    expect(document.querySelector('[data-ui="thread-hidden-section"]')).toBeNull()

    // Clearing the query returns Removed projects to its collapsed default.
    fireEvent.change(filter, { target: { value: '' } })
    const collapsed = document.querySelector<HTMLElement>('[data-ui="thread-hidden-section"]')!
    expect(within(collapsed).getByRole('button', { name: `${tt('sidebar.removedProjects')} 1` })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps Removed projects expanded when there are zero active projects so the empty-state restore hint works', () => {
    setupStore({
      projects: [project('p1', 'Atlas', true)],
      threads: [],
      hiddenProjects: ['p1']
    })
    render(<ThreadSidebar onCreate={vi.fn()} onAddProject={vi.fn()} />)

    expect(screen.getByText(tt('sidebar.restoreOrAdd'))).toBeInTheDocument()
    const section = document.querySelector<HTMLElement>('[data-ui="thread-hidden-section"]')!
    expect(within(section).getByRole('button', { name: `${tt('sidebar.removedProjects')} 1` })).toHaveAttribute('aria-expanded', 'true')
    expect(within(section).getByRole('button', { name: `Atlas ${tt('sidebar.restore')}` })).toBeVisible()
  })
})

describe('OXE-425 · Always-visible Add project and distinct new-conversation pickers', () => {
  it('SidebarSection keeps hover-reveal by default and supports alwaysShowAction without hover hiding', () => {
    const { container } = render(<>
      <SidebarSection label="HiddenOnIdle" action={<span>A1</span>} />
      <SidebarSection label="AlwaysShown" alwaysShowAction action={<span>A2</span>} />
    </>)
    const [hiddenSection, visibleSection] = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-section"]')]
    expect(hiddenSection.querySelector('[data-always-visible="true"]')).toBeNull()
    expect(hiddenSection.lastElementChild?.className).toMatch(/reveal/)
    expect(visibleSection.querySelector('[data-always-visible="true"]')).not.toBeNull()
    expect(visibleSection.lastElementChild?.className).not.toMatch(/reveal/)
  })

  it('keeps the Add project action beside Projects always visible in ThreadSidebar', async () => {
    setupStore({
      projects: [project('p1', 'Atlas')],
      threads: [conversation('t1', 'Ship release', 'p1')]
    })
    const onAddProject = vi.fn()
    render(<ThreadSidebar onCreate={vi.fn()} onAddProject={onAddProject} />)
    await waitFor(() => expect(screen.getByText('Ship release')).toBeInTheDocument())

    const projectsSection = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-section"]')]
      .find(node => node.textContent?.includes(tt('sidebar.projects')))!
    const actionWrap = projectsSection.querySelector<HTMLElement>('[data-always-visible="true"]')
    expect(actionWrap).not.toBeNull()
    expect(actionWrap!.className).not.toMatch(/reveal/)

    const addButton = within(actionWrap!).getByRole('button', { name: tt('sidebar.addProject') })
    expect(addButton).toHaveAttribute('data-ui', 'icon-button')
    fireEvent.click(addButton)
    expect(onAddProject).toHaveBeenCalledTimes(1)
  })

  it('gives NewConversationScreen distinct affordances for select dropdowns, worktree switch, and read-only status', async () => {
    setupStore({ projects: [project('p1', 'Atlas'), project('p2', 'Bora')] })
    const onAddProject = vi.fn()
    render(<NewConversationScreen projectId="p1" onAddProject={onAddProject} />)

    const group = screen.getByRole('group', { name: tt('opening.context') })
    const controls = [...group.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
    expect(controls).toHaveLength(4)
    expect(controls.map(el => el.getAttribute('data-picker-kind'))).toEqual(['select', 'select', 'toggle', 'status'])

    // Project and Agent dropdown triggers each carry a leading icon and a trailing dropdown chevron.
    expect(controls[0].querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
    expect(controls[1].querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)

    // Worktree control is an explicit toggle switch with an off/on indicator.
    expect(controls[2]).toHaveAttribute('role', 'switch')
    expect(controls[2]).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(controls[2])
    expect(controls[2]).toHaveAttribute('aria-checked', 'true')

    // Access level is a quiet non-interactive status tag (not a button).
    expect(controls[3].tagName).toBe('SPAN')
    expect(controls[3]).not.toHaveAttribute('role')
    await waitFor(() => expect(controls[3]).toHaveTextContent(tt('opening.access.full-access')))

    // Project picker popover shows a no-match fallback and a prominent Add project action.
    const user = userEvent.setup()
    await user.click(controls[0])
    const filter = screen.getByRole('textbox', { name: tt('dialogs.filterProjects') })
    fireEvent.change(filter, { target: { value: 'zzzz-none' } })
    expect(screen.getByText(tt('dialogs.noProjectMatch'))).toBeVisible()
    const addBtn = screen.getByRole('button', { name: tt('dialogs.add') })
    expect(addBtn).toHaveAttribute('data-ui', 'button')
    await user.click(addBtn)
    expect(onAddProject).toHaveBeenCalledTimes(1)

    // Zero raw <button> elements anywhere in NewConversationScreen.
    const rawButtons = [...document.querySelectorAll('button')].filter(btn => !btn.hasAttribute('data-ui'))
    expect(rawButtons).toEqual([])

    // Composer footer renders a quiet keyboard hint alongside the send button.
    const composerHint = document.querySelector<HTMLElement>('[data-ui="composer-hint"]')
    expect(composerHint).not.toBeNull()
    expect(composerHint).toHaveTextContent(`Enter`)
    expect(composerHint).toHaveTextContent(tt('opening.hintSend'))
    expect(composerHint).toHaveTextContent(`Shift+Enter`)
    expect(composerHint).toHaveTextContent(tt('opening.hintNewLine'))

    // CSS keeps cohesive solid control pills, high-contrast OFF/ON toggle track, subtle read-only status tag,
    // and single-ring composer focus with no raw browser resize handle (OXE-438).
    const css = readFileSync(join(ROOT, 'src/components/Threads/NewConversationScreen.module.css'), 'utf8')
    expect(css).toMatch(/\.pickers\s+\.statusTag\s*\{[^}]*border:\s*1px solid var\(--bd-subtle\)[^}]*background:\s*var\(--surface-sunken\)[^}]*cursor:\s*default/)
    expect(css).toMatch(/\.pickers\s+\.togglePicker\s*\{[^}]*border:\s*1px solid var\(--bd-control\)[^}]*background:\s*var\(--surface-raised\)/)
    expect(css).not.toMatch(/\.togglePicker[^{]*\{[^}]*dashed/)
    expect(css).toMatch(/\.toggleTrack\s*\{[^}]*background:\s*var\(--surface-sunken\)[^}]*var\(--bd-strong\)/)
    expect(css).toMatch(/\.toggleThumb\s*\{[^}]*background:\s*var\(--tx-secondary\)/)
    expect(css).toMatch(/\.message\s*\{[^}]*resize:\s*none/)
    expect(css).toMatch(/\.message:focus,\s*\.message:focus-visible\s*\{[^}]*outline:\s*none[^}]*box-shadow:\s*none/)
    expect(css).toMatch(/\.composer:focus-within\s*\{[^}]*border-color:\s*var\(--accent-border\)[^}]*box-shadow:/)
  })

  it('omits the project dropdown chevron when locked in parallel mode', () => {
    setupStore({
      projects: [project('p1', 'Atlas')],
      threads: [conversation('parent-1', 'Main session', 'p1')]
    })
    render(<NewConversationScreen projectId="p1" parentThreadId="parent-1" />)
    const group = screen.getByRole('group', { name: tt('opening.context') })
    const [projectPicker, , lockedWorktree] = [...group.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
    expect(projectPicker).toBeDisabled()
    expect(projectPicker.querySelectorAll('svg')).toHaveLength(1)
    expect(lockedWorktree).toHaveAttribute('data-picker-kind', 'status')
    expect(lockedWorktree).toHaveAttribute('data-locked', 'true')
  })
})
