import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationGroup } from '../../../shared/types/integration'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useUIStore } from '../../../src/store/ui.store'

vi.mock('../../../src/hooks/useGitBranch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/hooks/useGitBranch')>()
  return {
    ...actual,
    useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null })
  }
})
vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid" /> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => <div data-testid="workspace-grid" /> }))

const pane = (id: string, workspaceId: string, columnIndex: number, displayName: string): WorkspacePane => ({
  id,
  workspaceId,
  type: 'terminal',
  rowIndex: 0,
  columnIndex,
  shellProfileId: 'builtin-claude',
  status: 'idle',
  agentProfileId: null,
  agentName: null,
  displayName,
  createdAt: null,
  rootPath: null
} as WorkspacePane)

const makeWorkspace = (id: string, name: string, color: number | null = 2): Workspace => ({
  id,
  name,
  rootPath: `C:/repos/${id}`,
  layout: '1x1',
  layoutPreset: 1,
  themeId: 'midnight',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: id === 'atlas',
  color,
  panes: [pane(`${id}-p1`, id, 0, 'Shell')]
} as unknown as Workspace)

const WORKSPACES = [makeWorkspace('atlas', 'Atlas', 3), makeWorkspace('borealis', 'Borealis', 1)]

const sidebarActions = {
  onNewWorkspace: vi.fn(),
  onDelegations: vi.fn(),
  onOpenSearch: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onCloseWorkspace: vi.fn(),
  onToggleCollapse: vi.fn()
}

function renderSidebar(integrationGroups: IntegrationGroup[] = []): void {
  render(
    <Sidebar
      workspaces={WORKSPACES}
      activeWorkspaceId="atlas"
      appVersion="1.5.3"
      isCollapsed={false}
      integrationGroups={integrationGroups}
      panelMenu={[{ label: 'Changes', onSelect: () => undefined }] as never}
      {...sidebarActions}
    />
  )
}

function renderSurface(workspace = WORKSPACES[0]): void {
  render(
    <WorkspaceSurface
      workspace={workspace}
      isActive
      maximizedPaneId={null}
      onToggleMaximize={() => undefined}
      webPreviewVisible={false}
      integrationVisible={false}
      searchVisible={false}
      onCloseWebPreview={() => undefined}
      onCloseIntegration={() => undefined}
      onCloseSearch={() => undefined}
      onRunCommand={() => undefined}
      onUpdateEditorState={() => undefined}
      onUpdateReviewState={() => undefined}
      onUpdateGitHubState={() => undefined}
      onUpdateBackgroundState={() => undefined}
      onUpdateWorktreeState={() => undefined}
      onSelectWorkspace={() => undefined}
      workspaces={WORKSPACES}
      activePaneId={null}
    />
  )
}

