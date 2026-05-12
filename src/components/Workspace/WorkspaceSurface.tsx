import { useRef, type ReactElement } from 'react'
import { Command, GitCompareArrows, Settings2, UsersRound, Workflow } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { UpdateWorkspaceReviewStateInput, Workspace } from '../../../shared/types/workspace'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceAgentsPanel } from './WorkspaceAgentsPanel'
import { WorkspaceEditorPanel } from './WorkspaceEditorPanel'
import { WorkspaceOxePanel } from './WorkspaceOxePanel'
import { WorkspaceReviewPanel } from './WorkspaceReviewPanel'

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
  onOpenOxeArtifact: (relativePath: string) => void
  onRunOxeCommand: (command: string) => void
  onOpenWorkflowArtifact: (content: string, title: string) => void
  activePaneId: string | null
}

const DEFAULT_EDITOR_WIDTH = 40
const DEFAULT_OXE_WIDTH = 36
const DEFAULT_AGENTS_WIDTH = 36
const DEFAULT_REVIEW_WIDTH = 36

export function WorkspaceSurface({
  maximizedPaneId,
  onClosePane,
  onActivatePane,
  activePaneId,
  onOpenCommandPalette,
  onOpenOxeArtifact,
  onOpenWorkflowArtifact,
  onOpenWorkspaceSettings,
  onRunOxeCommand,
  onSplitPane,
  onToggleMaximize,
  onUpdateEditorState,
  onUpdateAgentsState,
  onUpdateOxeState,
  onUpdateReviewState,
  workspace
}: WorkspaceSurfaceProps): ReactElement {
  const lastPersistedWidth = useRef(workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH)
  const lastPersistedOxeWidth = useRef(workspace.oxePanelWidthPercent ?? DEFAULT_OXE_WIDTH)
  const lastPersistedAgentsWidth = useRef(workspace.agentsPanelWidthPercent ?? DEFAULT_AGENTS_WIDTH)
  const lastPersistedReviewWidth = useRef(workspace.reviewPanelWidthPercent ?? DEFAULT_REVIEW_WIDTH)
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
  const editorToggleLabel = editorVisible ? 'Collapse workspace editor' : 'Open workspace editor'
  const oxeToggleLabel = oxeVisible ? 'Collapse OXE panel' : 'Open OXE panel'
  const agentsToggleLabel = agentsVisible ? 'Collapse Agents panel' : 'Open Agents panel'
  const reviewToggleLabel = reviewVisible ? 'Collapse review panel' : 'Open review panel'
  const layoutSizes = getWorkspacePanelSizes({
    editorVisible,
    editorWidth,
    agentsVisible,
    agentsWidth,
    oxeVisible,
    oxeWidth,
    reviewVisible,
    reviewWidth
  })
  const panelGroupKey = `${workspace.id}:${editorVisible ? 'editor' : 'no-editor'}:${agentsVisible ? 'agents' : 'no-agents'}:${oxeVisible ? 'oxe' : 'no-oxe'}:${reviewVisible ? 'review' : 'no-review'}:${editorExpanded ? 'editor-expanded' : 'editor-normal'}:${agentsExpanded ? 'agents-expanded' : 'agents-normal'}:${oxeExpanded ? 'oxe-expanded' : 'oxe-normal'}:${reviewExpanded ? 'review-expanded' : 'review-normal'}`

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
        <button type="button" className="workspace-toolbar-icon-button" aria-label="Open command palette" title="Command palette" onClick={onOpenCommandPalette}>
          <Command size={13} aria-hidden="true" />
        </button>
        <button type="button" className="workspace-toolbar-icon-button" aria-label="Open workspace settings" title="Workspace settings" onClick={onOpenWorkspaceSettings}>
          <Settings2 size={13} aria-hidden="true" />
        </button>
        <div className="workspace-toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className={`workspace-toolbar-button workspace-toolbar-button-compact${reviewVisible ? ' active' : ''}`}
          aria-label={reviewToggleLabel}
          title="Review"
          onClick={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelVisible: !reviewVisible, reviewPanelExpanded: reviewVisible ? false : workspace.reviewPanelExpanded })}
        >
          <GitCompareArrows size={13} aria-hidden="true" />
          <span>Review</span>
        </button>
        <button
          type="button"
          className={`workspace-toolbar-button${editorVisible ? ' active' : ''}`}
          aria-label={editorToggleLabel}
          title="Editor"
          onClick={() =>
            onUpdateEditorState({
              workspaceId: workspace.id,
              editorVisible: !editorVisible,
              editorExpanded: editorVisible ? false : workspace.editorExpanded
            })
          }
        >
          <span className="workspace-toolbar-icon" aria-hidden="true">
            ⌘
          </span>
          <span>Editor</span>
        </button>
        <button
          type="button"
          className={`workspace-toolbar-button workspace-toolbar-button-compact${oxeVisible ? ' active' : ''}`}
          aria-label={oxeToggleLabel}
          title="OXE"
          onClick={() =>
            onUpdateOxeState({
              workspaceId: workspace.id,
              oxePanelVisible: !oxeVisible,
              oxePanelExpanded: oxeVisible ? false : workspace.oxePanelExpanded
            })
          }
        >
          <Workflow size={13} aria-hidden="true" />
          <span>OXE</span>
        </button>
        <button
          type="button"
          className={`workspace-toolbar-button workspace-toolbar-button-compact${agentsVisible ? ' active' : ''}`}
          aria-label={agentsToggleLabel}
          title="Agents"
          onClick={() =>
            onUpdateAgentsState({
              workspaceId: workspace.id,
              agentsPanelVisible: !agentsVisible,
              agentsPanelExpanded: agentsVisible ? false : workspace.agentsPanelExpanded
            })
          }
        >
          <UsersRound size={13} aria-hidden="true" />
          <span>Agents</span>
        </button>
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

  if (!editorVisible && !oxeVisible && !agentsVisible && !reviewVisible) {
    return (
      <div className="workspace-surface-frame">
        {toolbar}
        <div className="workspace-surface-content">{grid}</div>
      </div>
    )
  }

  return (
    <div className="workspace-surface-frame">
      {toolbar}
      <div className="workspace-surface-content">
        <PanelGroup key={panelGroupKey} direction="horizontal">
          <Panel minSize={layoutSizes.gridMinSize} defaultSize={layoutSizes.grid}>
            {grid}
          </Panel>
          {reviewVisible ? (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
              <Panel
                minSize={24}
                maxSize={70}
                defaultSize={layoutSizes.review}
                onResize={(size) => {
                  const nextWidth = Math.round(size)
                  if (Math.abs(nextWidth - lastPersistedReviewWidth.current) < 2) return
                  lastPersistedReviewWidth.current = nextWidth
                  onUpdateReviewState({ workspaceId: workspace.id, reviewPanelWidthPercent: nextWidth, reviewPanelExpanded: nextWidth >= 68 })
                }}
              >
                <WorkspaceReviewPanel
                  workspace={workspace}
                  isExpanded={reviewExpanded}
                  onCollapse={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelVisible: false, reviewPanelExpanded: false })}
                  onToggleExpanded={() => onUpdateReviewState({ workspaceId: workspace.id, reviewPanelExpanded: !reviewExpanded, reviewPanelWidthPercent: reviewExpanded ? DEFAULT_REVIEW_WIDTH : 70 })}
                />
              </Panel>
            </>
          ) : null}
          {agentsVisible ? (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
              <Panel
                minSize={24}
                maxSize={70}
                defaultSize={layoutSizes.agents}
                onResize={(size) => {
                  const nextWidth = Math.round(size)
                  if (Math.abs(nextWidth - lastPersistedAgentsWidth.current) < 2) return
                  lastPersistedAgentsWidth.current = nextWidth
                  onUpdateAgentsState({
                    workspaceId: workspace.id,
                    agentsPanelWidthPercent: nextWidth,
                    agentsPanelExpanded: nextWidth >= 68
                  })
                }}
              >
                <WorkspaceAgentsPanel
                  workspace={workspace}
                  activePaneId={activePaneId}
                  isExpanded={agentsExpanded}
                  onCollapse={() => onUpdateAgentsState({ workspaceId: workspace.id, agentsPanelVisible: false, agentsPanelExpanded: false })}
                  onToggleExpanded={() =>
                    onUpdateAgentsState({
                      workspaceId: workspace.id,
                      agentsPanelExpanded: !agentsExpanded,
                      agentsPanelWidthPercent: agentsExpanded ? DEFAULT_AGENTS_WIDTH : 70
                    })
                  }
                  onOpenArtifact={onOpenWorkflowArtifact}
                />
              </Panel>
            </>
          ) : null}
          {editorVisible ? (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
              <Panel
                minSize={25}
                maxSize={70}
                defaultSize={layoutSizes.editor}
                onResize={(size) => {
                  const nextWidth = Math.round(size)
                  if (Math.abs(nextWidth - lastPersistedWidth.current) < 2) return
                  lastPersistedWidth.current = nextWidth
                  onUpdateEditorState({
                    workspaceId: workspace.id,
                    editorWidthPercent: nextWidth,
                    editorExpanded: nextWidth >= 68
                  })
                }}
              >
                <WorkspaceEditorPanel
                  workspace={workspace}
                  isExpanded={editorExpanded}
                  onCollapse={() => onUpdateEditorState({ workspaceId: workspace.id, editorVisible: false, editorExpanded: false })}
                  onToggleExpanded={() =>
                    onUpdateEditorState({
                      workspaceId: workspace.id,
                      editorExpanded: !editorExpanded,
                      editorWidthPercent: editorExpanded ? DEFAULT_EDITOR_WIDTH : 70
                    })
                  }
                />
              </Panel>
            </>
          ) : null}
          {oxeVisible ? (
            <>
              <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
              <Panel
                minSize={24}
                maxSize={70}
                defaultSize={layoutSizes.oxe}
                onResize={(size) => {
                  const nextWidth = Math.round(size)
                  if (Math.abs(nextWidth - lastPersistedOxeWidth.current) < 2) return
                  lastPersistedOxeWidth.current = nextWidth
                  onUpdateOxeState({
                    workspaceId: workspace.id,
                    oxePanelWidthPercent: nextWidth,
                    oxePanelExpanded: nextWidth >= 68
                  })
                }}
              >
                <WorkspaceOxePanel
                  workspace={workspace}
                  isExpanded={oxeExpanded}
                  onCollapse={() => onUpdateOxeState({ workspaceId: workspace.id, oxePanelVisible: false, oxePanelExpanded: false })}
                  onToggleExpanded={() =>
                    onUpdateOxeState({
                      workspaceId: workspace.id,
                      oxePanelExpanded: !oxeExpanded,
                      oxePanelWidthPercent: oxeExpanded ? DEFAULT_OXE_WIDTH : 70
                    })
                  }
                  onOpenArtifact={onOpenOxeArtifact}
                  onRunOxeCommand={onRunOxeCommand}
                />
              </Panel>
            </>
          ) : null}
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
  oxeVisible: boolean
  oxeWidth: number
  reviewVisible: boolean
  reviewWidth: number
}

