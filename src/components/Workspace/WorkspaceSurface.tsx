import { Fragment, useEffect, useRef, type ReactElement } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import type { UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, Workspace } from '../../../shared/types/workspace'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceAgentsPanel } from './WorkspaceAgentsPanel'
import { WorkspaceEditorPanel } from './WorkspaceEditorPanel'
import { WorkspaceGitHubPanel } from './WorkspaceGitHubPanel'
import { WorkspaceOxePanel } from './WorkspaceOxePanel'
import { WorkspaceReviewPanel } from './WorkspaceReviewPanel'
import { ToolsMenu } from './ToolsMenu'

interface WorkspaceSurfaceProps {
  workspace: Workspace
  maximizedPaneId: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
  onOpenCommandPalette: () => void
  onOpenWorkspaceSettings: () => void
  onUpdateEditorState: (input: {
    workspaceId: string
    editorVisible?: boolean
    editorExpanded?: boolean
    editorWidthPercent?: number
  }) => void
  onUpdateOxeState: (input: {
    workspaceId: string
    oxePanelVisible?: boolean
    oxePanelExpanded?: boolean
    oxePanelWidthPercent?: number
  }) => void
  onUpdateAgentsState: (input: {
    workspaceId: string
    agentsPanelVisible?: boolean
    agentsPanelExpanded?: boolean
    agentsPanelWidthPercent?: number
  }) => void
  onUpdateReviewState: (input: UpdateWorkspaceReviewStateInput) => void
  onUpdateGitHubState: (input: UpdateWorkspaceGitHubStateInput) => void
  onOpenOxeArtifact: (relativePath: string) => void
  onRunCommand: (command: string) => void
  onOpenWorkflowArtifact: (content: string, title: string) => void
  activePaneId: string | null
}

