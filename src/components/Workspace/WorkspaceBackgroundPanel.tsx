import { Activity, ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { BackgroundJobsPanel } from '../Background/BackgroundJobsPanel'

interface WorkspaceBackgroundPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceBackgroundPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceBackgroundPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel workspace-background-panel" data-testid="workspace-background-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Activity size={12} aria-hidden="true" />
          <span>Background jobs</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Background panel actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'}
            title={isExpanded ? 'Restore panel width' : 'Expand panel'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" title="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <BackgroundJobsPanel workspaceId={workspace.id} />
      </div>
    </section>
  )
}
