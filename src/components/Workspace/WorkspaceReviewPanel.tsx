import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { ReviewPane } from '../Review/ReviewPane'

interface WorkspaceReviewPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceReviewPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceReviewPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-review-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <span>Review</span>
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
        <ReviewPane workspaceId={workspace.id} rootPath={workspace.rootPath} />
      </div>
    </section>
  )
}
