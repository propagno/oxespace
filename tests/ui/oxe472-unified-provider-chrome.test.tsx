import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '../../shared/types/agent'
import type { ConversationThread } from '../../shared/types/thread'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { PaneContainer } from '../../src/components/Grid/PaneContainer'
import { ThreadHeader } from '../../src/components/Threads/ThreadHeader'
import { ThreadSidebarRow } from '../../src/components/Threads/ThreadSidebarRow'
import { WorkspaceSurface } from '../../src/components/Workspace/WorkspaceSurface'
import { changeLanguage } from '../../src/i18n'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useUIStore } from '../../src/store/ui.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/components/Panes/PaneContent', () => ({
  PaneContent: () => <div data-testid="mock-pane-content" />
}))
vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null })
}))
vi.mock('../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: () => <div data-testid="workspace-grid">Grid</div>
}))
vi.mock('../../src/components/Grid/WorkspaceSplitGrid', () => ({
  WorkspaceSplitGrid: () => <div data-testid="workspace-grid">SplitGrid</div>
}))

const ANTIGRAVITY_PROFILE: AgentProfile = {
  agentProfileId: 'builtin-antigravity',
  name: 'Antigravity',
  provider: 'antigravity',
  command: 'agy',
  commandTemplate: 'agy',
  isBuiltin: true
}

function makePane(overrides: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    id: 'pane-1',
    workspaceId: 'ws-472',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-pwsh',
    status: 'running',
    agentProfileId: 'builtin-antigravity',
    agentName: 'Antigravity',
    displayName: 'teste',
    createdAt: null,
    modelOverride: null,
    rootPath: null,
    ...overrides
  } as unknown as WorkspacePane
}

function makeWorkspace(panes: WorkspacePane[] = [makePane()]): Workspace {
  return {
    id: 'ws-472',
    name: 'oxespace',
    rootPath: 'C:/repo/oxespace',
    layout: '1x1',
    layoutPreset: 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-pwsh',
    autoStart: false,
    isActive: true,
    editorVisible: false,
    editorExpanded: false,
    editorWidthPercent: 40,
    reviewPanelVisible: false,
    reviewPanelExpanded: false,
    reviewPanelWidthPercent: 36,
    githubPanelVisible: false,
    githubPanelExpanded: false,
    githubPanelWidthPercent: 40,
    githubActiveTab: 'status',
    backgroundPanelVisible: false,
    backgroundPanelExpanded: false,
    backgroundPanelWidthPercent: 28,
    panes
  } as unknown as Workspace
}

function makeThread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: 'thread-472',
    projectId: 'proj-1',
    workspaceId: 'ws-472',
    rootPath: 'C:/repo/oxespace',
    title: 'Oi',
    provider: 'antigravity',
    status: 'idle',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 10_000,
    archived: false,
    pinned: false,
    access: 'can-edit',
    nativeSessionId: null,
    ...overrides
  } as unknown as ConversationThread
}

