import { useRef, type ReactElement } from 'react'
import { Command, Settings2 } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { Workspace } from '../../../shared/types/workspace'
import { WorkspaceGrid } from '../Grid/WorkspaceGrid'
import { WorkspaceEditorPanel } from './WorkspaceEditorPanel'

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
}

const DEFAULT_EDITOR_WIDTH = 40

export function WorkspaceSurface({
  maximizedPaneId,
  onClosePane,
  onActivatePane,
  onOpenCommandPalette,
  onOpenWorkspaceSettings,
  onSplitPane,
  onToggleMaximize,
  onUpdateEditorState,
  workspace
}: WorkspaceSurfaceProps): ReactElement {
  const lastPersistedWidth = useRef(workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH)
  const editorVisible = workspace.editorVisible === true
  const editorExpanded = workspace.editorExpanded === true
  const editorWidth = editorExpanded ? 70 : workspace.editorWidthPercent ?? DEFAULT_EDITOR_WIDTH
  const editorToggleLabel = editorVisible ? 'Collapse workspace editor' : 'Open workspace editor'

  const grid = (
    <WorkspaceGrid
      workspace={workspace}
      maximizedPaneId={maximizedPaneId}
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

  if (!editorVisible) {
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
        <PanelGroup direction="horizontal">
          <Panel minSize={30} defaultSize={100 - editorWidth}>
            {grid}
          </Panel>
          <PanelResizeHandle className="resize-handle resize-handle-vertical workspace-editor-resize" />
          <Panel
            minSize={25}
            maxSize={70}
            defaultSize={editorWidth}
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
        </PanelGroup>
      </div>
    </div>
  )
}
