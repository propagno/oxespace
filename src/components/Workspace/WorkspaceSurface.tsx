import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import type { AgentProfile } from '../../../shared/types/agent'
import type { UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceWorktreeStateInput, Workspace } from '../../../shared/types/workspace'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceBackgroundPanel } from './WorkspaceBackgroundPanel'
import { WorkspaceEditorPanel } from './WorkspaceEditorPanel'
import { WorkspaceGitHubPanel } from './WorkspaceGitHubPanel'
import { WorkspaceIntegrationPanel } from './WorkspaceIntegrationPanel'
import { WorkspaceReviewPanel } from './WorkspaceReviewPanel'
import { WorkspaceOxePanel } from './WorkspaceOxePanel'
import { WorkspaceScriptsPanel } from './WorkspaceScriptsPanel'
import { WorkspaceWebPreviewPanel } from './WorkspaceWebPreviewPanel'
import { WorkspaceWorktreePanel } from './WorkspaceWorktreePanel'
import { ToolsMenu } from './ToolsMenu'
import { IntegrationsStatusChips } from './IntegrationsStatusChips'
import { WorkspaceStatusSummary } from './WorkspaceStatusSummary'

interface WorkspaceSurfaceProps {
  workspace: Workspace
  agentProfiles?: AgentProfile[]
  maximizedPaneId: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
  onOpenCommandPalette: () => void
  onOpenWorkspaceSettings: () => void
  onOpenHistory: () => void
  onOpenMcp: () => void
  onOpenSkills: () => void
  onOpenScripts: () => void
  onOpenWebPreview: () => void
  onOpenIntegration: () => void
  onToggleOxe: () => void
  scriptsVisible: boolean
  webPreviewVisible: boolean
  integrationVisible: boolean
  oxeVisible: boolean
  onCloseScripts: () => void
  onCloseWebPreview: () => void
  onCloseIntegration: () => void
  onCloseOxe: () => void
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

export function WorkspaceSurface({
  maximizedPaneId,
  onClosePane,
  onActivatePane,
  activePaneId,
  agentProfiles = [],
  onOpenCommandPalette,
  onOpenWorkspaceSettings,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onOpenScripts,
  onOpenWebPreview,
  onOpenIntegration,
  onToggleOxe,
  scriptsVisible,
  webPreviewVisible,
  integrationVisible,
  oxeVisible,
  onCloseScripts,
  onCloseWebPreview,
  onCloseIntegration,
  onCloseOxe,
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
  const [oxeExpanded, setOxeExpanded] = useState(false)
  const scriptsWidth = scriptsExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const webPreviewWidth = webPreviewExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const integrationWidth = integrationExpanded ? 70 : DEFAULT_GITHUB_WIDTH
  const oxeWidth = oxeExpanded ? 70 : DEFAULT_WORKTREE_WIDTH

  const hasSidePanels = editorVisible || reviewVisible || githubVisible || backgroundVisible || worktreeVisible || scriptsVisible || webPreviewVisible || integrationVisible || oxeVisible

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
    oxeVisible,
    oxeWidth
  })

  // Total width of all side panels combined (as % of workspace)
  const combinedSideSize = hasSidePanels ? 100 - layoutSizes.grid : 0

  // Resize outer sides Panel imperatively when combined side size changes.
  // This happens when panels are toggled or expanded — the inner PanelGroup remounts
  // but the outer Panel must reflect the new total side width.
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
    oxeVisible ? 'ox' : '_', oxeExpanded ? 'OX' : '_',
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

