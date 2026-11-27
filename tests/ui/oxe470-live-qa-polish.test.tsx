import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCreditsSnapshot } from '../../shared/types/agentCredits'
import type { Workspace } from '../../shared/types/workspace'
import { AppStatusBar } from '../../src/components/Workspace/AppStatusBar'
import { WorkspaceSurface } from '../../src/components/Workspace/WorkspaceSurface'
import { changeLanguage } from '../../src/i18n'
import { useAgentStore } from '../../src/store/agent.store'
import { useAgentCreditsStore } from '../../src/store/agentCredits.store'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useUIStore } from '../../src/store/ui.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null })
}))
vi.mock('../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: () => <div data-testid="workspace-grid">Grid</div>
}))
vi.mock('../../src/components/Grid/WorkspaceSplitGrid', () => ({
  WorkspaceSplitGrid: () => <div data-testid="workspace-grid">SplitGrid</div>
}))

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string =>
  readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

function snapshot(provider: 'antigravity' | 'claude' | 'codex', usedPct: number): AgentCreditsSnapshot {
  return {
    provider,
    available: true,
    installed: true,
    planLabel: provider === 'antigravity' ? 'Ultra' : 'Max',
    source: 'oauth',
    observedAtMs: Date.now() - 5_000,
    stale: false,
    error: null,
    display: { kind: 'session', usedPct, resetsAtMs: null },
    windows: [{ kind: 'session', usedPct, resetsAtMs: null }]
  } as AgentCreditsSnapshot
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-470',
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
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'ws-470',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-pwsh',
        status: 'running',
        agentProfileId: null,
        agentName: null,
        displayName: null,
        createdAt: null,
        modelOverride: null,
        rootPath: null
      }
    ],
    ...overrides
  } as unknown as Workspace
}

