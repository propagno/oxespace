import { ChevronsRight, Compass, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { OxePanelBody } from '../Oxe/OxePanelBody'

interface WorkspaceOxePanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceOxePanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceOxePanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-oxe-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Compass size={12} aria-hidden="true" />
          <span>OXE</span>
        </div>
        <div className="workspace-editor-actions" aria-label="OXE panel actions">
          <button type="button" className="tile-btn" aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'} onClick={onToggleExpanded}>
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <OxePanelBody workspace={workspace} />
      </div>
    </section>
  )
}
