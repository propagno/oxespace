import { FileCode2, Maximize2, Minimize2, PanelBottom, PanelRight, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { PaneContent } from '../Panes/PaneContent'

interface PaneContainerProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
  isMaximized: boolean
  onToggleMaximize: (paneId: string) => void
  onClose?: (paneId: string) => void
  onOpenEditor?: (paneId: string) => void
  onSplitVertical?: (paneId: string) => void
  onSplitHorizontal?: (paneId: string) => void
}

function statusClass(status: WorkspacePane['status']): string {
  if (status === 'running') return 'running'
  if (status === 'exited') return 'exited'
  return ''
}

export function PaneContainer({ autoStart, isMaximized, onClose, onOpenEditor, onSplitHorizontal, onSplitVertical, onToggleMaximize, pane, workspaceId }: PaneContainerProps): ReactElement {
  return (
    <section className="pane-container" data-testid="pane-container">
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)}`} aria-hidden="true" />
          <span className="pane-title">{pane.type}</span>
        </div>
        <div className="pane-actions">
          <button
            type="button"
            className="tile-btn pane-editor-button"
            aria-label="Open editor in pane"
            title="Open editor"
            onClick={() => onOpenEditor?.(pane.id)}
          >
            <FileCode2 size={12} aria-hidden="true" />
            <span>Editor</span>
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label={isMaximized ? 'Restore pane' : 'Maximize pane'}
            title={isMaximized ? 'Restore' : 'Expand'}
            onClick={() => onToggleMaximize(pane.id)}
          >
            {isMaximized ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label="Split vertical"
            title="Split vertical"
            onClick={() => onSplitVertical?.(pane.id)}
          >
            <PanelRight size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tile-btn"
            aria-label="Split horizontal"
            title="Split horizontal"
            onClick={() => onSplitHorizontal?.(pane.id)}
          >
            <PanelBottom size={12} aria-hidden="true" />
          </button>
          {onClose ? (
            <button
              type="button"
              className="tile-btn close"
              aria-label="Close pane"
              title="Close pane"
              onClick={() => onClose(pane.id)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      <PaneContent pane={pane} workspaceId={workspaceId} autoStart={autoStart} />
    </section>
  )
}
