import { ChevronsRight, Files, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { useWorkspaceStore } from '../../store/workspace.store'

interface WorkspaceEditorPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceEditorPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceEditorPanelProps): ReactElement {
  const openSourceControl = (): void => {
    void (async () => {
      await useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: false, editorExpanded: false })
      await useWorkspaceStore.getState().updateGitHubState({ workspaceId: workspace.id, githubPanelVisible: true, githubPanelExpanded: false, githubPanelWidthPercent: workspace.editorWidthPercent ?? 48 })
    })()
  }

  return (
    <section className="workspace-editor-panel" data-testid="workspace-editor-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Files size={13} aria-hidden="true" />
          <span>{workspace.name}</span>
        </div>
        <div className="workspace-editor-actions repository-view-actions" aria-label="Repository views">
          <button type="button" className="tile-btn active" aria-label="Files and editor" title="Files and editor">
            <Files size={13} aria-hidden="true" />
          </button>
          <button type="button" className="tile-btn" aria-label="Source control" title="Source control" onClick={openSourceControl}>
            <GitBranch size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore editor width' : 'Expand editor'}
            title={isExpanded ? 'Restore editor width' : 'Expand editor'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse editor" title="Collapse editor" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <EditorPane workspaceId={workspace.id} rootPath={workspace.rootPath} />
      </div>
    </section>
  )
}
