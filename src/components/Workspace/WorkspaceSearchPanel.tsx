import { ChevronsRight, Maximize2, Minimize2, Search } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { SearchPanel } from '../Search/SearchPanel'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

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
          <span>{tc('panels.search')}</span>
        </div>
        <div className="workspace-editor-actions" aria-label={tc('workspace.panel.actions')}>
          <button type="button" className="tile-btn" aria-label={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')} onClick={onToggleExpanded}>
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} onClick={onCollapse}>
            <ChevronsRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <SearchPanel workspace={workspace} />
      </div>
    </section>
  )
}