function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(async () => {
  await changeLanguage('en')
  useWorkspaceStore.setState({ workspaces: [makeWorkspace()], shellProfiles: [] } as never)
  useTerminalStore.setState({
    panes: {
      'pane-1': {
        status: 'running',
        error: null,
        lastActivityAt: Date.now(),
        lastOutput: null,
        lastIntent: null,
        lastIntentAt: null,
        isWorking: false,
        hasUnread: false
      }
    },
    activePaneId: 'pane-1'
  } as never)
  usePaneLayoutStore.setState({ trees: {} } as never)
  useUIStore.setState({ splitLayoutEnabled: true, panelScopePinnedByWorkspace: {} } as never)
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      app: { platform: 'win32' },
      terminal: {
        stop: vi.fn(async () => undefined),
        branch: vi.fn(async () => ({ branch: 'main', startedOn: 'main', switched: false }))
      }
    }
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-472 · Unified AI provider icon chrome across OxeCode and OxeChat', () => {
  it('replaces pane header status dot and provider text chip with a leading AI provider symbol before the pane name', () => {
    const pane = makePane({ displayName: 'teste' })
    const workspace = makeWorkspace([pane])
    const { container } = render(
      <PaneContainer
        pane={pane}
        workspace={workspace}
        agentProfile={ANTIGRAVITY_PROFILE}
        autoStart={false}
        isMaximized={false}
        isActive
        onToggleMaximize={() => undefined}
      />
    )

    const header = container.querySelector('[data-ui="pane-header"]')!
    const providerMark = within(header as HTMLElement).getByTestId('pane-provider-chip')
    const title = header.querySelector('[data-ui="pane-title"]')!

    expect(header.querySelector('[data-testid="pane-status-dot"]')).toBeNull()
    expect(providerMark.getAttribute('data-provider')).toBe('antigravity')
    expect(providerMark.querySelector('.agent-provider-icon[data-provider="antigravity"]')).not.toBeNull()
    expect(providerMark.textContent?.trim()).toBe('')
    expect(isBefore(providerMark, title)).toBe(true)
    expect(title.textContent?.trim()).toBe('teste')
    expect(header.querySelector('.pane-agent-chip-label')).toBeNull()
    // Visible header text does not duplicate the provider name beside the custom pane name.
    expect(header.querySelector('[data-ui="pane-title"]')?.textContent).toBe('teste')
    expect(header.querySelector('[data-testid="pane-status-text"]')).not.toBeNull()
  })

  it('shows the runtime-detected provider symbol without an agentProfile, and SquareTerminal for plain shells', () => {
    const runtimePane = makePane({ agentProfileId: null, agentName: 'Claude', displayName: 'api-review' })
    const { container, rerender } = render(
      <PaneContainer
        pane={runtimePane}
        workspace={makeWorkspace([runtimePane])}
        agentProfile={null}
        autoStart={false}
        isMaximized={false}
        onToggleMaximize={() => undefined}
      />
    )

    const runtimeMark = container.querySelector('[data-testid="pane-provider-chip"]')!
    expect(runtimeMark.getAttribute('data-provider')).toBe('claude')
    expect(runtimeMark.querySelector('.agent-provider-icon[data-provider="claude"]')).not.toBeNull()

    const shellPane = makePane({ agentProfileId: null, agentName: null, displayName: 'PowerShell' })
    rerender(
      <PaneContainer
        pane={shellPane}
        workspace={makeWorkspace([shellPane])}
        agentProfile={null}
        autoStart={false}
        isMaximized={false}
        onToggleMaximize={() => undefined}
      />
    )

    const shellMark = container.querySelector('[data-testid="pane-provider-chip"]')!
    expect(shellMark.getAttribute('data-provider')).toBe('shell')
    expect(shellMark.querySelector('.agent-provider-icon')).toBeNull()
    expect(shellMark.querySelector('svg')).not.toBeNull()
  })

  it('removes the unused 1x1 layout preset button from OxeCode workspace topbar while keeping terminal and agent creation', () => {
    const workspace = makeWorkspace()
    render(
      <WorkspaceSurface
        workspace={workspace}
        isActive
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onSplitPane={() => undefined}
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
        workspaces={[workspace]}
        activePaneId="pane-1"
        agentProfiles={[ANTIGRAVITY_PROFILE]}
      />
    )

    const topbar = screen.getByLabelText(/workspace status/i)
    expect(within(topbar).getByTestId('workspace-topbar-add-terminal')).toBeInTheDocument()
    expect(within(topbar).getByTestId('workspace-topbar-add-agent')).toBeInTheDocument()
    expect(within(topbar).queryByRole('button', { name: /1\s*[×x]\s*1/i })).toBeNull()
    expect(within(topbar).queryByRole('button', { name: /grid layout/i })).toBeNull()
  })

  it.each(['antigravity', 'claude', 'codex'] as const)('places the %s AI provider icon before the chat title in OxeChat ThreadHeader with zero provider text', provider => {
    const thread = makeThread({ provider, title: 'Oi' })
    const { container } = render(
      <ThreadHeader
        thread={thread}
        pending={false}
        running={false}
        onTogglePanel={() => undefined}
        onCommand={() => undefined}
        onDelegate={() => undefined}
        onPin={() => undefined}
      />
    )

    const header = container.querySelector('[data-ui="chat-header"]')!
    const iconWrap = within(header as HTMLElement).getByTestId('thread-header-provider-icon')
    const title = header.querySelector('[data-ui="chat-title"]')!

    expect(iconWrap.getAttribute('data-provider')).toBe(provider)
    expect(iconWrap.querySelector(`.agent-provider-icon[data-provider="${provider}"]`)).not.toBeNull()
    expect(isBefore(iconWrap, title)).toBe(true)
    expect(title.textContent).toBe('Oi')
    expect(header.textContent).not.toMatch(/\b(Claude|Codex|Antigravity)\b/i)
  })

  it.each(['antigravity', 'claude', 'codex'] as const)('places the %s AI provider icon before the row title in OxeChat ThreadSidebarRow with zero provider text', provider => {
    const thread = makeThread({ provider, title: 'Oi' })
    const { container } = render(
      <ThreadSidebarRow
        thread={thread}
        selected
        unread={false}
        time="now"
        onSelect={() => undefined}
        onMenu={() => undefined}
        onOpenRequest={() => undefined}
      />
    )

    const row = container.querySelector('[data-ui="sidebar-row"]')!
    const icon = row.querySelector(`.agent-provider-icon[data-provider="${provider}"]`)!
    const title = row.querySelector('[data-ui="row-title"]')!

    expect(icon).not.toBeNull()
    expect(isBefore(icon, title)).toBe(true)
    expect(row).toHaveAttribute('data-lines', '2')
    expect(title.textContent).toBe('Oi')
    expect(row.textContent).not.toMatch(/\b(Claude|Codex|Antigravity)\b/i)
  })
})
