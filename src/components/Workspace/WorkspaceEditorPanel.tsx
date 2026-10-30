import { ChevronsRight, Files, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { useWorkspaceStore } from '../../store/workspace.store'
import { PanelScopeBadge } from './PanelScopeBadge'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceEditorPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceEditorPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceEditorPanelProps): ReactElement {
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
          <Files size={14} aria-hidden="true" />
          <span className="workspace-editor-name">{workspace.name}</span>
          <PanelScopeBadge workspaceId={workspace.id} scope={scope} />
        </div>
        <div className="workspace-editor-actions repository-view-actions" aria-label={tc('workspace.panel.repositoryViews')}>
          <button type="button" className="tile-btn active" aria-label={tc('workspace.panel.files')} title={tc('workspace.panel.files')}>
            <Files size={14} aria-hidden="true" />
          </button>
          <button type="button" className="tile-btn" aria-label={tc('panels.git')} title={tc('panels.git')} onClick={openSourceControl}>
            <GitBranch size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            title={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} onClick={onCollapse}>
            <ChevronsRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <EditorPane workspaceId={workspace.id} rootPath={scope.rootPath} />
      </div>
    </section>
  )
}
