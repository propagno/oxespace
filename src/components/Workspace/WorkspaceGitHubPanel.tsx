import { ChevronsRight, Files, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { GitHubPanelTab, Workspace } from '../../../shared/types/workspace'
import { GitHubPanel } from '../GitHub/GitHubPanel'
import { GitControlPanel } from '../GitHub/GitControlPanel'
import { useWorkspaceStore } from '../../store/workspace.store'
import { PanelScopeBadge } from './PanelScopeBadge'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

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
    void useWorkspaceStore.getState().showRepositoryView(workspace.id, 'files')
  }
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')

  return (
    <DockPanel
      testId="workspace-github-panel"
      className="workspace-editor-panel workspace-github-panel"
      icon={<GitBranch size={14} aria-hidden="true" />}
      title={tc('panels.git')}
      count={<PanelScopeBadge workspaceId={workspace.id} scope={scope} />}
      actions={<>
        <span className="repository-view-actions" role="group" aria-label={tc('workspace.panel.repositoryViews')}>
          <IconButton label={tc('workspace.panel.files')} title={tc('workspace.panel.files')} icon={<Files size={14} aria-hidden="true" />} onClick={openFiles} />
          <IconButton label={tc('panels.git')} title={tc('panels.git')} aria-pressed icon={<GitBranch size={14} aria-hidden="true" />} />
        </span>
        <IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />
      </>}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <div className="git-control-view-switch"><span>{advancedGitHub ? tc('workspace.git.github') : tc('workspace.git.local')}</span><button type="button" onClick={() => setAdvancedGitHub(value => !value)}>{advancedGitHub ? tc('workspace.git.back') : tc('workspace.git.github')}</button></div>
        {advancedGitHub ? <GitHubPanel workspaceId={workspace.id} rootPath={scope.rootPath} activeTab={activeTab} onTabChange={onTabChange} /> : <GitControlPanel workspaceId={workspace.id} rootPath={scope.rootPath} />}
      </div>
    </DockPanel>
  )
}
