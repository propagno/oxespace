import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { ReviewPane } from '../Review/ReviewPane'
import { PanelScopeBadge } from './PanelScopeBadge'
import type { WorkspaceScope } from '../../utils/workspaceScope'

interface WorkspaceReviewPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceReviewPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceReviewPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-review-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <span>Review</span>
          <PanelScopeBadge workspaceId={workspace.id} scope={scope} />
        </div>
        <div className="workspace-editor-actions" aria-label="Review actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore review width' : 'Expand review'}
            title={isExpanded ? 'Restore review width' : 'Expand review'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse review" title="Collapse review" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <ReviewPane workspaceId={workspace.id} rootPath={scope.rootPath} />
      </div>
    </section>
  )
}