const DEFAULT_EDITOR_WIDTH = 40
const DEFAULT_OXE_WIDTH = 36
const DEFAULT_AGENTS_WIDTH = 36
const DEFAULT_REVIEW_WIDTH = 36
const DEFAULT_GITHUB_WIDTH = 40
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
  onOpenCommandPalette,
  onOpenOxeArtifact,
  onOpenWorkflowArtifact,
  onOpenWorkspaceSettings,
  onRunCommand,
  onSplitPane,
  onToggleMaximize,
  onUpdateEditorState,
  onUpdateAgentsState,
  onUpdateGitHubState,
  onUpdateOxeState,
  onUpdateReviewState,
  workspace
}: WorkspaceSurfaceProps): ReactElement {

  const lastPersistedWidth = useRef(workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH)
  const lastPersistedOxeWidth = useRef(workspace.oxePanelWidthPercent ?? DEFAULT_OXE_WIDTH)
  const lastPersistedAgentsWidth = useRef(workspace.agentsPanelWidthPercent ?? DEFAULT_AGENTS_WIDTH)
  const lastPersistedReviewWidth = useRef(workspace.reviewPanelWidthPercent ?? DEFAULT_REVIEW_WIDTH)
  const lastPersistedGitHubWidth = useRef(workspace.githubPanelWidthPercent ?? DEFAULT_GITHUB_WIDTH)

  // Outer "sides" panel — tracks actual rendered size for inner % ↔ total % conversion
  const outerSidePanelRef = useRef<ImperativePanelHandle>(null)
  const outerSideSizeRef = useRef(0)

  const editorVisible = workspace.editorVisible === true
  const editorExpanded = workspace.editorExpanded === true
  const editorWidth = editorExpanded ? 70 : workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH
  const oxeVisible = workspace.oxePanelVisible === true
  const oxeExpanded = workspace.oxePanelExpanded === true
  const oxeWidth = oxeExpanded ? 70 : workspace.oxePanelWidthPercent ?? DEFAULT_OXE_WIDTH
  const agentsVisible = workspace.agentsPanelVisible === true
  const agentsExpanded = workspace.agentsPanelExpanded === true
  const agentsWidth = agentsExpanded ? 70 : workspace.agentsPanelWidthPercent ?? DEFAULT_AGENTS_WIDTH
  const reviewVisible = workspace.reviewPanelVisible === true
  const reviewExpanded = workspace.reviewPanelExpanded === true
  const reviewWidth = reviewExpanded ? 70 : workspace.reviewPanelWidthPercent ?? DEFAULT_REVIEW_WIDTH
  const githubVisible = workspace.githubPanelVisible === true
  const githubExpanded = workspace.githubPanelExpanded === true
  const githubWidth = githubExpanded ? 70 : workspace.githubPanelWidthPercent ?? DEFAULT_GITHUB_WIDTH

  const hasSidePanels = editorVisible || oxeVisible || agentsVisible || reviewVisible || githubVisible

  const layoutSizes = getWorkspacePanelSizes({
    editorVisible,
    editorWidth,
    agentsVisible,
    agentsWidth,
    githubVisible,
    githubWidth,
    oxeVisible,
    oxeWidth,
    reviewVisible,
    reviewWidth
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
    agentsVisible ? 'ag' : '_', agentsExpanded ? 'AG' : '_',
    editorVisible ? 'ed' : '_', editorExpanded ? 'ED' : '_',
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

  if (agentsVisible) {
    sidePanels.push({
      id: 'agents',
      defaultSize: toInnerPct(layoutSizes.agents),
      onResize: (size) => {
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedAgentsWidth.current) < 2) return
        lastPersistedAgentsWidth.current = nextWidth
        onUpdateAgentsState({ workspaceId: workspace.id, agentsPanelWidthPercent: nextWidth, agentsPanelExpanded: nextWidth >= 68 })
      },
      content: (
        <WorkspaceAgentsPanel
          workspace={workspace}
          activePaneId={activePaneId}
          isExpanded={agentsExpanded}
          onCollapse={() => onUpdateAgentsState({ workspaceId: workspace.id, agentsPanelVisible: false, agentsPanelExpanded: false })}
          onToggleExpanded={() => onUpdateAgentsState({ workspaceId: workspace.id, agentsPanelExpanded: !agentsExpanded, agentsPanelWidthPercent: agentsExpanded ? DEFAULT_AGENTS_WIDTH : 70 })}
          onOpenArtifact={onOpenWorkflowArtifact}
        />
      )
    })
  }

  if (editorVisible) {
    sidePanels.push({
      id: 'editor',
      defaultSize: toInnerPct(layoutSizes.editor),
      onResize: (size) => {
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

  if (oxeVisible) {
    sidePanels.push({
      id: 'oxe',
      defaultSize: toInnerPct(layoutSizes.oxe),
      onResize: (size) => {
        const nextWidth = Math.round(size * outerSideSizeRef.current / 100)
        if (Math.abs(nextWidth - lastPersistedOxeWidth.current) < 2) return
        lastPersistedOxeWidth.current = nextWidth
        onUpdateOxeState({ workspaceId: workspace.id, oxePanelWidthPercent: nextWidth, oxePanelExpanded: nextWidth >= 68 })
      },
      content: (
        <WorkspaceOxePanel
          workspace={workspace}
          isExpanded={oxeExpanded}
          onCollapse={() => onUpdateOxeState({ workspaceId: workspace.id, oxePanelVisible: false, oxePanelExpanded: false })}
          onToggleExpanded={() => onUpdateOxeState({ workspaceId: workspace.id, oxePanelExpanded: !oxeExpanded, oxePanelWidthPercent: oxeExpanded ? DEFAULT_OXE_WIDTH : 70 })}
          onOpenArtifact={onOpenOxeArtifact}
          onRunOxeCommand={onRunCommand}
        />
      )
    })
  }

  const grid = (
    <WorkspaceGrid
      workspace={workspace}
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
      <div className="workspace-topbar-spacer" />
      <div className="workspace-toolbar-actions" aria-label="Workspace actions">
        <ToolsMenu
          active={{ github: githubVisible, editor: editorVisible, oxe: oxeVisible, agents: agentsVisible, review: reviewVisible }}
          onOpenCommandPalette={onOpenCommandPalette}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onToggleAgents={() => onUpdateAgentsState({ workspaceId: workspace.id, agentsPanelVisible: !agentsVisible, agentsPanelExpanded: agentsVisible ? false : workspace.agentsPanelExpanded })}
          onToggleEditor={() => onUpdateEditorState({ workspaceId: workspace.id, editorVisible: !editorVisible, editorExpanded: editorVisible ? false : workspace.editorExpanded })}
          onToggleGitHub={() => onUpdateGitHubState({ workspaceId: workspace.id, githubPanelVisible: !githubVisible, githubPanelExpanded: githubVisible ? false : workspace.githubPanelExpanded })}
          onToggleOxe={() => onUpdateOxeState({ workspaceId: workspace.id, oxePanelVisible: !oxeVisible, oxePanelExpanded: oxeVisible ? false : workspace.oxePanelExpanded })}
          onToggleReview={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelVisible: !reviewVisible, reviewPanelExpanded: reviewVisible ? false : workspace.reviewPanelExpanded })}
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
  agentsVisible: boolean
  agentsWidth: number
  githubVisible: boolean
  githubWidth: number
  oxeVisible: boolean
  oxeWidth: number
  reviewVisible: boolean
  reviewWidth: number
}

function getWorkspacePanelSizes(input: WorkspacePanelSizeInput): { grid: number; gridMinSize: number; editor: number; agents: number; github: number; oxe: number; review: number } {
  const editor = input.editorVisible ? clampPanelSize(input.editorWidth, 25, 70) : 0
  const agents = input.agentsVisible ? clampPanelSize(input.agentsWidth, 24, 70) : 0
  const github = input.githubVisible ? clampPanelSize(input.githubWidth, 25, 70) : 0
  const oxe = input.oxeVisible ? clampPanelSize(input.oxeWidth, 24, 70) : 0
  const review = input.reviewVisible ? clampPanelSize(input.reviewWidth, 24, 70) : 0
  const visibleSideCount = Number(input.editorVisible) + Number(input.agentsVisible) + Number(input.githubVisible) + Number(input.oxeVisible) + Number(input.reviewVisible)

  if (visibleSideCount === 0) {
    return { grid: 100, gridMinSize: 30, editor: 0, agents: 0, github: 0, oxe: 0, review: 0 }
  }

  if (visibleSideCount === 1) {
    const side = input.editorVisible ? editor : input.agentsVisible ? agents : input.githubVisible ? github : input.oxeVisible ? oxe : review
    return {
      grid: 100 - side,
      gridMinSize: 30,
      editor,
      agents,
      github,
      oxe,
      review
    }
  }

  const maxCombinedSideWidth = 70
  const combined = editor + agents + github + oxe + review
  const scale = combined > maxCombinedSideWidth ? maxCombinedSideWidth / combined : 1
  const normalizedEditor = input.editorVisible ? Math.max(25, Math.round(editor * scale)) : 0
  const normalizedAgents = input.agentsVisible ? Math.max(24, Math.round(agents * scale)) : 0
  const normalizedGitHub = input.githubVisible ? Math.max(25, Math.round(github * scale)) : 0
  const normalizedOxe = input.oxeVisible ? Math.max(24, Math.round(oxe * scale)) : 0
  const normalizedReview = input.reviewVisible ? Math.max(24, Math.round(review * scale)) : 0
  const normalizedCombined = normalizedEditor + normalizedAgents + normalizedGitHub + normalizedOxe + normalizedReview

  return {
    grid: Math.max(30, 100 - normalizedCombined),
    gridMinSize: 30,
    editor: normalizedEditor,
    agents: normalizedAgents,
    github: normalizedGitHub,
    oxe: normalizedOxe,
    review: normalizedReview
  }
}

function clampPanelSize(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, Math.round(width)))
}