describe('OXE-279 · PE-09·B · OxeCode sidebar and topbar say each thing once', () => {
  beforeEach(() => {
    __resetGitBranchCacheForTests()
    useNavigationPrefs.setState({ width: 280, expanded: { atlas: true, borealis: false } })
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null } as never)
    useUIStore.setState({
      activePaneId: null,
      isSidebarCollapsed: false,
      collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false }
    })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        app: { platform: 'win32' },
        terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) },
        workspace: { closePane: vi.fn(async () => undefined) },
        git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
      }
    })
    for (const action of Object.values(sidebarActions)) action.mockClear()
  })

  afterEach(async () => {
    cleanup()
    vi.restoreAllMocks()
    useUIStore.setState({
      isSidebarCollapsed: false,
      collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false }
    })
    await changeLanguage('en')
  })

  it('uses short Filter placeholder while preserving full accessible aria-label in pt-BR and en', async () => {
    for (const [locale, expectedPlaceholder, expectedAriaLabel] of [
      ['pt-BR', 'Filtrar…', 'Filtrar workspaces'],
      ['en', 'Filter…', 'Filter workspaces']
    ] as const) {
      await changeLanguage(locale)
      renderSidebar()

      const filter = document.querySelector<HTMLElement>('[data-ui="sidebar-filter"]')
      expect(filter).not.toBeNull()
      const input = within(filter!).getByRole('searchbox', { name: expectedAriaLabel })
      expect(input).toHaveAttribute('placeholder', expectedPlaceholder)
      expect(input).toHaveAttribute('aria-label', expectedAriaLabel)
      cleanup()
    }
  })

  it('omits redundant Workspaces section heading beneath Workspaces header', () => {
    renderSidebar()

    const header = document.querySelector<HTMLElement>('[data-ui="sidebar-header"]')
    expect(header?.textContent?.trim().startsWith(i18n.t('sidebar.workspaces', { ns: 'code' }))).toBe(true)

    const sections = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-section"]')]
    expect(
      sections.filter((section) => section.textContent?.trim() === i18n.t('sidebar.workspaces', { ns: 'code' }))
    ).toHaveLength(0)
    expect(sections).toHaveLength(0)

    // Toggle-all action remains accessible as an IconButton in the sidebar header and still expands/collapses all.
    const toggleAll = within(header!).getByRole('button', { name: i18n.t('sidebar.toggleAll', { ns: 'code' }) })
    expect(toggleAll).toHaveAttribute('data-ui', 'icon-button')
    expect(screen.getAllByTestId('pane-session-row')).toHaveLength(1)
    fireEvent.click(toggleAll)
    expect(screen.getAllByTestId('pane-session-row')).toHaveLength(2)

    // Non-redundant "Integrations" section stays intact when integration groups exist.
    cleanup()
    renderSidebar([
      {
        id: 'ig-1',
        name: 'Checkout',
        members: [{ id: 'm-1', workspaceId: 'atlas', role: 'api', name: 'Atlas' }]
      } as unknown as IntegrationGroup
    ])
    const sectionsWithIntegrations = [...document.querySelectorAll<HTMLElement>('[data-ui="sidebar-section"]')]
    expect(sectionsWithIntegrations).toHaveLength(1)
    expect(sectionsWithIntegrations[0].textContent?.trim()).toBe(i18n.t('sidebar.integrations', { ns: 'code' }))
  })

  it('hides workspace chip in topbar while sidebar is open and shows it when sidebar is collapsed', () => {
    useUIStore.setState({
      isSidebarCollapsed: false,
      collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false }
    })
    const { rerender } = render(
      <WorkspaceSurface
        workspace={WORKSPACES[0]}
        isActive
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        webPreviewVisible={false}
        integrationVisible={false}
        searchVisible={false}
        onCloseWebPreview={() => undefined}
        onCloseIntegration={() => undefined}
        onCloseSearch={() => undefined}
        onRunCommand={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateReviewState={() => undefined}
        onUpdateGitHubState={() => undefined}
        onUpdateBackgroundState={() => undefined}
        onUpdateWorktreeState={() => undefined}
        onSelectWorkspace={() => undefined}
        workspaces={WORKSPACES}
        activePaneId={null}
      />
    )

    expect(document.querySelectorAll('.workspace-topbar-wschip')).toHaveLength(0)

    act(() => {
      useUIStore.setState({
        isSidebarCollapsed: true,
        collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: true }
      })
    })
    rerender(
      <WorkspaceSurface
        workspace={WORKSPACES[0]}
        isActive
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        webPreviewVisible={false}
        integrationVisible={false}
        searchVisible={false}
        onCloseWebPreview={() => undefined}
        onCloseIntegration={() => undefined}
        onCloseSearch={() => undefined}
        onRunCommand={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateReviewState={() => undefined}
        onUpdateGitHubState={() => undefined}
        onUpdateBackgroundState={() => undefined}
        onUpdateWorktreeState={() => undefined}
        onSelectWorkspace={() => undefined}
        workspaces={WORKSPACES}
        activePaneId={null}
      />
    )

    const chips = document.querySelectorAll<HTMLElement>('.workspace-topbar-wschip')
    expect(chips).toHaveLength(1)
    expect(chips[0]).toHaveAttribute('data-ws', '3')
    expect(chips[0].querySelector('.workspace-topbar-wsdot')).not.toBeNull()
    expect(chips[0].querySelector('.workspace-topbar-wschip-name')?.textContent).toBe('Atlas')

    // Also verify fresh render directly with collapsed sidebar.
    cleanup()
    renderSurface(WORKSPACES[1])
    const freshChip = document.querySelector<HTMLElement>('.workspace-topbar-wschip')
    expect(freshChip).not.toBeNull()
    expect(freshChip).toHaveAttribute('data-ws', '1')
    expect(freshChip?.textContent).toContain('Borealis')
  })
})
