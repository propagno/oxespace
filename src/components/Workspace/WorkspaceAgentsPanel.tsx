import { ChevronsRight, Maximize2, Minimize2, UsersRound } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { AgentsPanel } from '../Agents/AgentsPanel'

interface WorkspaceAgentsPanelProps {
  workspace: Workspace
  activePaneId: string | null
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onOpenArtifact: (content: string, title: string) => void
}

export function WorkspaceAgentsPanel({
  activePaneId,
  isExpanded,
  onCollapse,
  onOpenArtifact,
  onToggleExpanded,
  workspace
}: WorkspaceAgentsPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel workspace-agents-panel" data-testid="workspace-agents-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <UsersRound size={13} aria-hidden="true" />
          <span>Plan/Exec</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Plan/Exec actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore Plan/Exec panel width' : 'Expand Plan/Exec panel'}
            title={isExpanded ? 'Restore Plan/Exec panel width' : 'Expand Plan/Exec panel'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse Plan/Exec panel" title="Collapse Plan/Exec panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <AgentsPanel workspace={workspace} activePaneId={activePaneId} onOpenArtifact={onOpenArtifact} />
      </div>
    </section>
  )
}
