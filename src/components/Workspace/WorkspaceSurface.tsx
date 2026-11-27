import { Suspense, memo, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Activity, Bot, LayoutGrid, MoreHorizontal, Network, PanelsTopLeft, PlugZap, Plus, type LucideIcon } from 'lucide-react'
import { Button, IconButton, Menu, Tabs } from '../../ui'
import { WorkbenchPanelMenu, WorkbenchPanelToggle, type WorkbenchPanelItem } from '../Workbench/WorkbenchPanelMenu'
import { CODE_BAR_PANELS, WORKBENCH_PANELS, panelTitle } from '../Workbench/panelCatalog'
import { clampDockWidth, MAX_DOCK_WIDTH_PX, MIN_DOCK_WIDTH_PX } from '../Workbench/dockWidth'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ThreadProvider } from '../../../shared/types/thread'
import { THREAD_PROVIDERS } from '../../../shared/threadProviders'
import type { UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceWorktreeStateInput, Workspace } from '../../../shared/types/workspace'
import { useKeybindings } from '../../keyboard/keybindings'
import { ThreadSideChat } from '../Threads/side/ThreadSideChat'
import { showSideChat, terminalSideKey, toggleSideChat, useSideChatStore } from '../Threads/side/sideChatStore'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceSplitGrid } from '../Grid/WorkspaceSplitGrid'
import { usePaneLayoutStore } from '../../store/pane-layout.store'
import { gridShape } from '../../../shared/types/pane-tree'
import { useUIStore } from '../../store/ui.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { resolveWorkspaceScope } from '../../utils/workspaceScope'
import { useChangedFilesCount } from '../../hooks/useChangedFilesCount'
import { lazyFrom } from '../../lib/chunk'
import {
  CHANGES_PANEL_CHUNK,
  INTEGRATIONS_STATUS_CHIPS_CHUNK,
  preloadPanels,
  WORKSPACE_ANDROID_PANEL_CHUNK,
  WORKSPACE_HTTP_CALLS_PANEL_CHUNK,
  WORKSPACE_PANEL_CHUNKS
} from '../../lib/panelChunks'
// Side panels are lazy-loaded: they only mount when the user opens them, so
// keeping them out of the initial bundle cuts first-paint parse/exec time. The
// Editor pulls in Monaco (the single heaviest dep), so its split matters most.
// Rendered through lazyFrom over the shared panel chunks: once a chunk has arrived the panel opens in the same
// commit, with no Suspense fallback (a plain React.lazy holds it ~300 ms on the first open; OXE-40).
const WorkspaceBackgroundPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.background, (m) => m.WorkspaceBackgroundPanel)
const WorkspaceEditorPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.editor, (m) => m.WorkspaceEditorPanel)
const WorkspaceGitHubPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.github, (m) => m.WorkspaceGitHubPanel)
const WorkspaceIntegrationPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.integration, (m) => m.WorkspaceIntegrationPanel)
const WorkspaceReviewPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.review, (m) => m.WorkspaceReviewPanel)
const WorkspaceSearchPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.search, (m) => m.WorkspaceSearchPanel)
const WorkspaceHttpCallsPanel = lazyFrom(WORKSPACE_HTTP_CALLS_PANEL_CHUNK, (m) => m.WorkspaceHttpCallsPanel)
const WorkspaceAndroidPanel = lazyFrom(WORKSPACE_ANDROID_PANEL_CHUNK, (m) => m.WorkspaceAndroidPanel)
const WorkspaceContainersPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.containers, (m) => m.WorkspaceContainersPanel)
const WorkspaceWebPreviewPanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.webPreview, (m) => m.WorkspaceWebPreviewPanel)
const WorkspaceWorktreePanel = lazyFrom(WORKSPACE_PANEL_CHUNKS.worktree, (m) => m.WorkspaceWorktreePanel)

