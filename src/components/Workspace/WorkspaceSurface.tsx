import { Fragment, Suspense, lazy, memo, useEffect, useRef, useState, type ReactElement } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import type { AgentProfile } from '../../../shared/types/agent'
import type { UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceWorktreeStateInput, Workspace } from '../../../shared/types/workspace'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceSplitGrid } from '../Grid/WorkspaceSplitGrid'
import { usePaneLayoutStore } from '../../store/pane-layout.store'
import { useUIStore } from '../../store/ui.store'
// Side panels are lazy-loaded: they only mount when the user opens them, so
// keeping them out of the initial bundle cuts first-paint parse/exec time. The
// Editor pulls in Monaco (the single heaviest dep), so its split matters most.
const WorkspaceBackgroundPanel = lazy(() => import('./WorkspaceBackgroundPanel').then((m) => ({ default: m.WorkspaceBackgroundPanel })))
const WorkspaceEditorPanel = lazy(() => import('./WorkspaceEditorPanel').then((m) => ({ default: m.WorkspaceEditorPanel })))
const WorkspaceGitHubPanel = lazy(() => import('./WorkspaceGitHubPanel').then((m) => ({ default: m.WorkspaceGitHubPanel })))
const WorkspaceIntegrationPanel = lazy(() => import('./WorkspaceIntegrationPanel').then((m) => ({ default: m.WorkspaceIntegrationPanel })))
const WorkspaceReviewPanel = lazy(() => import('./WorkspaceReviewPanel').then((m) => ({ default: m.WorkspaceReviewPanel })))
const WorkspaceScriptsPanel = lazy(() => import('./WorkspaceScriptsPanel').then((m) => ({ default: m.WorkspaceScriptsPanel })))
const WorkspaceSearchPanel = lazy(() => import('./WorkspaceSearchPanel').then((m) => ({ default: m.WorkspaceSearchPanel })))
const WorkspaceWebPreviewPanel = lazy(() => import('./WorkspaceWebPreviewPanel').then((m) => ({ default: m.WorkspaceWebPreviewPanel })))
const WorkspaceWorktreePanel = lazy(() => import('./WorkspaceWorktreePanel').then((m) => ({ default: m.WorkspaceWorktreePanel })))

