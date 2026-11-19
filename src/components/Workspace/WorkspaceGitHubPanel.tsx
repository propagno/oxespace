import { ChevronsRight, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { GitHubPanelTab, Workspace } from '../../../shared/types/workspace'
import { GitHubPanel } from '../GitHub/GitHubPanel'
import { GitControlPanel } from '../GitHub/GitControlPanel'
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
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')

  return (
    <DockPanel
      testId="workspace-github-panel"
      className="workspace-editor-panel workspace-github-panel"
      icon={<GitBranch size={14} aria-hidden="true" />}
      title={tc('panels.git')}
      count={<PanelScopeBadge workspaceId={workspace.id} scope={scope} />}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <div className="git-control-view-switch"><span>{advancedGitHub ? tc('workspace.git.github') : tc('workspace.git.local')}</span><button type="button" onClick={() => setAdvancedGitHub(value => !value)}>{advancedGitHub ? tc('workspace.git.back') : tc('workspace.git.github')}</button></div>
        {advancedGitHub ? <GitHubPanel workspaceId={workspace.id} rootPath={scope.rootPath} activeTab={activeTab} onTabChange={onTabChange} /> : <GitControlPanel workspaceId={workspace.id} rootPath={scope.rootPath} />}
      </div>
    </DockPanel>
  )
}
