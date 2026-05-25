import { Maximize2, Minimize2, PanelBottom, PanelRight, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { derivePaneDisplayState } from '../../utils/paneDisplay'
import { PaneContent } from '../Panes/PaneContent'

interface PaneContainerProps {
  pane: WorkspacePane
  workspace: Workspace
  agentProfile: AgentProfile | null
  autoStart: boolean
  isMaximized: boolean
  isActive?: boolean
  onToggleMaximize: (paneId: string) => void
  onClose?: (paneId: string) => void
  onSplitVertical?: (paneId: string) => void
  onSplitHorizontal?: (paneId: string) => void
  onActivate?: (paneId: string) => void
}

const EMPTY_TERMINAL_STATE = {
  status: 'idle' as const,
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false
}

function statusClass(status: WorkspacePane['status']): string {
  if (status === 'running') return 'running'
  if (status === 'exited') return 'exited'
  return ''
}

export function PaneContainer({ agentProfile, autoStart, isActive, isMaximized, onActivate, onClose, onSplitHorizontal, onSplitVertical, onToggleMaximize, pane, workspace }: PaneContainerProps): ReactElement {
  const terminalState = useTerminalStore((s) => s.panes[pane.id] ?? EMPTY_TERMINAL_STATE)
  const display = derivePaneDisplayState({ pane, workspace, terminal: terminalState, profile: agentProfile, paneIndex: pane.rowIndex + pane.columnIndex })
  return (
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" tabIndex={-1} onFocus={() => onActivate?.(pane.id)} onPointerDown={() => onActivate?.(pane.id)}>
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)} activity-${display.statusTone}`} aria-hidden="true" />
          <span className="pane-agent-chip" title={display.subtitle}>{display.providerLabel}</span>
          <span className="pane-intent" title={display.title}>{display.title}</span>
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
      <PaneContent pane={pane} workspaceId={workspace.id} workspaceRootPath={workspace.rootPath} autoStart={autoStart} />
    </section>
  )
}
