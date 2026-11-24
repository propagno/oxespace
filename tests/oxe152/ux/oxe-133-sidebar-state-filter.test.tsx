import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { changeLanguage } from '../../../src/i18n'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
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
