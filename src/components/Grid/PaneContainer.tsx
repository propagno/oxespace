import { Eraser, Maximize2, Minimize2, MoreHorizontal, PanelBottom, PanelRight, Pencil, RotateCcw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { derivePaneDisplayState } from '../../utils/paneDisplay'
import { PaneContent } from '../Panes/PaneContent'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'

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
  const shellProfiles = useWorkspaceStore((s) => s.shellProfiles)
  const shellProfileName = useMemo(() => {
    const id = pane.shellProfileId ?? workspace.defaultShellProfileId
    return shellProfiles.find((p) => p.id === id)?.name ?? null
  }, [pane.shellProfileId, shellProfiles, workspace.defaultShellProfileId])
  const display = derivePaneDisplayState({
    pane,
    workspace,
    terminal: terminalState,
    profile: agentProfile,
    paneIndex: pane.rowIndex + pane.columnIndex,
    shellProfileName
  })
  const updatePaneName = useWorkspaceStore((s) => s.updatePaneName)
  const isTerminalPane = pane.type === 'terminal'
  const terminalCanMutate = terminalState.status === 'running'
  const terminalCanRestart = terminalState.status !== 'starting'

  // Inline rename state for the pane's title. The sidebar no longer exposes
  // per-pane rows, so renaming lives in the header where the user already
  // looks for the pane's identity. Double-click or click the pencil to edit.
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const commitGuardRef = useRef(false)

  // Overflow menu (⋯) holds secondary actions so the header stays compact:
  // only Search + Expand stay visible; clear/session/split/close live here.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (renaming) {
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 0)
    }
  }, [renaming])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    // Capture phase so we close even if a pane stops propagation on bubble.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

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

  function runMenuAction(action: () => void): void {
    setMenuOpen(false)
    action()
  }

  return (
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" tabIndex={-1} onFocus={() => onActivate?.(pane.id)} onPointerDown={() => onActivate?.(pane.id)}>
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)} activity-${display.statusTone}`} aria-hidden="true" />
          <span
            className={`pane-agent-chip provider-${display.providerKey}`}
            title={display.subtitle}
            data-testid="pane-provider-chip"
            data-provider={display.providerKey}
          >
            {agentProfile ? (
              <AgentProviderIcon provider={agentProfile.provider} />
            ) : null}
            <span className="pane-agent-chip-label">{display.providerLabel}</span>
          </span>
          <span className="pane-header-divider" aria-hidden="true">/</span>
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
          {isTerminalPane ? (
            <button
              type="button"
              className="tile-btn"
              aria-label="Search in terminal"
              title="Buscar (Ctrl+F)"
              disabled={!terminalCanMutate}
              onClick={(e) => {
                e.stopPropagation()
                window.dispatchEvent(new CustomEvent('oxe:terminal-open-search', { detail: { paneId: pane.id } }))
              }}
            >
              <Search size={12} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="tile-btn"
            aria-label={isMaximized ? 'Restore pane' : 'Maximize pane'}
            title={isMaximized ? 'Restore' : 'Expand'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleMaximize(pane.id)
            }}
          >
            {isMaximized ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <div className="pane-actions-menu" ref={menuRef}>
            <button
              type="button"
              className={`tile-btn${menuOpen ? ' active' : ''}`}
              aria-label="More pane actions"
              title="Mais ações"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((open) => !open)
              }}
            >
              <MoreHorizontal size={12} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="pane-actions-popover" role="menu" data-testid="pane-actions-menu">
                {isTerminalPane ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="pane-actions-popover-item"
                      disabled={!terminalCanMutate}
                      onClick={(e) => {
                        e.stopPropagation()
                        runMenuAction(() => {
                          window.dispatchEvent(new CustomEvent('oxe:terminal-clear', { detail: { paneId: pane.id } }))
                        })
                      }}
                    >
                      <Eraser size={13} aria-hidden="true" />
                      Limpar terminal
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="pane-actions-popover-item"
                      disabled={!terminalCanRestart}
                      onClick={(e) => {
                        e.stopPropagation()
                        runMenuAction(() => {
                          window.dispatchEvent(new CustomEvent('oxe:terminal-new-session', { detail: { paneId: pane.id } }))
                        })
                      }}
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      Nova sessão
                    </button>
                    <div className="pane-actions-popover-sep" aria-hidden="true" />
                  </>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="pane-actions-popover-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    runMenuAction(() => onSplitVertical?.(pane.id))
                  }}
                >
                  <PanelRight size={13} aria-hidden="true" />
                  Dividir vertical
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pane-actions-popover-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    runMenuAction(() => onSplitHorizontal?.(pane.id))
                  }}
                >
                  <PanelBottom size={13} aria-hidden="true" />
                  Dividir horizontal
                </button>
                {onClose ? (
                  <>
                    <div className="pane-actions-popover-sep" aria-hidden="true" />
                    <button
                      type="button"
                      role="menuitem"
                      className="pane-actions-popover-item danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        runMenuAction(() => onClose(pane.id))
                      }}
                    >
                      <X size={13} aria-hidden="true" />
                      Fechar pane
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <PaneContent pane={pane} workspaceId={workspace.id} workspaceRootPath={workspace.rootPath} autoStart={autoStart} />
    </section>
  )
}
