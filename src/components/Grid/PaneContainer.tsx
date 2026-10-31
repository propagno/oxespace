import { CircleHelp, Eraser, Info, Maximize2, Minimize2, MoreHorizontal, PanelBottom, PanelRight, Pencil, RotateCcw, Search, SquareTerminal, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { TerminalStatusResult } from '../../../shared/types/ipc'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { derivePaneDisplayState } from '../../utils/paneDisplay'
import { PaneContent } from '../Panes/PaneContent'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { PaneBranchBadge } from '../Workspace/PaneBranchBadge'
import { Button, Dialog } from '../../ui'
import paneMenu from './PaneMenu.module.css'
import { DetailList } from '../Navigation/DetailList'
import { formatDateTime } from '../../utils/formatTime'
import { i18n } from '../../i18n'
import { PhoneWriteBadge, PhoneWriteMenuItem, usePhoneWrite } from './PanePhoneWrite'

const tc = i18n.getFixedT(null, 'code')
const detailRows = (items: string[][]): Array<{ label: string; detail: string }> => items.map(([label, detail]) => ({ label, detail }))
// Opened on request only, so it stays out of the startup bundle.
const ProviderSessionFinder = lazy(() => import('./ProviderSessionFinder').then(module => ({ default: module.ProviderSessionFinder })))
const StatusExplainDialog = lazy(() => import('./StatusExplainDialog').then(module => ({ default: module.StatusExplainDialog })))
const TerminalFocusMenuItems = lazy(() => import('./TerminalFocusMenuItems').then(module => ({ default: module.TerminalFocusMenuItems })))

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
  onArrange?: (position: 'right' | 'bottom' | 'balance') => void
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

export function PaneContainer({ agentProfile, autoStart, isActive, isMaximized, onActivate, onArrange, onClose, onSplitHorizontal, onSplitVertical, onToggleMaximize, pane, workspace }: PaneContainerProps): ReactElement {
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
  const phoneWrite = usePhoneWrite(pane.id)

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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [providerSessionsOpen, setProviderSessionsOpen] = useState(false)
  const [explainOpen, setExplainOpen] = useState(false)
  const needsDecision = display.statusTone === 'needs-decision'
  // The status in words, with where it comes from (UX-07): the dot's tooltip and the header's screen-reader text.
  const statusText = display.originLabel ? `${display.statusLabel} · ${display.originLabel}` : display.statusLabel
  const [sessionDetails, setSessionDetails] = useState<TerminalStatusResult | null>(null)
  const [sessionDetailsError, setSessionDetailsError] = useState('')
  useEffect(() => {
    if (!detailsOpen) return
    let active = true
    setSessionDetails(null); setSessionDetailsError('')
    if (!window.oxe?.terminal?.status) { setSessionDetailsError(tc('paneMenu.detailsUnavailable')); return }
    void window.oxe.terminal.status(pane.id).then(value => { if (active) setSessionDetails(value) }).catch(() => { if (active) setSessionDetailsError(tc('paneMenu.detailsFailed')) })
    return () => { active = false }
  }, [detailsOpen, pane.id, terminalState.status])
  const [menuHeight, setMenuHeight] = useState(320)
  // Fixed placement so the menu is not clipped by the pane it belongs to.
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
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
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" data-pane-id={pane.id} data-tone={display.statusTone} tabIndex={-1} onFocus={() => onActivate?.(pane.id)} onPointerDown={() => onActivate?.(pane.id)}>
      <header className="pane-header">
        <div className="pane-header-left">
          <span className={`pane-status-dot ${statusClass(pane.status)} activity-${display.statusTone}${display.statusEstimated ? ' is-estimated' : ''}`} aria-hidden="true" title={statusText} data-testid="pane-status-dot" data-origin={display.statusOrigin ?? undefined} />
          <span className="sr-only" data-testid="pane-status-text">{statusText}</span>
          {/* Polite and once: the text appears when the pane enters the state and stays while it holds. */}
          <span className="sr-only" role="status" data-testid="pane-decision-live">{needsDecision ? tc('pane.decisionAnnounce', { agent: display.providerLabel, reason: display.attentionReason ?? display.statusLabel }) : ''}</span>
          <span
            className={`pane-agent-chip provider-${display.providerKey}`}
            title={display.subtitle}
            data-testid="pane-provider-chip"
            data-provider={display.providerKey}
          >
            {agentProfile ? (
              <AgentProviderIcon provider={agentProfile.provider} />
            ) : <SquareTerminal size={14} aria-hidden="true" />}
            <span className="pane-agent-chip-label">{display.providerLabel}</span>
          </span>
          {needsDecision && <span className="pane-decision-chip" title={display.attentionReason ? `${display.attentionReason} · ${statusText}` : statusText} data-testid="pane-decision-chip" aria-hidden="true">{display.statusLabel}</span>}
          <span className="pane-header-divider" aria-hidden="true">/</span>
          {isTerminalPane && <PaneBranchBadge workspace={workspace} pane={pane} />}
          {isTerminalPane && phoneWrite.allowed && <PhoneWriteBadge />}
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
              aria-label={tc('paneMenu.rename')}
            />
          ) : (
            <button
              type="button"
              className="pane-intent pane-intent-button"
              title={tc('paneMenu.titleHint', { title: display.title })}
              onDoubleClick={(e) => startRename(e)}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="pane-intent-text">{display.title}</span>
              <Pencil size={12} className="pane-intent-edit-hint" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="pane-actions">
          {isTerminalPane ? (
            <button
              type="button"
              className="tile-btn pane-search-btn"
              aria-label={tc('paneMenu.search')}
              title={tc('paneMenu.searchTitle')}
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
            aria-label={isMaximized ? tc('paneMenu.restore') : tc('paneMenu.maximize')}
            title={isMaximized ? tc('paneMenu.restore') : tc('paneMenu.maximize')}
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
              aria-label={tc('paneMenu.more')}
              title={tc('paneMenu.more')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                const trigger = e.currentTarget.getBoundingClientRect()
                setMenuAnchor({ top: trigger.bottom + 6, right: Math.max(8, window.innerWidth - trigger.right) })
                setMenuHeight(Math.max(120, window.innerHeight - trigger.bottom - 20))
                setMenuOpen((open) => !open)
              }}
            >
              <MoreHorizontal size={12} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="pane-actions-popover" role="menu" data-testid="pane-actions-menu" style={{ position: 'fixed', top: menuAnchor.top, right: menuAnchor.right, left: 'auto', maxHeight: menuHeight, overflowY: 'auto', width: 'min(260px, 75vw)', maxWidth: 'calc(100vw - 32px)' }}>
                {isTerminalPane ? (
                  <>
                    <button type="button" role="menuitem" className="pane-actions-popover-item" onClick={event => { event.stopPropagation(); runMenuAction(() => setDetailsOpen(true)) }}><Info size={14} aria-hidden="true" />{tc('paneMenu.details')}</button>
                    <Button variant="ghost" role="menuitem" className={paneMenu.item} data-testid="pane-why-status" onClick={event => { event.stopPropagation(); runMenuAction(() => setExplainOpen(true)) }}><CircleHelp size={14} aria-hidden="true" />{tc('paneMenu.whyStatus')}</Button>
                    <div className="pane-actions-popover-sep" aria-hidden="true" />
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
                      <Eraser size={14} aria-hidden="true" />
                      {tc('paneMenu.clear')}
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
                      <RotateCcw size={14} aria-hidden="true" />
                      {tc('paneMenu.newSession')}
                    </button>
                    <Suspense fallback={null}><TerminalFocusMenuItems paneId={pane.id} onDone={() => setMenuOpen(false)} /></Suspense>
                    {phoneWrite.offered && <PhoneWriteMenuItem paneId={pane.id} allowed={phoneWrite.allowed} onDone={runMenuAction} />}
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
                  <PanelRight size={14} aria-hidden="true" />
                  {tc('paneMenu.splitRight')}
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
                  <PanelBottom size={14} aria-hidden="true" />
                  {tc('paneMenu.splitDown')}
                </button>
                {onArrange ? <>
                  <div className="pane-actions-popover-sep" aria-hidden="true" />
                  <button type="button" role="menuitem" className="pane-actions-popover-item" onClick={e => { e.stopPropagation(); runMenuAction(() => onArrange('bottom')) }}><PanelBottom size={14} aria-hidden="true" />{tc('paneMenu.moveBelow')}</button>
                  <button type="button" role="menuitem" className="pane-actions-popover-item" onClick={e => { e.stopPropagation(); runMenuAction(() => onArrange('right')) }}><PanelRight size={14} aria-hidden="true" />{tc('paneMenu.moveRight')}</button>
                  <button type="button" role="menuitem" className="pane-actions-popover-item" onClick={e => { e.stopPropagation(); runMenuAction(() => onArrange('balance')) }}><RotateCcw size={14} aria-hidden="true" />{tc('paneMenu.balance')}</button>
                </> : null}
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
                      <X size={14} aria-hidden="true" />
                      {tc('paneMenu.close')}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <PaneContent pane={pane} workspaceId={workspace.id} workspaceRootPath={workspace.rootPath} autoStart={autoStart} />
      {detailsOpen && <Dialog className="desktop-details-dialog" title={tc('paneMenu.detailsTitle')} description={tc('paneMenu.detailsDescription')} onClose={() => setDetailsOpen(false)}>
        <p className="terminal-session-identity-note">{tc('paneMenu.identityNote')}</p>
        <DetailList rows={detailRows([
          [tc('panels.terminal'), display.title],
          [tc('paneMenu.status'), tc(`paneMenu.state.${terminalState.status}`)],
          [tc('paneMenu.activity'), terminalState.status === 'running' ? terminalState.isWorking ? tc('paneMenu.working') : tc('paneMenu.noActivity') : '—'],
          [tc('paneMenu.agent'), agentProfile?.name ?? '—'],
          [tc('paneMenu.shell'), shellProfileName ?? tc('paneMenu.workspaceDefault')],
          [tc('workspace.shell.directory'), pane.rootPath ?? workspace.rootPath],
          ...(terminalState.error ? [[tc('paneMenu.error'), terminalState.error]] : [])
        ])} />
        <Button size="sm" className="terminal-provider-session-action" onClick={() => { setDetailsOpen(false); setProviderSessionsOpen(true) }}>{tc('paneMenu.findSessions')}</Button>
        <details className="terminal-technical-details"><summary>{tc('paneMenu.internal')}</summary><DetailList rows={detailRows([
          [tc('paneMenu.ptyId'), sessionDetails?.sessionId ?? (sessionDetailsError || (sessionDetails ? tc('paneMenu.noSession') : tc('paneMenu.reading')))],
          [tc('paneMenu.paneId'), pane.id],
          [tc('paneMenu.workspaceId'), workspace.id],
          ...(sessionDetails?.launchDirectory ? [[tc('paneMenu.startDirectory'), sessionDetails.launchDirectory]] : []),
          ...(pane.rootPath !== workspace.rootPath ? [[tc('paneMenu.workspacePath'), workspace.rootPath]] : []),
          ...(sessionDetails?.executable ? [[tc('workspace.shell.executable'), sessionDetails.executable]] : []),
          ...(sessionDetails?.pid ? [[tc('paneMenu.pid'), String(sessionDetails.pid)]] : []),
          ...(sessionDetails?.startedAt ? [[tc('paneMenu.startedAt'), formatDateTime(sessionDetails.startedAt)]] : [])
        ])} /></details>
      </Dialog>}
      {explainOpen && <Suspense fallback={null}><StatusExplainDialog paneId={pane.id} display={display} onClose={() => setExplainOpen(false)} /></Suspense>}
      {providerSessionsOpen && <Suspense fallback={null}><ProviderSessionFinder workspaceId={workspace.id} rootPath={pane.rootPath ?? workspace.rootPath} onClose={() => setProviderSessionsOpen(false)} /></Suspense>}
    </section>
  )
}