// Warm common panel chunks just after first paint. The earlier idle-only strategy
// often waited until after the first click, leaving the initial open on the slow
// lazy-load path. Monaco remains deferred because it is substantially heavier.
let panelsPrefetched = false
function prefetchPanelChunks(): void {
  if (panelsPrefetched) return
  panelsPrefetched = true

  const prefetchCommonPanels = (): void => {
    void import('./WorkspaceGitHubPanel'); void import('./WorkspaceReviewPanel')
    void import('./WorkspaceWorktreePanel'); void import('./WorkspaceBackgroundPanel')
    void import('./WorkspaceScriptsPanel'); void import('./WorkspaceWebPreviewPanel')
    void import('./WorkspaceIntegrationPanel'); void import('./WorkspaceSearchPanel')
  }

  const prefetchEditor = (): void => { void import('./WorkspaceEditorPanel') }
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
import { IntegrationsStatusChips } from './IntegrationsStatusChips'
import { WorkspaceStatusSummary } from './WorkspaceStatusSummary'
import { ErrorBoundary } from '../common/ErrorBoundary'

interface WorkspaceSurfaceProps {
  workspace: Workspace
  isActive?: boolean
  agentProfiles?: AgentProfile[]
  maximizedPaneId: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
  scriptsVisible: boolean
  webPreviewVisible: boolean
  integrationVisible: boolean
  searchVisible: boolean
  onCloseScripts: () => void
  onCloseWebPreview: () => void
  onCloseIntegration: () => void
  onCloseSearch: () => void
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
}

const DEFAULT_EDITOR_WIDTH = 40
const DEFAULT_REVIEW_WIDTH = 36
const DEFAULT_GITHUB_WIDTH = 40
const DEFAULT_BACKGROUND_WIDTH = 28
const DEFAULT_WORKTREE_WIDTH = 36
const INNER_MIN_SIZE = 10

interface SidePanelEntry {
  id: string
  defaultSize: number
  onResize: (size: number) => void
  content: ReactElement
}

function WorkspaceSurfaceComponent({
  isActive = true,
  maximizedPaneId,
  onClosePane,
  onActivatePane,
  activePaneId,
  agentProfiles = [],
  scriptsVisible,
  webPreviewVisible,
  integrationVisible,
  searchVisible,
  onCloseScripts,
  onCloseWebPreview,
  onCloseIntegration,
  onCloseSearch,
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
  const worktreeVisible = workspace.worktreePanelVisible === true
  const worktreeExpanded = workspace.worktreePanelExpanded === true
  const worktreeWidth = worktreeExpanded ? 70 : workspace.worktreePanelWidthPercent ?? DEFAULT_WORKTREE_WIDTH
  const [scriptsExpanded, setScriptsExpanded] = useState(false)
  const [webPreviewExpanded, setWebPreviewExpanded] = useState(false)
  const [integrationExpanded, setIntegrationExpanded] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  // F2 split-tree is the default layout. Keep the fixed grid as a fallback
  // (toggle via F2) so users can recover if a tree layout gets awkward.
  const splitLayoutEnabled = useUIStore((s) => s.splitLayoutEnabled)
  const tree = usePaneLayoutStore((s) => s.trees[workspace.id] ?? null)
  const syncTree = usePaneLayoutStore((s) => s.sync)
  const resizeTree = usePaneLayoutStore((s) => s.resize)
  const moveTree = usePaneLayoutStore((s) => s.move)

  useEffect(() => {
    syncTree(workspace.id, workspace.panes)
  }, [syncTree, workspace.id, workspace.panes])

  const scriptsWidth = scriptsExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const webPreviewWidth = webPreviewExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const integrationWidth = integrationExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const searchWidth = searchExpanded ? 70 : DEFAULT_REVIEW_WIDTH

  const hasSidePanels = editorVisible || reviewVisible || githubVisible || backgroundVisible || worktreeVisible || scriptsVisible || webPreviewVisible || integrationVisible || searchVisible

  const layoutSizes = getWorkspacePanelSizes({
    editorVisible,
    editorWidth,
    githubVisible,
    githubWidth,
    reviewVisible,
    reviewWidth,
    backgroundVisible,
    backgroundWidth,
    worktreeVisible,
    worktreeWidth,
    scriptsVisible,
    scriptsWidth,
    webPreviewVisible,
    webPreviewWidth,
    integrationVisible,
    integrationWidth,
    searchVisible,
    searchWidth
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

  // Inner group key: changes on visibility/expanded state → inner panels remount.
  // Outer group key is workspace.id only → WorkspaceGrid NEVER remounts on panel toggle.
  const innerPanelKey = [
    workspace.id,
    githubVisible ? 'gh' : '_', githubExpanded ? 'GH' : '_',
    reviewVisible ? 're' : '_', reviewExpanded ? 'RE' : '_',
    editorVisible ? 'ed' : '_', editorExpanded ? 'ED' : '_',
    backgroundVisible ? 'bg' : '_', backgroundExpanded ? 'BG' : '_',
    worktreeVisible ? 'wt' : '_', worktreeExpanded ? 'WT' : '_',
    scriptsVisible ? 'sc' : '_',
    webPreviewVisible ? 'wp' : '_',
    integrationVisible ? 'in' : '_',
    searchVisible ? 'se' : '_',
  ].join('')

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
      onResize: (size) => {
        if (Math.abs(size - toInnerPct(layoutSizes.github)) < 1) return
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedGitHubWidth.current) < 2) return
        lastPersistedGitHubWidth.current = nextWidth
        onUpdateGitHubState({ workspaceId: workspace.id, githubPanelWidthPercent: nextWidth, githubPanelExpanded: nextWidth >= 68 })
      },
      content: (
        <WorkspaceGitHubPanel
          workspace={workspace}
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
      onResize: (size) => {
        if (Math.abs(size - toInnerPct(layoutSizes.review)) < 1) return
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedReviewWidth.current) < 2) return
        lastPersistedReviewWidth.current = nextWidth
        onUpdateReviewState({ workspaceId: workspace.id, reviewPanelWidthPercent: nextWidth, reviewPanelExpanded: nextWidth >= 68 })
      },
      content: (
        <WorkspaceReviewPanel
          workspace={workspace}
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
      onResize: (size) => {
        if (Math.abs(size - toInnerPct(layoutSizes.editor)) < 1) return
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedWidth.current) < 2) return
        lastPersistedWidth.current = nextWidth
        onUpdateEditorState({ workspaceId: workspace.id, editorWidthPercent: nextWidth, editorExpanded: nextWidth >= 68 })
      },
      content: (
        <WorkspaceEditorPanel
          workspace={workspace}
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
      onResize: (size) => {
        if (Math.abs(size - toInnerPct(layoutSizes.background)) < 1) return
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedBackgroundWidth.current) < 2) return
        lastPersistedBackgroundWidth.current = nextWidth
        onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelWidthPercent: nextWidth, backgroundPanelExpanded: nextWidth >= 68 })
      },
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
      onResize: (size) => {
        if (Math.abs(size - toInnerPct(layoutSizes.worktree)) < 1) return
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedWorktreeWidth.current) < 2) return
        lastPersistedWorktreeWidth.current = nextWidth
        onUpdateWorktreeState({ workspaceId: workspace.id, worktreePanelWidthPercent: nextWidth, worktreePanelExpanded: nextWidth >= 68 })
      },
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

  if (scriptsVisible) {
    sidePanels.push({
      id: 'scripts',
      defaultSize: toInnerPct(layoutSizes.scripts),
      onResize: () => undefined,
      content: (
        <WorkspaceScriptsPanel
          workspace={workspace}
          isExpanded={scriptsExpanded}
          onCollapse={onCloseScripts}
          onToggleExpanded={() => setScriptsExpanded((value) => !value)}
          onOpenBackground={() => onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelVisible: true, backgroundPanelExpanded: workspace.backgroundPanelExpanded ?? false })}
        />
      )
    })
  }

  if (webPreviewVisible) {
    sidePanels.push({
      id: 'web-preview',
      defaultSize: toInnerPct(layoutSizes.webPreview),
      onResize: () => undefined,
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
      onResize: () => undefined,
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
      onResize: () => undefined,
      content: (
        <WorkspaceSearchPanel
          workspace={workspace}
          isExpanded={searchExpanded}
          onCollapse={onCloseSearch}
          onToggleExpanded={() => setSearchExpanded((value) => !value)}
        />
      )
    })
  }

  const grid = splitLayoutEnabled ? (
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
  )

  const folderName = workspace.rootPath ? workspace.rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() : null
  const showSubPath = Boolean(folderName && folderName.toLowerCase() !== workspace.name.toLowerCase())

  const toolbar = (
    <header className="workspace-topbar" aria-label="Workspace status">
      <div className="workspace-topbar-breadcrumb">
        <span className="workspace-topbar-name">{workspace.name}</span>
        {showSubPath ? (
          <>
            <span className="workspace-topbar-divider">/</span>
            <span className="workspace-topbar-path" title={workspace.rootPath}>{folderName}</span>
          </>
        ) : null}
      </div>
      <div className="workspace-topbar-spacer" />
      <WorkspaceStatusSummary workspace={workspace} />
      <IntegrationsStatusChips workspace={workspace} isActive={isActive} />
    </header>
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
  const innerMaxSize = sidePanels.length > 1 ? 100 - INNER_MIN_SIZE * (sidePanels.length - 1) : 100

  return (
    <div className="workspace-surface-frame">
      {toolbar}
      <div className="workspace-surface-content">
        {/*
          Outer PanelGroup key = workspace.id ONLY.
          WorkspaceGrid lives here and never remounts when side panels toggle
          or when a pane is maximized/restored.
          Side panels live in an inner PanelGroup that can safely remount.
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
                minSize={25}
                maxSize={70}
                defaultSize={combinedSideSize}
                onResize={(size) => { outerSideSizeRef.current = size }}
              >
                <PanelGroup key={innerPanelKey} direction="horizontal">
                  {sidePanels.map((panel, i) => (
                    <Fragment key={panel.id}>
                      {i > 0 && (
                        <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
                      )}
                      <Panel
                        minSize={INNER_MIN_SIZE}
                        maxSize={innerMaxSize}
                        defaultSize={panel.defaultSize}
                        onResize={panel.onResize}
                      >
                        <ErrorBoundary label="este painel">
                          <Suspense fallback={<div className="workspace-editor-panel" data-testid="panel-loading" />}>
                            {panel.content}
                          </Suspense>
                        </ErrorBoundary>
                      </Panel>
                    </Fragment>
                  ))}
                </PanelGroup>
              </Panel>
            </>
          ) : null}
        </PanelGroup>
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
    previous.scriptsVisible === next.scriptsVisible &&
    previous.webPreviewVisible === next.webPreviewVisible &&
    previous.integrationVisible === next.integrationVisible &&
    previous.searchVisible === next.searchVisible &&
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
  scriptsVisible: boolean
  scriptsWidth: number
  webPreviewVisible: boolean
  webPreviewWidth: number
  integrationVisible: boolean
  integrationWidth: number
  searchVisible: boolean
  searchWidth: number
}

interface WorkspacePanelSizeOutput {
  grid: number
  gridMinSize: number
  editor: number
  github: number
  review: number
  background: number
  worktree: number
  scripts: number
  webPreview: number
  integration: number
  search: number
}

function getWorkspacePanelSizes(input: WorkspacePanelSizeInput): WorkspacePanelSizeOutput {
  const editor = input.editorVisible ? clampPanelSize(input.editorWidth, 25, 70) : 0
  const github = input.githubVisible ? clampPanelSize(input.githubWidth, 25, 70) : 0
  const review = input.reviewVisible ? clampPanelSize(input.reviewWidth, 24, 70) : 0
  const background = input.backgroundVisible ? clampPanelSize(input.backgroundWidth, 24, 70) : 0
  const worktree = input.worktreeVisible ? clampPanelSize(input.worktreeWidth, 24, 70) : 0
  const scripts = input.scriptsVisible ? clampPanelSize(input.scriptsWidth, 25, 70) : 0
  const webPreview = input.webPreviewVisible ? clampPanelSize(input.webPreviewWidth, 25, 70) : 0
  const integration = input.integrationVisible ? clampPanelSize(input.integrationWidth, 25, 70) : 0
  const search = input.searchVisible ? clampPanelSize(input.searchWidth, 24, 70) : 0
  const visibleSideCount = Number(input.editorVisible) + Number(input.githubVisible) + Number(input.reviewVisible) + Number(input.backgroundVisible) + Number(input.worktreeVisible) + Number(input.scriptsVisible) + Number(input.webPreviewVisible) + Number(input.integrationVisible) + Number(input.searchVisible)

  if (visibleSideCount === 0) {
    return { grid: 100, gridMinSize: 30, editor: 0, github: 0, review: 0, background: 0, worktree: 0, scripts: 0, webPreview: 0, integration: 0, search: 0 }
  }

  if (visibleSideCount === 1) {
    const side = input.editorVisible ? editor
      : input.githubVisible ? github
        : input.reviewVisible ? review
          : input.backgroundVisible ? background
            : input.worktreeVisible ? worktree
              : input.scriptsVisible ? scripts
                : input.webPreviewVisible ? webPreview
                  : input.integrationVisible ? integration
                    : search
    return {
      grid: 100 - side,
      gridMinSize: 30,
      editor,
      github,
      review,
      background,
      worktree,
      scripts,
      webPreview,
      integration,
      search
    }
  }

  const maxCombinedSideWidth = 70
  const combined = editor + github + review + background + worktree + scripts + webPreview + integration + search
  const scale = combined > maxCombinedSideWidth ? maxCombinedSideWidth / combined : 1
  const normalizedEditor = input.editorVisible ? Math.max(25, Math.round(editor * scale)) : 0
  const normalizedGitHub = input.githubVisible ? Math.max(25, Math.round(github * scale)) : 0
  const normalizedReview = input.reviewVisible ? Math.max(24, Math.round(review * scale)) : 0
  const normalizedBackground = input.backgroundVisible ? Math.max(24, Math.round(background * scale)) : 0
  const normalizedWorktree = input.worktreeVisible ? Math.max(24, Math.round(worktree * scale)) : 0
  const normalizedScripts = input.scriptsVisible ? Math.max(25, Math.round(scripts * scale)) : 0
  const normalizedWebPreview = input.webPreviewVisible ? Math.max(25, Math.round(webPreview * scale)) : 0
  const normalizedIntegration = input.integrationVisible ? Math.max(25, Math.round(integration * scale)) : 0
  const normalizedSearch = input.searchVisible ? Math.max(24, Math.round(search * scale)) : 0
  const normalizedCombined = normalizedEditor + normalizedGitHub + normalizedReview + normalizedBackground + normalizedWorktree + normalizedScripts + normalizedWebPreview + normalizedIntegration + normalizedSearch

  return {
    grid: Math.max(30, 100 - normalizedCombined),
    gridMinSize: 30,
    editor: normalizedEditor,
    github: normalizedGitHub,
    review: normalizedReview,
    background: normalizedBackground,
    worktree: normalizedWorktree,
    scripts: normalizedScripts,
    webPreview: normalizedWebPreview,
    integration: normalizedIntegration,
    search: normalizedSearch
  }
}

function clampPanelSize(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, Math.round(width)))
}
