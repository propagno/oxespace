import { ChevronsRight, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { OxePanel } from '../Oxe/OxePanel'

interface WorkspaceOxePanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onOpenArtifact: (relativePath: string) => void
  onRunOxeCommand: (command: string) => void
}

export function WorkspaceOxePanel({
  isExpanded,
  onCollapse,
  onOpenArtifact,
  onRunOxeCommand,
  onToggleExpanded,
  workspace
}: WorkspaceOxePanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel workspace-oxe-panel" data-testid="workspace-oxe-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <span aria-hidden="true">⌘</span>
          <span>OXE</span>
        </div>
        <div className="workspace-editor-actions" aria-label="OXE actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore OXE panel width' : 'Expand OXE panel'}
            title={isExpanded ? 'Restore OXE panel width' : 'Expand OXE panel'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse OXE panel" title="Collapse OXE panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <OxePanel
          workspaceId={workspace.id}
          rootPath={workspace.rootPath}
          onOpenArtifact={onOpenArtifact}
          onRunOxeCommand={onRunOxeCommand}
        />
      </div>
    </section>
  )
}
