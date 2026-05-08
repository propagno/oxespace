import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'

interface WorkspaceEditorPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceEditorPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceEditorPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel" data-testid="workspace-editor-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <span aria-hidden="true">⌘</span>
          <span>Editor</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Editor actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore editor width' : 'Expand editor'}
            title={isExpanded ? 'Restore editor width' : 'Expand editor'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse editor" title="Collapse editor" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <EditorPane workspaceId={workspace.id} rootPath={workspace.rootPath} />
      </div>
    </section>
  )
}
