import { ChevronsRight, Files, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { GitHubPanelTab, Workspace } from '../../../shared/types/workspace'
import { GitHubPanel } from '../GitHub/GitHubPanel'
import { GitControlPanel } from '../GitHub/GitControlPanel'
import { useWorkspaceStore } from '../../store/workspace.store'
import { PanelScopeBadge } from './PanelScopeBadge'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceGitHubPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  activeTab: GitHubPanelTab
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onTabChange: (tab: GitHubPanelTab) => void
}

export function WorkspaceGitHubPanel({ activeTab, isExpanded, onCollapse, onTabChange, onToggleExpanded, scope, workspace }: WorkspaceGitHubPanelProps): ReactElement {
  const [advancedGitHub, setAdvancedGitHub] = useState(false)
  const openFiles = (): void => {
    void (async () => {
      await useWorkspaceStore.getState().updateGitHubState({ workspaceId: workspace.id, githubPanelVisible: false, githubPanelExpanded: false })
      await useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true, editorExpanded: false, editorWidthPercent: workspace.githubPanelWidthPercent ?? 48 })
    })()
  }

  return (
    <section className="workspace-editor-panel workspace-github-panel" data-testid="workspace-github-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <GitBranch size={14} aria-hidden="true" />
          <span>{workspace.name}</span>
          <PanelScopeBadge workspaceId={workspace.id} scope={scope} />
        </div>
        <div className="workspace-editor-actions repository-view-actions" aria-label={tc('workspace.panel.repositoryViews')}>
          <button type="button" className="tile-btn" aria-label={tc('workspace.panel.files')} title={tc('workspace.panel.files')} onClick={openFiles}>
            <Files size={14} aria-hidden="true" />
          </button>
          <button type="button" className="tile-btn active" aria-label={tc('panels.git')} title={tc('panels.git')}>
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
        <div className="git-control-view-switch"><span>{advancedGitHub ? tc('workspace.git.github') : tc('workspace.git.local')}</span><button type="button" onClick={() => setAdvancedGitHub(value => !value)}>{advancedGitHub ? tc('workspace.git.back') : tc('workspace.git.github')}</button></div>
        {advancedGitHub ? <GitHubPanel workspaceId={workspace.id} rootPath={scope.rootPath} activeTab={activeTab} onTabChange={onTabChange} /> : <GitControlPanel workspaceId={workspace.id} rootPath={scope.rootPath} />}
      </div>
    </section>
  )
}
