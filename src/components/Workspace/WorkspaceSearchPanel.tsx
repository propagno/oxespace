import { ChevronsRight, Maximize2, Minimize2, Search } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { SearchPanel } from '../Search/SearchPanel'

interface WorkspaceSearchPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceSearchPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceSearchPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-search-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Search size={12} aria-hidden="true" />
          <span>Find in Files</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Search panel actions">
          <button type="button" className="tile-btn" aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'} onClick={onToggleExpanded}>
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <SearchPanel workspace={workspace} />
      </div>
    </section>
  )
}
