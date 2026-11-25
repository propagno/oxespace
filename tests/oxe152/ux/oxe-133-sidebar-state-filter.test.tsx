import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { changeLanguage } from '../../../src/i18n'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'

// OXE-133 (OxeCode part): under the sidebar filter, a state selector (All, Needs you, Working) narrows the terminal
// rows and the workspaces that hold them; it combines with the text filter and is saved per surface.

vi.mock('../../../src/hooks/useGitBranch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/hooks/useGitBranch')>()
  return { ...actual, useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }
})

const pane = (id: string, workspaceId: string, columnIndex: number, displayName: string): WorkspacePane => ({
  id, workspaceId, type: 'terminal', rowIndex: 0, columnIndex, shellProfileId: 'builtin-claude', status: 'idle',
  agentProfileId: null, agentName: null, displayName, createdAt: null, rootPath: null
} as WorkspacePane)
const workspace = (id: string, name: string, panes: WorkspacePane[]): Workspace => ({
  id, name, rootPath: `C:/repos/${id}`, layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: id === 'atlas', color: 2, panes
} as unknown as Workspace)

// atlas: one terminal that needs you, one working; borealis: one idle; cygnus: one working.
const WORKSPACES = [
  workspace('atlas', 'Atlas', [pane('atlas-ask', 'atlas', 0, 'Reviewer'), pane('atlas-run', 'atlas', 1, 'Builder')]),
  workspace('borealis', 'Borealis', [pane('borealis-idle', 'borealis', 0, 'Shell')]),
  workspace('cygnus', 'Cygnus', [pane('cygnus-run', 'cygnus', 0, 'Indexer')])
]
const running = (agentState: 'blocked' | 'working' | 'idle') => ({ status: 'running', agentState, agentSource: 'hook', error: null })

const actions = { onNewWorkspace: vi.fn(), onDelegations: vi.fn(), onOpenSearch: vi.fn(), onSelectWorkspace: vi.fn(), onCloseWorkspace: vi.fn(), onToggleCollapse: vi.fn() }
function renderSidebar() {
  return render(<Sidebar workspaces={WORKSPACES} activeWorkspaceId="atlas" appVersion="1.5.3" isCollapsed={false} integrationGroups={[]} panelMenu={[{ label: 'Changes', onSelect: () => undefined }] as never} {...actions} />)
}
const states = () => screen.getByRole('radiogroup', { name: 'Show' })
const option = (name: RegExp) => within(states()).getByRole('radio', { name })
const groups = (root: HTMLElement) => [...root.querySelectorAll('[data-ui="sidebar-group"]')].map(node => node.textContent ?? '')
const rows = (root: HTMLElement) => [...root.querySelectorAll('[data-pane-row], [data-ui="sidebar-row"]')].map(node => node.textContent ?? '')

