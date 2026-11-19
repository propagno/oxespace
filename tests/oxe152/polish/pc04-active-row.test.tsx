// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-256, PC-04·10, CA-1 and CA-2).
// Contract:
// - CA-1: on a fresh start with no active pane id, bootstrapping the workspace store aligns useUIStore.activePaneId
//   with the first pane of the active workspace (the one the grid focuses), so the sidebar marks that row as current.
// - CA-2: an unnamed terminal pane in pt-BR uses the catalog label (t('panels.terminal') -> "Terminal 1"), never "terminal 1".
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Sidebar } from '../../../src/components/Sidebar/Sidebar'
import { __resetGitBranchCacheForTests } from '../../../src/hooks/useGitBranch'
import { i18n } from '../../../src/i18n'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useUIStore } from '../../../src/store/ui.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

const pane = (id: string, workspaceId: string, columnIndex: number, displayName: string | null): WorkspacePane => ({
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

const WORKSPACES = [workspace('atlas', 'Atlas', [pane('p1', 'atlas', 0, null), pane('p2', 'atlas', 1, null)])]

beforeEach(() => {
  __resetGitBranchCacheForTests()
  useNavigationPrefs.setState({ width: 280, expanded: { atlas: true } })
  const base = useTerminalStore.getState().getStatus('none')
  useTerminalStore.setState({
    panes: {
      p1: { ...base, status: 'running', lastActivityAt: Date.now() - 60_000 },
      p2: { ...base, status: 'running', lastActivityAt: Date.now() - 30_000 }
    },
    pendingCommands: {},
    activePaneId: null
  } as never)
  useUIStore.setState({
    activePaneId: null,
    collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false }
  })
  useWorkspaceStore.setState({
    workspaces: [],
    shellProfiles: [],
    activeWorkspaceId: null,
    isLoading: false,
    error: null
  })
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      app: { platform: 'win32' },
      terminal: { start: vi.fn(), stop: vi.fn(async () => undefined) },
      workspace: {
        list: vi.fn(async () => WORKSPACES),
        shellProfiles: vi.fn(async () => []),
        setActive: vi.fn(async () => undefined),
        closePane: vi.fn(async () => undefined)
      },
      git: { getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) }
    }
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

describe('PC-04·10 · active row on boot and translated unnamed terminal label', () => {
  test('on a fresh start with no active pane id, the sidebar marks the first pane of the active workspace, the one the grid focuses', async () => {
    expect(useUIStore.getState().activePaneId).toBeNull()

    await useWorkspaceStore.getState().bootstrap()

    const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
    expect(activeWorkspaceId).toBe('atlas')
    expect(useUIStore.getState().activePaneId).toBe('p1')

    const { container } = render(
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion="OXESpace v1.5.2"
        isCollapsed={false}
        onNewWorkspace={vi.fn()}
        onDelegations={vi.fn()}
        onOpenSearch={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    )

    const rows = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(rows[1]).not.toHaveAttribute('aria-current')
  })

  test('an unnamed pane in pt-BR is named from the catalog, Terminal 1', async () => {
    await i18n.changeLanguage('pt-BR')
    await useWorkspaceStore.getState().bootstrap()

    const { workspaces, activeWorkspaceId } = useWorkspaceStore.getState()
    const { container } = render(
      <Sidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        appVersion="OXESpace v1.5.2"
        isCollapsed={false}
        onNewWorkspace={vi.fn()}
        onDelegations={vi.fn()}
        onOpenSearch={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onCloseWorkspace={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    )

    const rows = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
    expect(rows[0].textContent).toContain('Terminal 1')
    expect(rows[0].textContent).not.toContain('terminal 1')
    expect(rows[1].textContent).toContain('Terminal 2')
  })
})
