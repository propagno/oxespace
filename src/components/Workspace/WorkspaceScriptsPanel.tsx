import { ChevronsRight, Code2, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { ScriptsPanel } from '../Scripts/ScriptsPanel'

interface WorkspaceScriptsPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onOpenBackground: () => void
}

export function WorkspaceScriptsPanel({ isExpanded, onCollapse, onOpenBackground, onToggleExpanded, workspace }: WorkspaceScriptsPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-scripts-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Code2 size={12} aria-hidden="true" />
          <span>Scripts</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Scripts panel actions">
          <button type="button" className="tile-btn" aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'} onClick={onToggleExpanded}>
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <ScriptsPanel workspace={workspace} embedded onOpenBackground={onOpenBackground} onClose={onCollapse} />
      </div>
    </section>
  )
}