// Warm common panel chunks just after first paint. The earlier idle-only strategy
// often waited until after the first click, leaving the initial open on the slow
// lazy-load path. Monaco remains deferred because it is substantially heavier.
let panelsPrefetched = false
function prefetchPanelChunks(): void {
  if (panelsPrefetched) return
  panelsPrefetched = true

  // The chunks lazyFrom renders from: once they arrive, the first open of a panel does not suspend.
  const prefetchCommonPanels = (): void => {
    void preloadPanels(['github', 'review', 'worktree', 'background', 'webPreview', 'integration', 'search', 'containers'])
  }

  const prefetchEditor = (): void => {
    void preloadPanels(['editor'])
    void CHANGES_PANEL_CHUNK.load().catch(() => undefined)
  }
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
  const afterFirstPaint = (): void => {
    prefetchCommonPanels()
    if (ric) ric(prefetchEditor, { timeout: 2000 })
    else setTimeout(prefetchEditor, 1500)
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(afterFirstPaint))
  } else {
    setTimeout(afterFirstPaint, 0)
  }
}
// The status chips poll GitHub and the MCP state after first paint; they are not part of it.
const IntegrationsStatusChips = lazyFrom(INTEGRATIONS_STATUS_CHIPS_CHUNK, (module) => module.IntegrationsStatusChips)
import { ErrorBoundary } from '../common/ErrorBoundary'
import { useWorkspaceRootAvailable, WorkspaceMissingRoot } from './WorkspaceMissingRoot'
import './CodeChrome.css'
import { i18n } from '../../i18n'
import { useTranslation } from 'react-i18next'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { quarantinedCount } from '../MCP/mcpQuarantine'
import { preloadMcpPanel } from '../MCP/McpHost'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceSurfaceProps {
  workspace: Workspace
  isActive?: boolean
  agentProfiles?: AgentProfile[]
  maximizedPaneId: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
  webPreviewVisible: boolean
  integrationVisible: boolean
  searchVisible: boolean
  containersVisible?: boolean
  onCloseWebPreview: () => void
  onCloseIntegration: () => void
  onCloseSearch: () => void
  onCloseContainers?: () => void
  onOpenContainerConversation?: (id: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  workspaces: Workspace[]
  onUpdateEditorState: (input: {
    workspaceId: string
    editorVisible?: boolean
    editorExpanded?: boolean
    editorWidthPercent?: number
  }) => void
  onUpdateReviewState: (input: UpdateWorkspaceReviewStateInput) => void
  onUpdateGitHubState: (input: UpdateWorkspaceGitHubStateInput) => void
  onUpdateBackgroundState: (input: UpdateWorkspaceBackgroundStateInput) => void
  onUpdateWorktreeState: (input: UpdateWorkspaceWorktreeStateInput) => void
  onRunCommand: (command: string) => void
  activePaneId: string | null
  /** Side panels of the active workspace: Changes and Browser as buttons, the rest in the Panels menu. */
  panels?: WorkbenchPanelItem[]
}

const DEFAULT_EDITOR_WIDTH = 40
const DEFAULT_REVIEW_WIDTH = 36
const DEFAULT_GITHUB_WIDTH = 40
const DEFAULT_BACKGROUND_WIDTH = 36
const DEFAULT_WORKTREE_WIDTH = 36
const INNER_MIN_SIZE = 10

interface SidePanelEntry {
  id: string
  defaultSize: number
  content: ReactElement
}

function WorkspaceSurfaceComponent({
  isActive = true,
  maximizedPaneId,
  onClosePane,
  onActivatePane,
  activePaneId,
  panels,
  agentProfiles = [],
  webPreviewVisible,
  integrationVisible,
  searchVisible,
  containersVisible = false,
  onCloseWebPreview,
  onCloseIntegration,
  onCloseSearch,
  onCloseContainers,
  onOpenContainerConversation,
  onRunCommand,
  onSplitPane,
  onToggleMaximize,
  onUpdateEditorState,
  onUpdateGitHubState,
  onUpdateReviewState,
  onUpdateBackgroundState,
  onUpdateWorktreeState,
  workspace,
  workspaces,
  onSelectWorkspace
}: WorkspaceSurfaceProps): ReactElement {
  // Subscribes to the interface language: the memoised surface re-renders when it changes.
  useTranslation('code')

  const lastPersistedWidth = useRef(workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH)
  const lastPersistedReviewWidth = useRef(workspace.reviewPanelWidthPercent ?? DEFAULT_REVIEW_WIDTH)
  const lastPersistedGitHubWidth = useRef(workspace.githubPanelWidthPercent ?? DEFAULT_GITHUB_WIDTH)
  const lastPersistedBackgroundWidth = useRef(workspace.backgroundPanelWidthPercent ?? DEFAULT_BACKGROUND_WIDTH)
  const lastPersistedWorktreeWidth = useRef(workspace.worktreePanelWidthPercent ?? DEFAULT_WORKTREE_WIDTH)

  // Outer "sides" panel — tracks actual rendered size for inner % ↔ total % conversion
  const outerSidePanelRef = useRef<ImperativePanelHandle>(null)
  const outerSideSizeRef = useRef(0)

  const editorVisible = workspace.editorVisible === true
  const editorExpanded = workspace.editorExpanded === true
  const editorWidth = editorExpanded ? 70 : workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH
  const reviewVisible = workspace.reviewPanelVisible === true
  const reviewExpanded = workspace.reviewPanelExpanded === true
  const reviewWidth = reviewExpanded ? 70 : workspace.reviewPanelWidthPercent ?? DEFAULT_REVIEW_WIDTH
  const githubVisible = workspace.githubPanelVisible === true
  const githubExpanded = workspace.githubPanelExpanded === true
  const githubWidth = githubExpanded ? 70 : workspace.githubPanelWidthPercent ?? DEFAULT_GITHUB_WIDTH
  const backgroundVisible = workspace.backgroundPanelVisible === true
  const backgroundExpanded = workspace.backgroundPanelExpanded === true
  const backgroundWidth = backgroundExpanded ? 70 : workspace.backgroundPanelWidthPercent ?? DEFAULT_BACKGROUND_WIDTH
  // Which directory the side panels read. Panes can be moved into git
  // worktrees, and a panel that keeps showing the workspace root while the
  // focused pane works somewhere else is actively misleading — so the panels
  // follow the active pane, and each header names what it is reading.
  const scopePinned = useUIStore((s) => s.panelScopePinnedByWorkspace[workspace.id] ?? null)
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed)
  const openConnections = useUIStore((s) => s.openMcpPanel)
  const workspaceMcp = useMcpStore(useMemo(() => selectMcpServers(workspace.id), [workspace.id]))
  const quarantinedMcp = quarantinedCount(workspaceMcp)
  // …including a worktree the pane's agent moved into, as reported by its hooks.
  const activeLocation = useTerminalStore((s) => (activePaneId ? s.panes[activePaneId]?.location : null) ?? null)
  const panelScope = useMemo(
    () => resolveWorkspaceScope(workspace, activePaneId, scopePinned, activeLocation),
    [workspace, activePaneId, scopePinned, activeLocation]
  )
  // OXE-185 (AG-04d): the Changes button counts the files git reports changed in the panel scope's folder, from main's
  // one counter (the same N the panel reads), without opening the panel. OxeChat's count is its own (OXC-4).
  const changedFiles = useChangedFilesCount(panelScope.rootPath)
  const sideChatPane = workspace.panes.find(pane => pane.id === activePaneId) ?? workspace.panes[0] ?? null
  const sideChatKey = sideChatPane ? terminalSideKey(sideChatPane.id) : null
  const codeSideChatOpen = useSideChatStore(store => Boolean(sideChatKey && store.shown[sideChatKey]))
  const codeSideProviders = useMemo<ThreadProvider[]>(() => {
    const configured = THREAD_PROVIDERS.filter(provider => agentProfiles.some(profile => !profile.parentProvider && profile.provider === provider))
    return configured.length ? configured : [...THREAD_PROVIDERS]
  }, [agentProfiles])
  const codeSideProvider = useMemo<ThreadProvider>(() => {
    const bound = sideChatPane?.agentProfileId ? agentProfiles.find(profile => profile.agentProfileId === sideChatPane.agentProfileId) : undefined
    const resolved = bound?.parentProvider ?? bound?.provider
    if (resolved === 'claude' || resolved === 'codex' || resolved === 'antigravity') return resolved
    return codeSideProviders[0] ?? 'claude'
  }, [sideChatPane, agentProfiles, codeSideProviders])
  const codeSideOpenOptions = useMemo(() => (sideChatPane ? {
    source: 'terminal' as const,
    paneId: sideChatPane.id,
    workspaceId: workspace.id,
    rootPath: panelScope.rootPath,
    provider: codeSideProvider
  } : undefined), [sideChatPane, workspace.id, panelScope.rootPath, codeSideProvider])
  useKeybindings({
    'code.sideChat': () => {
      if (!sideChatKey) return false
      toggleSideChat(sideChatKey)
    }
  }, isActive)

  const worktreeVisible = workspace.worktreePanelVisible === true
  const worktreeExpanded = workspace.worktreePanelExpanded === true
  const worktreeWidth = worktreeExpanded ? 70 : workspace.worktreePanelWidthPercent ?? DEFAULT_WORKTREE_WIDTH
  const [webPreviewExpanded, setWebPreviewExpanded] = useState(false)
  const [integrationExpanded, setIntegrationExpanded] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [httpCallsExpanded, setHttpCallsExpanded] = useState(false)
  const httpCallsVisible = useUIStore((s) => isActive && s.isHttpCallsPanelOpen)
  const closeHttpCalls = useUIStore((s) => s.closeHttpCallsPanel)
  const [androidExpanded, setAndroidExpanded] = useState(false)
  const androidVisible = useUIStore((s) => isActive && s.isAndroidPanelOpen)
  const closeAndroid = useUIStore((s) => s.closeAndroidPanel)
  const [containersExpanded, setContainersExpanded] = useState(false)
  // F2 split-tree is the default layout. Keep the fixed grid as a fallback
  // (toggle via F2) so users can recover if a tree layout gets awkward.
  const splitLayoutEnabled = useUIStore((s) => s.splitLayoutEnabled)
  const tree = usePaneLayoutStore((s) => s.trees[workspace.id] ?? null)
  const syncTree = usePaneLayoutStore((s) => s.sync)
  const resizeTree = usePaneLayoutStore((s) => s.resize)
  const moveTree = usePaneLayoutStore((s) => s.move)

  useEffect(() => {
    syncTree(workspace.id, workspace.panes, { width: window.innerWidth, height: window.innerHeight })
  }, [syncTree, workspace.id, workspace.panes])

  const webPreviewWidth = webPreviewExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const integrationWidth = integrationExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const searchWidth = searchExpanded ? 70 : DEFAULT_REVIEW_WIDTH
  const httpCallsWidth = httpCallsExpanded ? 70 : DEFAULT_REVIEW_WIDTH
  const androidWidth = androidExpanded ? 70 : DEFAULT_REVIEW_WIDTH
  const containersWidth = containersExpanded ? 70 : DEFAULT_REVIEW_WIDTH

  const hasSidePanels = editorVisible || reviewVisible || githubVisible || backgroundVisible || worktreeVisible || webPreviewVisible || integrationVisible || searchVisible || httpCallsVisible || androidVisible || containersVisible
  const visibleSideIds = [githubVisible && 'github', reviewVisible && 'review', editorVisible && 'editor', backgroundVisible && 'background', worktreeVisible && 'worktree', webPreviewVisible && 'web-preview', integrationVisible && 'integration', searchVisible && 'search', httpCallsVisible && 'http-calls', androidVisible && 'android', containersVisible && 'containers'].filter((id): id is string => Boolean(id))
  const visibleSideKey = visibleSideIds.join('|')
  const [preferredSideId, setPreferredSideId] = useState<string | null>(null)
  const previousSideIds = useRef<string[]>([])
  const sideTabsRef = useRef<HTMLElement>(null)
  const sidePanelId = useId()
  useEffect(() => {
    const added = visibleSideIds.filter(id => !previousSideIds.current.includes(id))
    previousSideIds.current = visibleSideIds
    if (added.length) setPreferredSideId(added.at(-1)!)
    else if (preferredSideId && !visibleSideIds.includes(preferredSideId)) setPreferredSideId(visibleSideIds.at(-1) ?? null)
  // The key represents the complete set; array identity changes on each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSideKey])
  const activeSideId = preferredSideId && visibleSideIds.includes(preferredSideId) ? preferredSideId : visibleSideIds.at(-1) ?? null
  useEffect(() => {
    const selected = sideTabsRef.current?.querySelector('[aria-selected="true"]')
    if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeSideId])

  const layoutSizes = getWorkspacePanelSizes({
    editorVisible: activeSideId === 'editor',
    editorWidth,
    githubVisible: activeSideId === 'github',
    githubWidth,
    reviewVisible: activeSideId === 'review',
    reviewWidth,
    backgroundVisible: activeSideId === 'background',
    backgroundWidth,
    worktreeVisible: activeSideId === 'worktree',
    worktreeWidth,
    webPreviewVisible: activeSideId === 'web-preview',
    webPreviewWidth,
    integrationVisible: activeSideId === 'integration',
    integrationWidth,
    searchVisible: activeSideId === 'search',
    searchWidth,
    httpCallsVisible: activeSideId === 'http-calls',
    httpCallsWidth,
    androidVisible: activeSideId === 'android',
    androidWidth,
    containersVisible: activeSideId === 'containers',
    containersWidth
  })

  // Total width of all side panels combined (as % of workspace)
  const combinedSideSize = hasSidePanels ? 100 - layoutSizes.grid : 0

  // Resize outer sides Panel imperatively when combined side size changes.
  // This happens when panels are toggled or expanded — the inner PanelGroup remounts
  // but the outer Panel must reflect the new total side width.
  // Once the surface is shown (post first paint), warm the lazy panel chunks on
  // idle so the first panel open is instant.
  useEffect(() => { prefetchPanelChunks() }, [])

  useEffect(() => {
    if (hasSidePanels && combinedSideSize > 0) {
      try {
        outerSidePanelRef.current?.resize(combinedSideSize)
      } catch {
        // Panel not yet measured (no layout in test environments)
      }
    }
    outerSideSizeRef.current = combinedSideSize
  }, [hasSidePanels, combinedSideSize])

  // Convert a total-workspace percentage to a percentage of the combined side area
  const toInnerPct = (totalPct: number): number => {
    const side = combinedSideSize > 0 ? combinedSideSize : 1
    return Math.max(INNER_MIN_SIZE, Math.min(100, (totalPct / side) * 100))
  }

  // Build the ordered list of visible side panels
  const sidePanels: SidePanelEntry[] = []

  if (githubVisible) {
    sidePanels.push({
      id: 'github',
      defaultSize: toInnerPct(layoutSizes.github),
      content: (
        <WorkspaceGitHubPanel
          workspace={workspace}
          scope={panelScope}
          activeTab={workspace.githubActiveTab ?? 'status'}
          isExpanded={githubExpanded}
          onCollapse={() => onUpdateGitHubState({ workspaceId: workspace.id, githubPanelVisible: false, githubPanelExpanded: false })}
          onToggleExpanded={() => onUpdateGitHubState({ workspaceId: workspace.id, githubPanelExpanded: !githubExpanded, githubPanelWidthPercent: githubExpanded ? DEFAULT_GITHUB_WIDTH : 70 })}
          onTabChange={(githubActiveTab) => onUpdateGitHubState({ workspaceId: workspace.id, githubActiveTab })}
        />
      )
    })
  }

  if (reviewVisible) {
    sidePanels.push({
      id: 'review',
      defaultSize: toInnerPct(layoutSizes.review),
      content: (
        <WorkspaceReviewPanel
          workspace={workspace}
          scope={panelScope}
          isExpanded={reviewExpanded}
          onCollapse={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelVisible: false, reviewPanelExpanded: false })}
          onToggleExpanded={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelExpanded: !reviewExpanded, reviewPanelWidthPercent: reviewExpanded ? DEFAULT_REVIEW_WIDTH : 70 })}
        />
      )
    })
  }

  if (editorVisible) {
    sidePanels.push({
      id: 'editor',
      defaultSize: toInnerPct(layoutSizes.editor),
      content: (
        <WorkspaceEditorPanel
          workspace={workspace}
          scope={panelScope}
          isExpanded={editorExpanded}
          onCollapse={() => onUpdateEditorState({ workspaceId: workspace.id, editorVisible: false, editorExpanded: false })}
          onToggleExpanded={() => onUpdateEditorState({ workspaceId: workspace.id, editorExpanded: !editorExpanded, editorWidthPercent: editorExpanded ? DEFAULT_EDITOR_WIDTH : 70 })}
        />
      )
    })
  }

  if (backgroundVisible) {
    sidePanels.push({
      id: 'background',
      defaultSize: toInnerPct(layoutSizes.background),
      content: (
        <WorkspaceBackgroundPanel
          workspace={workspace}
          isExpanded={backgroundExpanded}
          onCollapse={() => onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelVisible: false, backgroundPanelExpanded: false })}
          onToggleExpanded={() => onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelExpanded: !backgroundExpanded, backgroundPanelWidthPercent: backgroundExpanded ? DEFAULT_BACKGROUND_WIDTH : 70 })}
        />
      )
    })
  }

  if (worktreeVisible) {
    sidePanels.push({
      id: 'worktree',
      defaultSize: toInnerPct(layoutSizes.worktree),
      content: (
        <WorkspaceWorktreePanel
          workspace={workspace}
          activePaneId={activePaneId}
          isExpanded={worktreeExpanded}
          onCollapse={() => onUpdateWorktreeState({ workspaceId: workspace.id, worktreePanelVisible: false, worktreePanelExpanded: false })}
          onToggleExpanded={() => onUpdateWorktreeState({ workspaceId: workspace.id, worktreePanelExpanded: !worktreeExpanded, worktreePanelWidthPercent: worktreeExpanded ? DEFAULT_WORKTREE_WIDTH : 70 })}
        />
      )
    })
  }

  if (webPreviewVisible) {
    sidePanels.push({
      id: 'web-preview',
      defaultSize: toInnerPct(layoutSizes.webPreview),
      content: (
        <WorkspaceWebPreviewPanel
          workspace={workspace}
          isExpanded={webPreviewExpanded}
          onCollapse={onCloseWebPreview}
          onToggleExpanded={() => setWebPreviewExpanded((value) => !value)}
          onRunCommand={onRunCommand}
        />
      )
    })
  }

  if (integrationVisible) {
    sidePanels.push({
      id: 'integration',
      defaultSize: toInnerPct(layoutSizes.integration),
      content: (
        <WorkspaceIntegrationPanel
          activePaneId={activePaneId}
          workspace={workspace}
          workspaces={workspaces}
          isExpanded={integrationExpanded}
          onCollapse={onCloseIntegration}
          onToggleExpanded={() => setIntegrationExpanded((value) => !value)}
          onRunCommand={onRunCommand}
          onSelectWorkspace={onSelectWorkspace}
        />
      )
    })
  }

  if (searchVisible) {
    sidePanels.push({
      id: 'search',
      defaultSize: toInnerPct(layoutSizes.search),
      content: (
        <WorkspaceSearchPanel
          workspace={workspace}
          scope={panelScope}
          isExpanded={searchExpanded}
          onCollapse={onCloseSearch}
          onToggleExpanded={() => setSearchExpanded((value) => !value)}
        />
      )
    })
  }

  if (httpCallsVisible) {
    sidePanels.push({
      id: 'http-calls',
      defaultSize: toInnerPct(layoutSizes.httpCalls),
      content: <WorkspaceHttpCallsPanel workspace={workspace} isExpanded={httpCallsExpanded} onCollapse={closeHttpCalls} onToggleExpanded={() => setHttpCallsExpanded((v) => !v)} />
    })
  }
  if (androidVisible) {
    sidePanels.push({ id: 'android', defaultSize: toInnerPct(layoutSizes.android), content: <WorkspaceAndroidPanel isExpanded={androidExpanded} onCollapse={closeAndroid} onToggleExpanded={() => setAndroidExpanded((v) => !v)} /> })
  }
  if (containersVisible && onCloseContainers) {
    sidePanels.push({
      id: 'containers',
      defaultSize: toInnerPct(layoutSizes.containers),
      content: <WorkspaceContainersPanel isExpanded={containersExpanded} onCollapse={onCloseContainers} onToggleExpanded={() => setContainersExpanded((v) => !v)} onOpenConversation={onOpenContainerConversation} />
    })
  }

  // OXE-367: a workspace whose folder is gone shows Relink or Remove in place of the grid, so no pane starts in it.
  const rootAvailable = useWorkspaceRootAvailable(workspace.id, workspace.rootPath)
  const grid = rootAvailable === false ? <WorkspaceMissingRoot workspace={workspace} /> : <ErrorBoundary id="workspace-grid" label={tc('workspace.gridBoundary')}>{splitLayoutEnabled ? (
    <WorkspaceSplitGrid
      workspace={workspace}
      tree={tree}
      agentProfiles={agentProfiles}
      maximizedPaneId={maximizedPaneId}
      activePaneId={activePaneId}
      onClosePane={onClosePane}
      onToggleMaximize={onToggleMaximize}
      onSplitPane={onSplitPane}
      onActivatePane={onActivatePane}
      onResize={(path, index, deltaPct) => resizeTree(workspace.id, path, index, deltaPct)}
      onMovePane={(paneId, targetPaneId, direction, after) => moveTree(workspace.id, paneId, targetPaneId, direction, after)}
    />
  ) : (
    <WorkspaceGrid
      workspace={workspace}
      agentProfiles={agentProfiles}
      maximizedPaneId={maximizedPaneId}
      activePaneId={activePaneId}
      onClosePane={onClosePane}
      onToggleMaximize={onToggleMaximize}
      onSplitPane={onSplitPane}
      onActivatePane={onActivatePane}
    />
  )}</ErrorBoundary>

  const folderName = workspace.rootPath ? workspace.rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() : null
  const showSubPath = Boolean(folderName && folderName.toLowerCase() !== workspace.name.toLowerCase())
  const splitTargetPaneId = activePaneId ?? workspace.panes[0]?.id ?? null
  // The chip names the grid the panes form now. A preset is only its starting point: after a split or a move the
  // panes may form another grid, or none.
  const PRESET_SHAPES: Record<number, string> = { 1: '1 × 1', 2: '1 × 2', 4: '2 × 2', 6: '2 × 3' }
  const shape = splitLayoutEnabled && tree ? gridShape(tree) : null
  const layoutLabel = splitLayoutEnabled && tree
    ? shape ? `${shape.rows} × ${shape.columns}` : tc('workspace.topbar.layoutCustom')
    : PRESET_SHAPES[workspace.layoutPreset ?? 4] ?? '2 × 2'
  const layoutValue = Object.entries(PRESET_SHAPES).find(([, label]) => label === layoutLabel)?.[0] ?? ''

  const toolbar = (
    <div className="workspace-topbar-host" data-ui="workspace-bar">
    <header className="workspace-topbar" data-ui="workspace-header" aria-label={tc('workspace.topbar.label')}>
      {isSidebarCollapsed ? (
        <span
          className="workspace-topbar-wschip"
          {...(typeof workspace.color !== 'string' ? workspaceColorAttrs({ id: workspace.id, color: workspace.color ?? null }) : undefined)}
          title={workspace.rootPath}
        >
          <span className="workspace-topbar-wsdot" aria-hidden="true" />
          <span className="workspace-topbar-wschip-name">{workspace.name}</span>
        </span>
      ) : null}
      {showSubPath ? <div className="workspace-topbar-breadcrumb"><span className="workspace-topbar-path" title={workspace.rootPath}>{folderName}</span></div> : null}
      {onSplitPane && splitTargetPaneId ? (
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={12} aria-hidden="true" />}
          onClick={() => onSplitPane(splitTargetPaneId, 'vertical')}
        >
          {tc('workspace.topbar.addTerminal')}
        </Button>
      ) : null}
      {agentProfiles && agentProfiles.length > 0 ? (
        <Menu
          label={tc('workspace.topbar.agentMenu', { defaultValue: 'Launch agent' })}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              icon={<Bot size={12} aria-hidden="true" />}
            >
              {tc('workspace.topbar.agent', { defaultValue: 'Agent' })}
            </Button>
          }
          items={agentProfiles.map(profile => ({
            label: profile.name,
            onSelect: () => {
              void (async () => {
                const paneId = await useWorkspaceStore.getState().createPane(workspace.id)
                await useWorkspaceStore.getState().setPaneAgent(paneId, profile.agentProfileId)
              })()
            }
          }))}
        />
      ) : null}
      <Menu
        label={tc('workspace.topbar.layoutMenu', { defaultValue: 'Terminal grid layout' })}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            icon={<LayoutGrid size={12} aria-hidden="true" />}
          >
            {maximizedPaneId
              ? tc('workspace.topbar.layoutFocus', { defaultValue: 'Focus' })
              : layoutLabel}
          </Button>
        }
        items={[
          {
            type: 'radio',
            value: maximizedPaneId ? 'focus' : layoutValue,
            onValueChange: value => {
              if (value === 'focus') {
                if (splitTargetPaneId && !maximizedPaneId) onToggleMaximize(splitTargetPaneId)
                return
              }
              if (maximizedPaneId) onToggleMaximize(maximizedPaneId)
              const preset = Number(value) as 1 | 2 | 4 | 6
              void useWorkspaceStore.getState().updateSettings({ workspaceId: workspace.id, layoutPreset: preset })
            },
            options: [
              { value: '1', label: '1 × 1' },
              { value: '2', label: '1 × 2' },
              { value: '4', label: '2 × 2' },
              { value: '6', label: '2 × 3' },
              ...(splitTargetPaneId ? [{ value: 'focus', label: tc('workspace.topbar.layoutFocus', { defaultValue: 'Focus active pane' }) }] : [])
            ]
          }
        ]}
      />
      <div className="workspace-topbar-spacer" />
      {/* The bar's icon actions are src/ui IconButtons at md (BRD-03): the name is the accessible name and the tooltip. */}
      <div className="workspace-topbar-panel-group" data-ui="panel-group" role="group" aria-label={tc('workspace.topbar.panels')}>
      {panels?.filter(item => CODE_BAR_PANELS.includes(item.id)).map(item => {
        if (item.id !== 'changes') return <WorkbenchPanelToggle key={item.id} item={item} iconOnly className="workspace-topbar-action" />
        const counted = typeof changedFiles === 'number' && changedFiles > 0 ? changedFiles : 0
        const changes: WorkbenchPanelItem = {
          ...item,
          label: counted > 0 ? tc('panels.changesCount', { count: counted }) : item.label,
          badge: counted > 0 ? (counted > 99 ? '99+' : String(counted)) : undefined,
          title: [panelTitle('changes'), tc('panels.changesCountTitle', { folder: panelScope.folderName })].join(' · ')
        }
        return <WorkbenchPanelToggle key={item.id} item={changes} iconOnly className="workspace-topbar-action" />
      })}
      {/* Single Panels menu trigger in OxeCode (PC-04·8, OXE-254): carries the btn-open-tools hook and all workspace panels. */}
      {panels && <WorkbenchPanelMenu items={panels} testId="workspace-panels-menu"
        trigger={<IconButton size="md" className="workspace-topbar-action" label={tc('panels.more')} title={tc('panels.more')} data-testid="btn-open-tools" icon={<PanelsTopLeft size={14} aria-hidden="true" />} />} />}
      <IconButton size="md" className="workspace-topbar-action" label={quarantinedMcp > 0 ? tc('workspace.topbar.mcpQuarantined', { count: quarantinedMcp }) : tc('workspace.topbar.mcp')} title={tc('tools.mcp.detail')} onClick={openConnections} onPointerEnter={preloadMcpPanel} onFocus={preloadMcpPanel} data-testid="workspace-topbar-mcp"
        icon={<>
          <PlugZap size={14} aria-hidden="true" />
          {quarantinedMcp > 0 ? <span className="workspace-topbar-alert" aria-hidden="true" data-testid="workspace-topbar-mcp-quarantined">{quarantinedMcp > 9 ? '9+' : quarantinedMcp}</span> : null}
        </>} />
      <IconButton size="md" className="workspace-topbar-action" label={tc('workspace.topbar.activity')} title={tc('tools.background.detail')} aria-pressed={backgroundVisible} onClick={() => onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelVisible: !backgroundVisible, backgroundPanelExpanded: false })}
        icon={<Activity size={14} aria-hidden="true" />} />
      </div>
      <Suspense fallback={null}><IntegrationsStatusChips workspace={workspace} isActive={isActive} /></Suspense>
    </header>
    </div>
  )

  // IMPORTANT: never swap the outer tree for maximize.
  // A previous early-return rendered `{grid}` outside PanelGroup/Panel, which
  // remounted WorkspaceGrid + every TerminalView, disposed xterm, and wiped
  // scrollback / TUI alt-screen state (dead scroll + lost session history).
  // Maximize is handled inside WorkspaceGrid via CSS; here we only hide side
  // panels so the terminal can use the full width while the grid host stays
  // mounted.
  const isMaximized = Boolean(maximizedPaneId)
  const showSidePanels = hasSidePanels && !isMaximized
  // The same names as the Panels menu and Thread (panelCatalog), so a panel is called one thing everywhere.
  const sideLabels: Record<string, string> = {
    github: WORKBENCH_PANELS.git.label, review: WORKBENCH_PANELS.changes.label, editor: WORKBENCH_PANELS.files.label,
    background: WORKBENCH_PANELS.background.label, worktree: WORKBENCH_PANELS.worktrees.label,
    'web-preview': WORKBENCH_PANELS.browser.label, integration: tc('sidebar.integrations'), search: WORKBENCH_PANELS.search.label,
    'http-calls': WORKBENCH_PANELS.httpCalls.label, android: WORKBENCH_PANELS.android.label, containers: WORKBENCH_PANELS.containers.label
  }
  const sideIcons: Record<string, LucideIcon> = {
    github: WORKBENCH_PANELS.git.icon, review: WORKBENCH_PANELS.changes.icon, editor: WORKBENCH_PANELS.files.icon,
    background: WORKBENCH_PANELS.background.icon, worktree: WORKBENCH_PANELS.worktrees.icon,
    'web-preview': WORKBENCH_PANELS.browser.icon, integration: Network, search: WORKBENCH_PANELS.search.icon,
    'http-calls': WORKBENCH_PANELS.httpCalls.icon, android: WORKBENCH_PANELS.android.icon, containers: WORKBENCH_PANELS.containers.icon
  }
  // Four tabs fit one row at the minimum window width; the rest live in a menu, and the active panel is always a visible tab.
  const SIDE_TAB_LIMIT = 4
  const inlineSidePanels = sidePanels.slice(0, SIDE_TAB_LIMIT)
  const activeSidePanel = sidePanels.find(panel => panel.id === activeSideId)
  if (activeSidePanel && !inlineSidePanels.includes(activeSidePanel)) inlineSidePanels[SIDE_TAB_LIMIT - 1] = activeSidePanel
  const overflowSidePanels = sidePanels.filter(panel => !inlineSidePanels.includes(panel))
  const persistSideWidth = (size: number): void => {
    outerSideSizeRef.current = size
    const width = Math.round(size)
    if (activeSideId === 'github' && Math.abs(width - lastPersistedGitHubWidth.current) >= 2) {
      lastPersistedGitHubWidth.current = width; onUpdateGitHubState({ workspaceId: workspace.id, githubPanelWidthPercent: width, githubPanelExpanded: width >= 68 })
    } else if (activeSideId === 'review' && Math.abs(width - lastPersistedReviewWidth.current) >= 2) {
      lastPersistedReviewWidth.current = width; onUpdateReviewState({ workspaceId: workspace.id, reviewPanelWidthPercent: width, reviewPanelExpanded: width >= 68 })
    } else if (activeSideId === 'editor' && Math.abs(width - lastPersistedWidth.current) >= 2) {
      lastPersistedWidth.current = width; onUpdateEditorState({ workspaceId: workspace.id, editorWidthPercent: width, editorExpanded: width >= 68 })
    } else if (activeSideId === 'background' && Math.abs(width - lastPersistedBackgroundWidth.current) >= 2) {
      lastPersistedBackgroundWidth.current = width; onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelWidthPercent: width, backgroundPanelExpanded: width >= 68 })
    } else if (activeSideId === 'worktree' && Math.abs(width - lastPersistedWorktreeWidth.current) >= 2) {
      lastPersistedWorktreeWidth.current = width; onUpdateWorktreeState({ workspaceId: workspace.id, worktreePanelWidthPercent: width, worktreePanelExpanded: width >= 68 })
    }
  }

  return (
    <div className="workspace-surface-frame">
      {toolbar}
      <div className="workspace-surface-content">
        {/*
          Outer PanelGroup key = workspace.id ONLY.
          WorkspaceGrid lives here and never remounts when side panels toggle
          or when a pane is maximized/restored.
          Side panel contents stay mounted while switching tabs so local tool state survives.
        */}
        <PanelGroup key={workspace.id} direction="horizontal">
          <Panel
            id={`${workspace.id}-grid`}
            minSize={showSidePanels ? layoutSizes.gridMinSize : 100}
          >
            {grid}
          </Panel>

          {showSidePanels ? (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
              <Panel
                id={`${workspace.id}-sides`}
                ref={outerSidePanelRef}
                minSize={Math.min(45, Math.max(20, Math.round((clampDockWidth(MIN_DOCK_WIDTH_PX, typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280) / (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280)) * 100)))}
                maxSize={Math.max(46, Math.min(70, Math.round((clampDockWidth(MAX_DOCK_WIDTH_PX, typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280) / (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280)) * 100)))}
                defaultSize={combinedSideSize}
                onResize={persistSideWidth}
              >
                <div className="workspace-panel-stack" data-ui="panel-stack">
                  {sidePanels.length > 1 && <nav ref={sideTabsRef} className="workspace-panel-stack-tabs" aria-label={tc('workspace.topbar.panels')}>
                    {/* The src/ui Tabs list (BRD-03). The panels stay mounted below, so the list draws only the tabs and names the panel they show. */}
                    <Tabs className="workspace-panel-stack-tablist" label={tc('workspace.topbar.openPanels')} value={activeSideId ?? ''} onChange={next => setPreferredSideId(next)}
                      tabs={inlineSidePanels.map(panel => {
                        const Icon = sideIcons[panel.id]
                        // The name stays in the tooltip and the accessible name when a narrow strip shows only icons.
                        return { value: panel.id, ariaLabel: sideLabels[panel.id], title: sideLabels[panel.id], controls: sidePanelId,
                          label: <>{Icon && <Icon size={14} aria-hidden="true" />}<span className="workspace-panel-stack-tab-label">{sideLabels[panel.id]}</span></> }
                      })} />
                    {overflowSidePanels.length > 0 && <Menu label={tc('panels.more')} align="end"
                      trigger={<Button size="sm" variant="ghost" className="workspace-panel-stack-more" aria-label={tc('workspace.topbar.morePanels', { count: overflowSidePanels.length })} icon={<MoreHorizontal size={14} aria-hidden="true" />}>{overflowSidePanels.length}</Button>}
                      items={overflowSidePanels.map(panel => ({ label: sideLabels[panel.id] ?? panel.id, onSelect: () => setPreferredSideId(panel.id) }))} />}
                  </nav>}
                  <div id={sidePanelId} className="workspace-panel-stack-content" role={sidePanels.length > 1 ? 'tabpanel' : undefined} aria-label={sidePanels.length > 1 && activeSideId ? sideLabels[activeSideId] : undefined}>
                    {sidePanels.map(panel => <div key={panel.id} hidden={panel.id !== activeSideId}>
                      <ErrorBoundary id="workspace-panel" label={tc('workspace.panel.this')}><Suspense fallback={<div className="workspace-editor-panel" data-testid="panel-loading" />}>{panel.content}</Suspense></ErrorBoundary>
                    </div>)}
                  </div>
                </div>
              </Panel>
            </>
          ) : null}
        </PanelGroup>
        {codeSideChatOpen && sideChatKey && sideChatPane && codeSideOpenOptions ? (
          <ThreadSideChat
            key={sideChatKey}
            threadId={sideChatKey}
            defaultProvider={codeSideProvider}
            availableProviders={codeSideProviders}
            openOptions={codeSideOpenOptions}
            shortcutId="code.sideChat"
            onClose={() => showSideChat(sideChatKey, false)}
            onLeave={() => { window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId: sideChatPane.id } })) }}
          />
        ) : null}
      </div>
    </div>
  )
}

