// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-255, PC-04·9, CA-1 and CA-2).
// Contract: an open OxeCode sidebar has a single collapse button, located in its header ([data-ui=sidebar-header]),
// and clicking it collapses the sidebar to the rail via useUIStore.toggleSidebar('code').
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { i18n } from '../../../src/i18n'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useUIStore } from '../../../src/store/ui.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

const tg = (key: string): string => i18n.t(key, { ns: 'common' }) as string

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

const workspace = (id: string, name: string, panes: WorkspacePane[]): Workspace => ({
  id,
  name,
  rootPath: `C:/repos/${id}`,
  layout: '2x2',
  layoutPreset: 4,
  themeId: 'dracula',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  color: 3,
  panes
} as unknown as Workspace)

const WORKSPACES = [workspace('atlas', 'Atlas', [pane('p1', 'atlas', 0, 'API server')])]

function SidebarHarness() {
  const isCollapsed = useUIStore((s) => s.collapsedSidebars.code)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  return (
    <Sidebar
      workspaces={WORKSPACES}
      activeWorkspaceId="atlas"
      appVersion="OXESpace v1.5.2"
      isCollapsed={isCollapsed}
      onNewWorkspace={vi.fn()}
      onDelegations={vi.fn()}
      onOpenSearch={vi.fn()}
      onSelectWorkspace={vi.fn()}
      onCloseWorkspace={vi.fn()}
      onToggleCollapse={() => toggleSidebar('code')}
      panelMenu={[{ label: 'Changes', onSelect: () => undefined }] as never}
    />
  )
}

beforeEach(() => {
  __resetGitBranchCacheForTests()
  useNavigationPrefs.setState({ width: 280, expanded: { atlas: true } })
  const base = useTerminalStore.getState().getStatus('none')
  useTerminalStore.setState({
    panes: { p1: { ...base, status: 'running', lastActivityAt: Date.now() - 60_000 } },
    pendingCommands: {},
    activePaneId: 'p1'
  } as never)
  useUIStore.setState({
    activePaneId: 'p1',
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PC-04·9 · single collapse button in the OxeCode sidebar', () => {
  test('an open sidebar has one collapse button, in its header', () => {
    const { container } = render(<SidebarHarness />)
    const aside = container.querySelector('aside')!
    const collapseLabels = new Set([tg('nav.collapseSidebar'), tg('nav.collapseSidebarShortcut')])
    const collapseButtons = within(aside)
      .getAllByRole('button')
      .filter((btn) => collapseLabels.has(btn.getAttribute('aria-label') ?? ''))

    expect(collapseButtons).toHaveLength(1)

    const header = aside.querySelector('[data-ui="sidebar-header"]')!
    const footer = aside.querySelector('[data-ui="sidebar-footer"]')!
    expect(header.contains(collapseButtons[0])).toBe(true)
    expect(footer.contains(collapseButtons[0])).toBe(false)
  })

  test('clicking it collapses the sidebar to the rail', () => {
    const { container } = render(<SidebarHarness />)
    const aside = container.querySelector('aside')!
    const collapseBtn = within(aside).getByRole('button', { name: tg('nav.collapseSidebarShortcut') })

    fireEvent.click(collapseBtn)

    expect(useUIStore.getState().collapsedSidebars.code).toBe(true)
    const collapsedAside = container.querySelector('aside')!
    expect(collapsedAside.className).toContain('sidebar-collapsed')
    expect(within(collapsedAside).getByRole('button', { name: tg('nav.expandSidebarShortcut') })).toBeTruthy()
  })
})