describe('OXE-133 · OxeCode sidebar state filter', () => {
  beforeEach(() => {
    __resetGitBranchCacheForTests()
    localStorage.removeItem('oxe.navigation')
    useNavigationPrefs.setState({ width: 280, expanded: { atlas: true, borealis: true, cygnus: true }, stateFilter: { code: 'all', thread: 'all' } })
    useTerminalStore.setState({ panes: { 'atlas-ask': running('blocked'), 'atlas-run': running('working'), 'borealis-idle': running('idle'), 'cygnus-run': running('working') }, pendingCommands: {}, activePaneId: null } as never)
    useUIStore.setState({ activePaneId: null, isSidebarCollapsed: false, collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false } })
    Object.defineProperty(window, 'oxe', { configurable: true, value: {
      app: { platform: 'win32' }, terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) },
      workspace: { closePane: vi.fn(async () => undefined) }, git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
    } })
  })
  afterEach(async () => {
    cleanup()
    await changeLanguage('en')
  })

  it('seletor de estado: a radiogroup under the filter, All by default, each option with its count', () => {
    const { container } = renderSidebar()
    const filter = container.querySelector('[data-ui="sidebar-filter"]')!
    expect(filter.compareDocumentPosition(states()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')
    expect(option(/^All/)).toHaveTextContent('4')
    expect(option(/^Needs you/)).toHaveTextContent('1')
    expect(option(/^Working/)).toHaveTextContent('2')
  })

  it('filtra linhas e grupos: Needs you shows only its rows and the workspaces holding them', () => {
    const { container } = renderSidebar()
    fireEvent.click(option(/^Needs you/))
    expect(groups(container)).toEqual([expect.stringContaining('Atlas')])
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0]).toContain('Reviewer')
    fireEvent.click(option(/^Working/))
    expect(groups(container).map(text => text.match(/Atlas|Cygnus/)?.[0])).toEqual(['Atlas', 'Cygnus'])
    expect(rows(container).join(' ')).toMatch(/Builder[\s\S]*Indexer/)
    expect(rows(container).join(' ')).not.toContain('Reviewer')
  })

  it('texto E estado: both filters combine; clearing both brings back the whole list', () => {
    const { container } = renderSidebar()
    fireEvent.click(option(/^Working/))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter workspaces' }), { target: { value: 'cygnus' } })
    expect(groups(container).map(text => text.match(/Atlas|Borealis|Cygnus/)?.[0])).toEqual(['Cygnus'])
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter workspaces' }), { target: { value: '' } })
    fireEvent.click(option(/^All/))
    expect(groups(container)).toHaveLength(3)
    expect(rows(container)).toHaveLength(4)
  })

  it('salvo por superfície: the choice is kept for OxeCode, apart from OxeChat, across a restart', async () => {
    renderSidebar()
    fireEvent.click(option(/^Needs you/))
    expect(useNavigationPrefs.getState().stateFilter).toEqual({ code: 'needs-you', thread: 'all' })
    const raw = localStorage.getItem('oxe.navigation') ?? '{}'
    const saved = JSON.parse(raw) as { state?: { stateFilter?: unknown } }
    expect(saved.state?.stateFilter).toEqual({ code: 'needs-you', thread: 'all' })
    // A restart: a fresh store (back to All, which persist writes too), then what was saved is read back.
    useNavigationPrefs.setState({ stateFilter: { code: 'all', thread: 'all' } })
    localStorage.setItem('oxe.navigation', raw)
    await act(async () => { await useNavigationPrefs.persist.rehydrate() })
    expect(useNavigationPrefs.getState().stateFilter.code).toBe('needs-you')
  })

  it('vazio do filtro: nothing in that state says so and offers Show all', () => {
    useTerminalStore.setState({ panes: { 'atlas-ask': running('idle'), 'atlas-run': running('idle'), 'borealis-idle': running('idle'), 'cygnus-run': running('idle') } } as never)
    renderSidebar()
    fireEvent.click(option(/^Needs you/))
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')
  })

  it('vazio do filtro in pt-BR: "Nada precisa de você agora" and "Mostrar todos"', async () => {
    await changeLanguage('pt-BR')
    useTerminalStore.setState({ panes: { 'atlas-ask': running('idle'), 'atlas-run': running('idle'), 'borealis-idle': running('idle'), 'cygnus-run': running('idle') } } as never)
    renderSidebar()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Mostrar' })).getByRole('radio', { name: /^Precisa de você/ }))
    expect(screen.getByText('Nada precisa de você agora')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar todos' })).toBeInTheDocument()
  })

  it('teclado: arrows change the option; Escape in the text filter clears the text first, then the state', () => {
    renderSidebar()
    const all = option(/^All/)
    all.focus()
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(option(/^Needs you/)).toHaveAttribute('aria-checked', 'true')
    const search = screen.getByRole('searchbox', { name: 'Filter workspaces' })
    fireEvent.change(search, { target: { value: 'atlas' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(option(/^Needs you/)).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')
  })
})

const threadProject = (projectId: string, displayName: string): ThreadProjectSummary => ({
  projectId, displayName, identityLabel: `/repos/${projectId}`, hidden: false, contexts: [{ rootPath: `/repos/${projectId}`, label: displayName }]
})
const threadRow = (id: string, title: string, projectId: string, status: ConversationThread['status'], createdAt: number): ConversationThread => ({
  id, workspaceId: `thread:${projectId}`, projectId, rootPath: `/repos/${projectId}`, provider: 'claude', title, pinned: false, status,
  nativeSessionId: null, createdAt, updatedAt: Date.now() - 60_000
} as ConversationThread)

const CHAT_PROJECTS = [threadProject('atlas', 'Atlas'), threadProject('borealis', 'Borealis'), threadProject('cygnus', 'Cygnus')]
const CHAT_THREADS = [
  threadRow('t-ask', 'Approve migration', 'atlas', 'approval', 40),
  threadRow('t-run-a', 'Build release', 'atlas', 'running', 30),
  threadRow('t-idle', 'Check notes', 'borealis', 'idle', 20),
  threadRow('t-run-c', 'Index docs', 'cygnus', 'running', 10)
]

function mountChatSidebar(threads: ConversationThread[] = CHAT_THREADS) {
  const api = {
    list: vi.fn(async () => threads), projects: vi.fn(async () => ({ projects: CHAT_PROJECTS, unavailable: [] })),
    read: vi.fn(async (id: string) => ({ thread: threads.find(item => item.id === id)!, events: [] })),
    command: vi.fn(async () => undefined), onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })), saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
    pendingRequestsAll: vi.fn(async () => []), respondPending: vi.fn(async () => ({ ok: true })),
    sessions: vi.fn(async () => []), onPlacesChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { app: { platform: 'win32' }, thread: api as unknown as ThreadApi } })
  useThreadStore.setState({
    threads, projects: CHAT_PROJECTS, unavailableProjects: [], loading: false, listLoaded: true, selectedId: null, secondaryId: null,
    snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: { atlas: true, borealis: true, cygnus: true }, unreadIds: []
  } as never)
  useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
  return render(<ThreadSidebar onCreate={vi.fn()} onAccounts={vi.fn()} onAddProject={vi.fn()} onOpenInCode={vi.fn(async () => undefined)} />)
}