export const WorkspaceSurface = memo(
  WorkspaceSurfaceComponent,
  (previous, next) =>
    previous.workspace === next.workspace &&
    previous.isActive === next.isActive &&
    previous.agentProfiles === next.agentProfiles &&
    previous.maximizedPaneId === next.maximizedPaneId &&
    previous.webPreviewVisible === next.webPreviewVisible &&
    previous.integrationVisible === next.integrationVisible &&
    previous.searchVisible === next.searchVisible &&
    previous.containersVisible === next.containersVisible &&
    previous.panels === next.panels &&
    previous.workspaces === next.workspaces &&
    previous.activePaneId === next.activePaneId
)

interface WorkspacePanelSizeInput {
  editorVisible: boolean
  editorWidth: number
  githubVisible: boolean
  githubWidth: number
  reviewVisible: boolean
  reviewWidth: number
  backgroundVisible: boolean
  backgroundWidth: number
  worktreeVisible: boolean
  worktreeWidth: number
  webPreviewVisible: boolean
  webPreviewWidth: number
  integrationVisible: boolean
  integrationWidth: number
  searchVisible: boolean
  searchWidth: number
  httpCallsVisible: boolean
  httpCallsWidth: number
  androidVisible: boolean
  androidWidth: number
  containersVisible: boolean
  containersWidth: number
}