  if (oxeVisible) {
    sidePanels.push({
      id: 'oxe',
      defaultSize: toInnerPct(layoutSizes.oxe),
      onResize: () => undefined,
      content: (
        <WorkspaceOxePanel
          workspace={workspace}
          isExpanded={oxeExpanded}
          onCollapse={onCloseOxe}
          onToggleExpanded={() => setOxeExpanded((value) => !value)}
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

  const grid = (
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

  const toolbar = (
    <header className="workspace-topbar" aria-label="Workspace tools">
      {/* Aggregate workspace status — fills what used to be empty topbar
          space with a glanceable "N agents · X thinking · Y awaiting · $Z"
          summary so multi-agent vibe coding becomes scannable in 1s. */}
      <WorkspaceStatusSummary workspace={workspace} />
      <div className="workspace-topbar-spacer" />
      <IntegrationsStatusChips workspace={workspace} />
      <div className="workspace-toolbar-actions" aria-label="Workspace actions">
        <ToolsMenu
          active={{ github: githubVisible, editor: editorVisible, review: reviewVisible, background: backgroundVisible, worktree: worktreeVisible, scripts: scriptsVisible, webPreview: webPreviewVisible, integration: integrationVisible, oxe: oxeVisible }}
          onOpenCommandPalette={onOpenCommandPalette}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onToggleEditor={() => onUpdateEditorState({ workspaceId: workspace.id, editorVisible: !editorVisible, editorExpanded: editorVisible ? false : workspace.editorExpanded })}
          onToggleGitHub={() => onUpdateGitHubState({ workspaceId: workspace.id, githubPanelVisible: !githubVisible, githubPanelExpanded: githubVisible ? false : workspace.githubPanelExpanded })}
          onToggleReview={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelVisible: !reviewVisible, reviewPanelExpanded: reviewVisible ? false : workspace.reviewPanelExpanded })}
          onToggleBackground={() => onUpdateBackgroundState({ workspaceId: workspace.id, backgroundPanelVisible: !backgroundVisible, backgroundPanelExpanded: backgroundVisible ? false : workspace.backgroundPanelExpanded })}
          onToggleWorktree={() => onUpdateWorktreeState({ workspaceId: workspace.id, worktreePanelVisible: !worktreeVisible, worktreePanelExpanded: worktreeVisible ? false : workspace.worktreePanelExpanded })}
          onOpenScripts={onOpenScripts}
          onOpenWebPreview={onOpenWebPreview}
          onOpenIntegration={onOpenIntegration}
          onOpenHistory={onOpenHistory}
          onOpenMcp={onOpenMcp}
          onOpenSkills={onOpenSkills}
          onToggleOxe={onToggleOxe}
        />
      </div>
    </header>
  )

  if (maximizedPaneId) {
    return (
      <div className="workspace-surface-frame">
        {toolbar}
        <div className="workspace-surface-content">{grid}</div>
      </div>
    )
  }

  const innerMaxSize = sidePanels.length > 1 ? 100 - INNER_MIN_SIZE * (sidePanels.length - 1) : 100

  return (
    <div className="workspace-surface-frame">
      {toolbar}
      <div className="workspace-surface-content">
        {/*
          Outer PanelGroup key = workspace.id ONLY.
          WorkspaceGrid lives here and never remounts when side panels toggle.
          Side panels live in an inner PanelGroup that can safely remount.
        */}
        <PanelGroup key={workspace.id} direction="horizontal">
          <Panel id={`${workspace.id}-grid`} minSize={layoutSizes.gridMinSize}>
            {grid}
          </Panel>

          {hasSidePanels && (
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
                        {panel.content}
                      </Panel>
                    </Fragment>
                  ))}
                </PanelGroup>
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  )
}

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
  oxeVisible: boolean
  oxeWidth: number
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
  oxe: number
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
  const oxe = input.oxeVisible ? clampPanelSize(input.oxeWidth, 25, 70) : 0
  const visibleSideCount = Number(input.editorVisible) + Number(input.githubVisible) + Number(input.reviewVisible) + Number(input.backgroundVisible) + Number(input.worktreeVisible) + Number(input.scriptsVisible) + Number(input.webPreviewVisible) + Number(input.integrationVisible) + Number(input.oxeVisible)

  if (visibleSideCount === 0) {
    return { grid: 100, gridMinSize: 30, editor: 0, github: 0, review: 0, background: 0, worktree: 0, scripts: 0, webPreview: 0, integration: 0, oxe: 0 }
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
                    : oxe
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
      oxe
    }
  }

  const maxCombinedSideWidth = 70
  const combined = editor + github + review + background + worktree + scripts + webPreview + integration + oxe
  const scale = combined > maxCombinedSideWidth ? maxCombinedSideWidth / combined : 1
  const normalizedEditor = input.editorVisible ? Math.max(25, Math.round(editor * scale)) : 0
  const normalizedGitHub = input.githubVisible ? Math.max(25, Math.round(github * scale)) : 0
  const normalizedReview = input.reviewVisible ? Math.max(24, Math.round(review * scale)) : 0
  const normalizedBackground = input.backgroundVisible ? Math.max(24, Math.round(background * scale)) : 0
  const normalizedWorktree = input.worktreeVisible ? Math.max(24, Math.round(worktree * scale)) : 0
  const normalizedScripts = input.scriptsVisible ? Math.max(25, Math.round(scripts * scale)) : 0
  const normalizedWebPreview = input.webPreviewVisible ? Math.max(25, Math.round(webPreview * scale)) : 0
  const normalizedIntegration = input.integrationVisible ? Math.max(25, Math.round(integration * scale)) : 0
  const normalizedOxe = input.oxeVisible ? Math.max(25, Math.round(oxe * scale)) : 0
  const normalizedCombined = normalizedEditor + normalizedGitHub + normalizedReview + normalizedBackground + normalizedWorktree + normalizedScripts + normalizedWebPreview + normalizedIntegration + normalizedOxe

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
    oxe: normalizedOxe
  }
}

function clampPanelSize(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, Math.round(width)))
}
