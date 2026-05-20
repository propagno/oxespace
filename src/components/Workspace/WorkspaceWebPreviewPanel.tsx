import { ChevronsRight, Maximize2, Minimize2, MonitorPlay } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { WebPreviewPanel } from '../WebPreview/WebPreviewPanel'

interface WorkspaceWebPreviewPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onRunCommand: (command: string) => void
}

export function WorkspaceWebPreviewPanel({ isExpanded, onCollapse, onRunCommand, onToggleExpanded, workspace }: WorkspaceWebPreviewPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-web-preview-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <MonitorPlay size={12} aria-hidden="true" />
          <span>Web Preview</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Web Preview panel actions">
          <button type="button" className="tile-btn" aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'} onClick={onToggleExpanded}>
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <WebPreviewPanel workspace={workspace} embedded onRunCommand={onRunCommand} onClose={onCollapse} />
      </div>
    </section>
  )
}