function getWorkspacePanelSizes(input: WorkspacePanelSizeInput): { grid: number; gridMinSize: number; editor: number; agents: number; oxe: number; review: number } {
  const editor = input.editorVisible ? clampPanelSize(input.editorWidth, 25, 70) : 0
  const agents = input.agentsVisible ? clampPanelSize(input.agentsWidth, 24, 70) : 0
  const oxe = input.oxeVisible ? clampPanelSize(input.oxeWidth, 24, 70) : 0
  const review = input.reviewVisible ? clampPanelSize(input.reviewWidth, 24, 70) : 0
  const visibleSideCount = Number(input.editorVisible) + Number(input.agentsVisible) + Number(input.oxeVisible) + Number(input.reviewVisible)

  if (visibleSideCount === 0) {
    return { grid: 100, gridMinSize: 30, editor: 0, agents: 0, oxe: 0, review: 0 }
  }

  if (visibleSideCount === 1) {
    const side = input.editorVisible ? editor : input.agentsVisible ? agents : input.oxeVisible ? oxe : review
    return {
      grid: 100 - side,
      gridMinSize: 30,
      editor,
      agents,
      oxe,
      review
    }
  }

  const maxCombinedSideWidth = 70
  const combined = editor + agents + oxe + review
  const scale = combined > maxCombinedSideWidth ? maxCombinedSideWidth / combined : 1
  const normalizedEditor = input.editorVisible ? Math.max(25, Math.round(editor * scale)) : 0
  const normalizedAgents = input.agentsVisible ? Math.max(24, Math.round(agents * scale)) : 0
  const normalizedOxe = input.oxeVisible ? Math.max(24, Math.round(oxe * scale)) : 0
  const normalizedReview = input.reviewVisible ? Math.max(24, Math.round(review * scale)) : 0
  const normalizedCombined = normalizedEditor + normalizedAgents + normalizedOxe + normalizedReview

  return {
    grid: Math.max(30, 100 - normalizedCombined),
    gridMinSize: 30,
    editor: normalizedEditor,
    agents: normalizedAgents,
    oxe: normalizedOxe,
    review: normalizedReview
  }
}

function clampPanelSize(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min
  return Math.min(max, Math.max(min, Math.round(width)))
}