beforeEach(async () => {
  await changeLanguage('en')
  useAgentStore.setState({ allProfiles: [] } as never)
  useAgentCreditsStore.setState({ byProvider: {}, loading: {} } as never)
  useTerminalStore.setState({ panes: {}, activePaneId: null } as never)
  usePaneLayoutStore.setState({ trees: {} } as never)
  useUIStore.setState({ splitLayoutEnabled: true, panelScopePinnedByWorkspace: {} } as never)
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      app: { platform: 'win32' },
      terminal: { stop: vi.fn(async () => undefined) }
    }
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-470 · Live QA polish (OxeChat prose, Usage chip, 3-zone TitleBar, OxeCode topbar & pane header)', () => {
  it('1. aligns OxeChat prose full-column inside --measure-chat without breaking wide canvas tokens', () => {
    const viewCss = readCss('src/components/Threads/ThreadView.css')
    const mdCss = readCss('src/components/Threads/ThreadMarkdown.css')
    const chromeCss = readCss('src/components/Threads/ThreadMessagesChrome.css')

    const threadView = viewCss.match(/\.thread-view\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(threadView).toMatch(/--thread-canvas-max:\s*var\(--measure-chat\)/)
    expect(threadView).toMatch(/--thread-prose-max:\s*100%/)
    expect(threadView).toMatch(/--thread-editorial-max:\s*100%/)
    expect(threadView).not.toMatch(/--thread-editorial-max:\s*max\(/)

    expect(mdCss).toMatch(/\.thread-markdown\s*>\s*:is\([^)]*p[^)]*blockquote[^)]*\.thread-alert[^)]*hr\)\s*\{[^}]*max-width:\s*min\(100%,\s*var\(--thread-editorial-max/)
    expect(chromeCss).toMatch(/\.thread-agent-label\s*\{[^}]*max-width:\s*min\(100%,\s*var\(--thread-editorial-max/)
  })

  it('2. surfaces active-provider usage in AppStatusBar via runtime/pane agentName fallback without letting inactive 100% hijack', async () => {
    useAgentCreditsStore.setState({
      byProvider: {
        antigravity: snapshot('antigravity', 20),
        claude: snapshot('claude', 100)
      },
      loading: {}
    } as never)

    // Case A: runtime agentName ("agy") reported inside a plain shell pane (no agentProfileId, empty allProfiles).
    const shellWorkspace = makeWorkspace()
    useTerminalStore.setState({
      panes: { 'pane-1': { status: 'running', detached: false, agentName: 'agy' } },
      activePaneId: 'pane-1'
    } as never)

    const { rerender } = render(<AppStatusBar workspace={shellWorkspace} activePaneId="pane-1" />)
    const chip = await screen.findByTestId('usage-status')
    expect(chip).toHaveTextContent('Antigravity 20%')
    expect(chip).toHaveAccessibleName('Antigravity 20%: Antigravity 20%, Claude 100%')
    expect(chip.querySelector('[data-provider="antigravity"]')).toBeTruthy()
    expect(chip.className).not.toMatch(/usageCritical|usageWarning/)

    // Case B: static activePane.agentName ("Antigravity") with no runtime terminal state.
    useTerminalStore.setState({ panes: {}, activePaneId: 'pane-1' } as never)
    const namedWorkspace = makeWorkspace({
      panes: [{ ...shellWorkspace.panes[0], agentName: 'Antigravity' }]
    })
    rerender(<AppStatusBar workspace={namedWorkspace} activePaneId="pane-1" />)
    expect(screen.getByTestId('usage-status')).toHaveTextContent('Antigravity 20%')
    expect(screen.getByTestId('usage-status').className).not.toMatch(/usageCritical/)

    // Case C: plain shell with no agent falls back to unified Usage peak (100%).
    rerender(<AppStatusBar workspace={shellWorkspace} activePaneId="pane-1" />)
    expect(screen.getByTestId('usage-status')).toHaveTextContent('Usage 100%')
    expect(screen.getByTestId('usage-status').className).toMatch(/usageCritical/)
  })

  it('3. positions TitleBar in a balanced 3-zone grid with centered ModeSwitch, caption clearance, and narrow fallback', () => {
    const titleBarCss = readCss('src/components/Navigation/TitleBar.module.css')
    const modeSwitchCss = readCss('src/components/Navigation/ModeSwitch.module.css')
    const cmdCss = readCss('src/components/CommandBar/CommandBarTrigger.module.css')

    expect(titleBarCss).toMatch(/\.bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/)
    expect(titleBarCss).toMatch(/\.bar\s*\{[^}]*height:\s*var\(--bar-lg\)/)
    expect(titleBarCss).toMatch(/\.bar\s*\{[^}]*padding-right:\s*max\(16px,\s*calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\) \+ 8px\)\)/)
    expect(titleBarCss).toMatch(/\.brand\s*\{[^}]*justify-self:\s*start/)
    expect(titleBarCss).toMatch(/\.trailing\s*\{[^}]*justify-self:\s*end[^}]*gap:\s*var\(--space-2\)[^}]*padding-right:\s*var\(--space-1\)/)
    expect(titleBarCss).toMatch(/@media\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.bar\s*\{[^}]*grid-template-columns:\s*auto\s+auto\s+minmax\(0,\s*1fr\)/)

    expect(modeSwitchCss).toMatch(/\.switch\s*\{[^}]*justify-self:\s*center/)
    expect(modeSwitchCss).toMatch(/@media\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.switch\s*\{[^}]*justify-self:\s*start/)

    expect(cmdCss).toMatch(/\.trigger\s*\{[^}]*flex:\s*0\s+1\s+240px[^}]*max-width:\s*240px/)
  })

  it('4a. lets OxeCode workspace topbar open terminals and agents right OR below', async () => {
    const user = userEvent.setup()
    const onSplitPane = vi.fn()
    let nextPaneSeq = 2
    const createPane = vi.fn(async () => `pane-${nextPaneSeq++}`)
    const setPaneAgent = vi.fn(async () => undefined)
    useWorkspaceStore.setState({ createPane, setPaneAgent } as never)
    const splitSpy = vi.spyOn(usePaneLayoutStore.getState(), 'split')

    const workspace = makeWorkspace()
    render(
      <WorkspaceSurface
        workspace={workspace}
        isActive
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onSplitPane={onSplitPane}
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
        agentProfiles={[{ agentProfileId: 'ag-1', name: 'Antigravity', provider: 'antigravity' }] as never}
      />
    )

    // + New terminal -> Terminal right / Terminal below
    await user.click(screen.getByTestId('workspace-topbar-add-terminal'))
    const termMenu = await screen.findByRole('menu', { name: 'New terminal' })
    await user.click(within(termMenu).getByRole('menuitem', { name: 'Terminal right' }))
    expect(onSplitPane).toHaveBeenLastCalledWith('pane-1', 'vertical')

    await user.click(screen.getByTestId('workspace-topbar-add-terminal'))
    const termMenu2 = await screen.findByRole('menu', { name: 'New terminal' })
    await user.click(within(termMenu2).getByRole('menuitem', { name: 'Terminal below' }))
    expect(onSplitPane).toHaveBeenLastCalledWith('pane-1', 'horizontal')

    // Agent default position: Side by side (right) -> pane-tree 'horizontal'
    await user.click(screen.getByTestId('workspace-topbar-add-agent'))
    const agentMenu = await screen.findByRole('menu')
    expect(agentMenu).toHaveAttribute('aria-label', 'Launch agent')
    expect(within(agentMenu).getByRole('menuitemradio', { name: 'Side by side (right)' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(agentMenu).getByRole('menuitem', { name: 'Antigravity' }))
    await waitFor(() => expect(setPaneAgent).toHaveBeenCalledWith('pane-2', 'ag-1'))
    expect(splitSpy).toHaveBeenCalledWith('ws-470', 'pane-1', 'pane-2', 'horizontal')

    // Switch Agent position to Below -> pane-tree 'vertical'
    await user.click(screen.getByTestId('workspace-topbar-add-agent'))
    const agentMenu2 = await screen.findByRole('menu')
    await user.click(within(agentMenu2).getByRole('menuitemradio', { name: 'Below' }))

    await user.click(screen.getByTestId('workspace-topbar-add-agent'))
    const agentMenu3 = await screen.findByRole('menu')
    expect(within(agentMenu3).getByRole('menuitemradio', { name: 'Below' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(agentMenu3).getByRole('menuitem', { name: 'Antigravity' }))
    await waitFor(() => expect(setPaneAgent).toHaveBeenCalledWith('pane-3', 'ag-1'))
    expect(splitSpy).toHaveBeenCalledWith('ws-470', 'pane-1', 'pane-3', 'vertical')
  })

  it('4b. harmonizes PaneHeader spacing, quiet Obsidian Minimal agent/resume metadata tags, and title-only edit pencil', () => {
    const headerCss = readCss('src/ui/PaneHeader.module.css')
    const chromeCss = readCss('src/components/Workspace/CodeChrome.css')
    const paneCss = readCss('src/styles/features/pane.css')

    expect(headerCss).toMatch(/\.title\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center/)
    expect(headerCss).toMatch(/\.provider\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*gap:\s*var\(--space-1-5\)/)

    expect(chromeCss).toMatch(/\.workspace-topbar-create-group\s*\{[^}]*display:\s*inline-flex[^}]*gap:\s*var\(--space-1\)/)
    expect(chromeCss).toMatch(/\.workspace-topbar-sep\s*\{[^}]*background:\s*var\(--bd-subtle\)/)
    expect(chromeCss).toMatch(/\.pane-agent-chip,\s*\.pane-agent-chip\[class\*='provider-'\]\s*\{[^}]*height:\s*var\(--space-5\)[^}]*border-radius:\s*var\(--radius-sm\)[^}]*background:\s*var\(--fill-hover\)[^}]*color:\s*var\(--tx-secondary\)/)
    expect(chromeCss).toMatch(/\.pane-header \[data-testid='pane-resume-marker'\]\s*\{[^}]*height:\s*var\(--space-5\)[^}]*border-radius:\s*var\(--radius-sm\)[^}]*background:\s*transparent[^}]*color:\s*var\(--tx-muted\)/)
    expect(chromeCss).toMatch(/\.pane-header \[data-testid='pane-resume-marker'\]\[data-outcome='notResumed'\],\s*\.pane-header \[data-testid='pane-resume-marker'\]\[data-outcome='resumed-asking'\]\s*\{[^}]*color:\s*var\(--intent-warning-fg\)/)

    expect(paneCss).toMatch(/\.pane-agent-chip \.agent-provider-icon\s*\{[^}]*width:\s*13px[^}]*height:\s*13px/)
    expect(paneCss).toMatch(/\.pane-intent-button:hover \.pane-intent-edit-hint,\s*\.pane-intent-button:focus-visible \.pane-intent-edit-hint/)
    expect(paneCss).not.toMatch(/\.pane-header:hover \.pane-intent-edit-hint/)
  })
})
