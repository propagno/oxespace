import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GitDiffSummary } from '../../../shared/types/git'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { ChangesPanel } from '../../../src/components/Changes/ChangesPanel'
import { PaneSessionRow } from '../../../src/components/Sidebar/PaneSessionRow'
import { WorkbenchPanelToggle } from '../../../src/components/Workbench/WorkbenchPanelMenu'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { SidebarSkeleton } from '../../../src/ui'

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>(res => { resolvePromise = res })
  return { promise, resolve: resolvePromise }
}

const basePane = (id: string): WorkspacePane => ({
  id,
  workspaceId: 'ws-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex: 0,
  status: 'running',
  agentProfileId: null,
  agentName: 'Claude',
  displayName: null,
  shellProfileId: 'builtin-claude',
  rootPath: null,
  createdAt: null
} as WorkspacePane)

const baseWorkspace = (panes: WorkspacePane[]): Workspace => ({
  id: 'ws-1',
  name: 'demo',
  rootPath: 'C:/dev/demo',
  defaultShellProfileId: 'builtin-claude',
  panes
} as unknown as Workspace)

const terminalEntry = (over: Partial<TerminalStateEntry>): TerminalStateEntry => ({
  status: 'running',
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false,
  hookState: null,
  hookAt: null,
  agentState: null,
  agentSource: null,
  location: null,
  detached: false,
  ...over
} as TerminalStateEntry)

beforeEach(() => {
  useTerminalStore.setState({ panes: {}, activePaneId: null })
  useWorkspaceStore.setState({ workspaces: [], shellProfiles: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OXE-365 (Part B) · UI/UX polish', () => {
  test('1. 99+ topbar badge stays bounded inside topbar clearance and never wraps or overflows border', () => {
    render(
      <WorkbenchPanelToggle
        iconOnly
        className="workspace-topbar-action"
        item={{
          id: 'changes',
          active: false,
          onToggle: () => undefined,
          label: 'Changes (120)',
          badge: '99+'
        }}
      />
    )
    const badge = screen.getByTestId('panel-badge-changes')
    expect(badge).toHaveTextContent('99+')
    expect(badge).toHaveClass('workspace-topbar-alert')

    const css = readFileSync(resolve(process.cwd(), 'src/styles/layout.css'), 'utf8')
    const rule = css.match(/\.workspace-topbar-alert\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/top:\s*-2px/)
    expect(rule).toMatch(/right:\s*-2px/)
    expect(rule).toMatch(/white-space:\s*nowrap/)
    expect(rule).toMatch(/box-sizing:\s*border-box/)
    expect(rule).toMatch(/padding:\s*0\s+4px/)
    expect(rule).not.toMatch(/top:\s*-5px/)
  })

  test('2. blocked PaneSessionRow renders a single amber needs-you StatusSignal with no duplicate mark', () => {
    const ws = baseWorkspace([basePane('blocked')])
    useWorkspaceStore.setState({ workspaces: [ws] })
    useTerminalStore.setState({
      panes: { blocked: terminalEntry({ agentState: 'blocked', agentSource: 'hook' }) }
    })

    const { container } = render(
      <PaneSessionRow
        pane={ws.panes[0]}
        paneIndex={0}
        workspace={ws}
        isActive={false}
        agentProfiles={[]}
        onClick={() => undefined}
        onActivatePane={() => undefined}
      />
    )

    const row = container.querySelector('[data-testid="pane-session-row"]') as HTMLElement
    expect(row.querySelectorAll('[data-ui="status-signal"][data-state="needs-you"]')).toHaveLength(1)
    expect(screen.queryByTestId('pane-row-decision-mark')).toBeNull()
  })

  test('3. ChangesPanel renders a loading state while git diff is pending instead of flashing "No changes"', async () => {
    const diffGate = deferred<GitDiffSummary>()
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        git: {
          getBranch: vi.fn(async () => ({ branch: 'feat/demo', shortSha: 'abc1234' })),
          getDiffSummary: vi.fn(() => diffGate.promise),
          getFileOriginal: vi.fn(async () => ({ content: '', truncated: false })),
          getFileAtRef: vi.fn(async () => ({ content: '' }))
        },
        github: {
          listBranches: vi.fn(async () => [{ name: 'main', remote: false }, { name: 'feat/demo', remote: false }]),
          resolveWorktreeBase: vi.fn(async () => ({ baseRef: 'main' })),
          listWorktrees: vi.fn(async () => [])
        },
        fs: {
          readFile: vi.fn(async () => ({ content: '' }))
        }
      }
    })

    render(<ChangesPanel workspaceId="ws-1" rootPath="/tmp/repo" />)

    // While branches & diff are still loading, show loading indicator and never flash "No changes"
    expect(screen.getByTestId('changes-loading')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
    expect(screen.queryByText('No changes')).toBeNull()

    // Even after branch resolution kicks off getDiffSummary, keep showing loading while diffGate is pending
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('changes-loading')).toBeInTheDocument()
    expect(screen.queryByText('No changes')).toBeNull()

    // Once getDiffSummary resolves with 0 files, transition cleanly to EmptyState
    await act(async () => {
      diffGate.resolve({ base: 'main', files: [], additions: 0, deletions: 0, compiledAt: 1 })
      await diffGate.promise
    })
    expect(await screen.findByText('No changes')).toBeInTheDocument()
    expect(screen.queryByTestId('changes-loading')).toBeNull()
  })

  test('4. SidebarSkeleton delays placeholder bars by 300ms so fast loads never flash a skeleton', () => {
    vi.useFakeTimers()
    render(<SidebarSkeleton label="Thread sidebar" title="Conversations" />)

    const region = screen.getByRole('complementary', { name: 'Thread sidebar' })
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region.querySelector('[data-skeleton]')).toBeNull()

    act(() => { vi.advanceTimersByTime(299) })
    expect(region.querySelector('[data-skeleton]')).toBeNull()

    act(() => { vi.advanceTimersByTime(1) })
    expect(region.querySelector('[data-skeleton]')).not.toBeNull()
  })
})
