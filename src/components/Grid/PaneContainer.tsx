import { Maximize2, Minimize2, PanelBottom, PanelRight, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { PaneContent } from '../Panes/PaneContent'

interface PaneContainerProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
  isMaximized: boolean
  isActive?: boolean
  onToggleMaximize: (paneId: string) => void
  onClose?: (paneId: string) => void
  onSplitVertical?: (paneId: string) => void
  onSplitHorizontal?: (paneId: string) => void
  onActivate?: (paneId: string) => void
}

function statusClass(status: WorkspacePane['status']): string {
  if (status === 'running') return 'running'
  if (status === 'exited') return 'exited'
  return ''
}

export function PaneContainer({ autoStart, isActive, isMaximized, onActivate, onClose, onSplitHorizontal, onSplitVertical, onToggleMaximize, pane, workspaceId }: PaneContainerProps): ReactElement {
  return (
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" tabIndex={-1} onFocus={() => onActivate?.(pane.id)} onPointerDown={() => onActivate?.(pane.id)}>
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)}`} aria-hidden="true" />
          {pane.displayName
            ? <span className="pane-agent-chip" title={pane.displayName}>{pane.displayName}</span>
            : pane.agentName
              ? <span className="pane-agent-chip" title={pane.agentName}>{pane.agentName}</span>
              : <span className="pane-title">{pane.type}</span>
          }
        </div>
        <div className="pane-actions">
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
