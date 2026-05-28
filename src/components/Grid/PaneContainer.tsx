import { Maximize2, Minimize2, PanelBottom, PanelRight, Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
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
  const updatePaneName = useWorkspaceStore((s) => s.updatePaneName)

  // Inline rename state for the pane's title. The sidebar no longer exposes
  // per-pane rows, so renaming lives in the header where the user already
  // looks for the pane's identity. Double-click or click the pencil to edit.
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const commitGuardRef = useRef(false)

  useEffect(() => {
    if (renaming) {
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 0)
    }
  }, [renaming])

  function startRename(event?: React.MouseEvent): void {
    if (event) {
      event.stopPropagation()
      event.preventDefault()
    }
    // Pre-fill with the current custom name (if any), not the dynamic
    // title — the user wants to set/replace their own label, not edit the
    // last terminal output preview.
    setDraftName(pane.displayName ?? '')
    commitGuardRef.current = false
    setRenaming(true)
  }

  async function commitRename(): Promise<void> {
    if (commitGuardRef.current) return
    commitGuardRef.current = true
    setRenaming(false)
    const next = draftName.trim()
    // Empty input clears the custom name → display falls back to dynamic
    // intent/output/agent fallback chain in `derivePaneDisplayState`.
    try {
      await updatePaneName(pane.id, next || null)
    } catch (err) {
      console.warn('[pane] rename failed', err)
    }
  }

  function cancelRename(): void {
    commitGuardRef.current = true
    setRenaming(false)
    setDraftName('')
  }

  return (
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" tabIndex={-1} onFocus={() => onActivate?.(pane.id)} onPointerDown={() => onActivate?.(pane.id)}>
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)} activity-${display.statusTone}`} aria-hidden="true" />
          <span className="pane-agent-chip" title={display.subtitle}>{display.providerLabel}</span>
          {renaming ? (
            <input
              ref={renameInputRef}
              type="text"
              autoFocus
              className="pane-intent pane-intent-input"
              value={draftName}
              placeholder={display.title}
              onChange={(e) => setDraftName(e.currentTarget.value)}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
              }}
              onBlur={() => void commitRename()}
              aria-label="Rename pane"
            />
          ) : (
            <button
              type="button"
              className="pane-intent pane-intent-button"
              title={`${display.title}\n(double-click to rename)`}
              onDoubleClick={(e) => startRename(e)}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="pane-intent-text">{display.title}</span>
              <Pencil size={10} className="pane-intent-edit-hint" aria-hidden="true" />
            </button>
          )}
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