describe('OXE-133 · OxeChat sidebar state filter', () => {
  beforeEach(() => {
    localStorage.clear()
    resetSectionsForTests()
    useNavigationPrefs.setState({ width: 280, expanded: {}, stateFilter: { code: 'all', thread: 'all' } })
  })
  afterEach(async () => {
    cleanup()
    await changeLanguage('en')
  })

  it('CA-1: radiogroup under sidebar-filter, All by default, each option with its count and zero raw buttons', async () => {
    const { container } = mountChatSidebar()
    await waitFor(() => expect(groups(container)).toHaveLength(3))
    const filter = container.querySelector('[data-ui="sidebar-filter"]')!
    expect(filter.compareDocumentPosition(states()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')
    expect(option(/^All/)).toHaveTextContent('4')
    expect(option(/^Needs you/)).toHaveTextContent('1')
    expect(option(/^Working/)).toHaveTextContent('2')
    const raw = [...container.querySelectorAll('button')].filter(button => !button.hasAttribute('data-ui'))
    expect(raw).toEqual([])
  })

  it('CA-2: filters sidebar-row and hides empty sidebar-groups for Needs you and Working', async () => {
    const { container } = mountChatSidebar()
    await waitFor(() => expect(rows(container)).toHaveLength(4))
    fireEvent.click(option(/^Needs you/))
    expect(groups(container)).toEqual([expect.stringContaining('Atlas')])
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0]).toContain('Approve migration')

    fireEvent.click(option(/^Working/))
    expect(groups(container).map(text => text.match(/Atlas|Cygnus/)?.[0])).toEqual(['Atlas', 'Cygnus'])
    expect(rows(container).join(' ')).toMatch(/Build release[\s\S]*Index docs/)
    expect(rows(container).join(' ')).not.toContain('Approve migration')
  })

  it('CA-3: combines with text filter (logical AND) and clearing both restores the full list', async () => {
    const { container } = mountChatSidebar()
    await waitFor(() => expect(rows(container)).toHaveLength(4))
    fireEvent.click(option(/^Working/))
    const search = screen.getByRole('searchbox', { name: 'Filter conversations' })
    fireEvent.change(search, { target: { value: 'cygnus' } })
    expect(groups(container).map(text => text.match(/Atlas|Borealis|Cygnus/)?.[0])).toEqual(['Cygnus'])
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0]).toContain('Index docs')

    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(option(/^All/))
    expect(groups(container)).toHaveLength(3)
    expect(rows(container)).toHaveLength(4)
  })

  it('CA-4: persists OxeChat state filter separately from OxeCode across rehydrate/restart', async () => {
    mountChatSidebar()
    fireEvent.click(option(/^Needs you/))
    expect(useNavigationPrefs.getState().stateFilter).toEqual({ code: 'all', thread: 'needs-you' })
    const raw = localStorage.getItem('oxe.navigation') ?? '{}'
    const saved = JSON.parse(raw) as { state?: { stateFilter?: unknown } }
    expect(saved.state?.stateFilter).toEqual({ code: 'all', thread: 'needs-you' })

    useNavigationPrefs.setState({ stateFilter: { code: 'working', thread: 'all' } })
    localStorage.setItem('oxe.navigation', raw)
    await act(async () => { await useNavigationPrefs.persist.rehydrate() })
    expect(useNavigationPrefs.getState().stateFilter).toEqual({ code: 'all', thread: 'needs-you' })
  })

  it('CA-5: empty state when filtered by Needs you in en and pt-BR offers Show all / Mostrar todos', async () => {
    const idleOnly = CHAT_THREADS.map(item => ({ ...item, status: 'idle' as const }))
    mountChatSidebar(idleOnly)
    fireEvent.click(option(/^Needs you/))
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')

    cleanup()
    await changeLanguage('pt-BR')
    mountChatSidebar(idleOnly)
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Mostrar' })).getByRole('radio', { name: /^Precisa de você/ }))
    expect(screen.getByText('Nada precisa de você agora')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mostrar todos' })).toBeInTheDocument()
  })

  it('CA-6: arrow keys switch option; Escape in text filter clears text first, then resets state filter', async () => {
    mountChatSidebar()
    const all = option(/^All/)
    all.focus()
    fireEvent.keyDown(all, { key: 'ArrowRight' })
    expect(option(/^Needs you/)).toHaveAttribute('aria-checked', 'true')
    const search = screen.getByRole('searchbox', { name: 'Filter conversations' })
    fireEvent.change(search, { target: { value: 'atlas' } })
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(search).toHaveValue('')
    expect(option(/^Needs you/)).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(option(/^All/)).toHaveAttribute('aria-checked', 'true')
  })
})