interface WorkspacePanelSizeOutput {
  grid: number
  gridMinSize: number
  editor: number
  github: number
  review: number
  background: number
  worktree: number
  webPreview: number
  integration: number
  search: number
  httpCalls: number
  android: number
  containers: number
}

function getWorkspacePanelSizes(input: WorkspacePanelSizeInput): WorkspacePanelSizeOutput {
  const editor = input.editorVisible ? clampPanelSize(input.editorWidth, 25, 70) : 0
  const github = input.githubVisible ? clampPanelSize(input.githubWidth, 25, 70) : 0
  const review = input.reviewVisible ? clampPanelSize(input.reviewWidth, 24, 70) : 0
  const background = input.backgroundVisible ? clampPanelSize(input.backgroundWidth, 36, 70) : 0
  const worktree = input.worktreeVisible ? clampPanelSize(input.worktreeWidth, 24, 70) : 0
  const webPreview = input.webPreviewVisible ? clampPanelSize(input.webPreviewWidth, 25, 70) : 0
  const integration = input.integrationVisible ? clampPanelSize(input.integrationWidth, 25, 70) : 0
  const search = input.searchVisible ? clampPanelSize(input.searchWidth, 24, 70) : 0
  const httpCalls = input.httpCallsVisible ? clampPanelSize(input.httpCallsWidth, 24, 70) : 0
  const android = input.androidVisible ? clampPanelSize(input.androidWidth, 24, 70) : 0
  const containers = input.containersVisible ? clampPanelSize(input.containersWidth, 24, 70) : 0
  const visibleSideCount = Number(input.editorVisible) + Number(input.githubVisible) + Number(input.reviewVisible) + Number(input.backgroundVisible) + Number(input.worktreeVisible) + Number(input.webPreviewVisible) + Number(input.integrationVisible) + Number(input.searchVisible) + Number(input.httpCallsVisible) + Number(input.androidVisible) + Number(input.containersVisible)

  if (visibleSideCount === 0) {
    return { grid: 100, gridMinSize: 30, editor: 0, github: 0, review: 0, background: 0, worktree: 0, webPreview: 0, integration: 0, search: 0, httpCalls: 0, android: 0, containers: 0 }
  }

  if (visibleSideCount === 1) {
    const side = input.editorVisible ? editor
      : input.githubVisible ? github
        : input.reviewVisible ? review
          : input.backgroundVisible ? background
            : input.worktreeVisible ? worktree
                : input.webPreviewVisible ? webPreview
                  : input.integrationVisible ? integration
                    : input.searchVisible ? search
                      : input.httpCallsVisible ? httpCalls
                        : input.androidVisible ? android : containers
    return {
      grid: 100 - side,
      gridMinSize: 30,
      editor,
      github,
      review,
      background,
      worktree,
      webPreview,
      integration,
      search,
      httpCalls,
      android,
      containers
    }
  }

  const maxCombinedSideWidth = 70
  const combined = editor + github + review + background + worktree + webPreview + integration + search + httpCalls + android + containers
  const scale = combined > maxCombinedSideWidth ? maxCombinedSideWidth / combined : 1
  const normalizedEditor = input.editorVisible ? Math.max(25, Math.round(editor * scale)) : 0
  const normalizedGitHub = input.githubVisible ? Math.max(25, Math.round(github * scale)) : 0
  const normalizedReview = input.reviewVisible ? Math.max(24, Math.round(review * scale)) : 0
  const normalizedBackground = input.backgroundVisible ? Math.max(24, Math.round(background * scale)) : 0
  const normalizedWorktree = input.worktreeVisible ? Math.max(24, Math.round(worktree * scale)) : 0
  const normalizedWebPreview = input.webPreviewVisible ? Math.max(25, Math.round(webPreview * scale)) : 0
  const normalizedIntegration = input.integrationVisible ? Math.max(25, Math.round(integration * scale)) : 0
  const normalizedSearch = input.searchVisible ? Math.max(24, Math.round(search * scale)) : 0
  const normalizedHttpCalls = input.httpCallsVisible ? Math.max(24, Math.round(httpCalls * scale)) : 0
  const normalizedAndroid = input.androidVisible ? Math.max(24, Math.round(android * scale)) : 0
  const normalizedContainers = input.containersVisible ? Math.max(24, Math.round(containers * scale)) : 0
  const normalizedCombined = normalizedEditor + normalizedGitHub + normalizedReview + normalizedBackground + normalizedWorktree + normalizedWebPreview + normalizedIntegration + normalizedSearch + normalizedHttpCalls + normalizedAndroid + normalizedContainers

  return {
    grid: Math.max(30, 100 - normalizedCombined),
    gridMinSize: 30,
    editor: normalizedEditor,
    github: normalizedGitHub,
    review: normalizedReview,
    background: normalizedBackground,
    worktree: normalizedWorktree,
    webPreview: normalizedWebPreview,
    integration: normalizedIntegration,
    search: normalizedSearch,
    httpCalls: normalizedHttpCalls,
    android: normalizedAndroid,
    containers: normalizedContainers
  }
}

function clampPanelSize(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, Math.round(width)))
}
