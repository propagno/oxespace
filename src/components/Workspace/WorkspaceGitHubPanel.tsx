import { ChevronsRight, Github, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { GitHubPanelTab, Workspace } from '../../../shared/types/workspace'
import { GitHubPanel } from '../GitHub/GitHubPanel'

interface WorkspaceGitHubPanelProps {
  workspace: Workspace
  activeTab: GitHubPanelTab
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onTabChange: (tab: GitHubPanelTab) => void
}

export function WorkspaceGitHubPanel({ activeTab, isExpanded, onCollapse, onTabChange, onToggleExpanded, workspace }: WorkspaceGitHubPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel workspace-github-panel" data-testid="workspace-github-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Github size={13} aria-hidden="true" />
          <span>GitHub</span>
        </div>
        <div className="workspace-editor-actions" aria-label="GitHub actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore GitHub panel width' : 'Expand GitHub panel'}
            title={isExpanded ? 'Restore GitHub panel width' : 'Expand GitHub panel'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse GitHub panel" title="Collapse GitHub panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <GitHubPanel workspaceId={workspace.id} rootPath={workspace.rootPath} activeTab={activeTab} onTabChange={onTabChange} />
      </div>
    </section>
  )
}
