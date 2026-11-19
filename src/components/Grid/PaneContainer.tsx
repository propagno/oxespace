import { ChevronDown, ChevronRight, CircleHelp, History, Info, Keyboard, LayoutGrid, Maximize2, Minimize2, MoreHorizontal, PanelBottom, PanelRight, Pencil, RotateCcw, Search, SquareTerminal, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { TerminalStatusResult } from '../../../shared/types/ipc'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { derivePaneDisplayState, resolvePaneIdentity } from '../../utils/paneDisplay'
import { AgentSessionDetails, EnableResumeMenuItem, PaneHooksNotice, PaneResumeMarker, StartFreshMenuItem, usePaneResume } from '../AgentSessions/PaneResume'
import { PaneContent } from '../Panes/PaneContent'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { PaneBranchBadge } from '../Panes/PaneBranchBadge'
import { Button, Dialog, PaneHeader } from '../../ui'
import paneMenu from './PaneMenu.module.css'
import { paneMenuAtPointer, paneMenuPlacement, statusBarFloor, type PaneMenuPlacement } from './paneMenuPlacement'
import { DetailList } from '../Navigation/DetailList'
import { formatDateTime } from '../../utils/formatTime'
import { i18n } from '../../i18n'
import { PanePhoneHeaderMark, PanePhoneMenuItems } from './PanePhoneWrite'
import { isAutoFocusingTerminal } from '../../keyboard/terminalFocus'

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
  /** False on the first pane: the two "previous pane" moves have nowhere to go, and say so. */
  hasPreviousPane?: boolean
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

/** How long the agent has been in its state, short: 45s, 12m, 1h 05m. */
function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function statusClass(status: WorkspacePane['status']): string {
  if (status === 'running') return 'running'
  if (status === 'exited') return 'exited'
  return ''
}

/**
 * A named group of the ⋯ menu (BRD-16): its trigger is one item; the group opens under it as its own role=menu, so the
 * menu keeps at most 8 items of its own. Never a "More" bucket: each group is named for what it holds.
 */
function PaneSubmenu({ id, label, icon, open, onToggle, children }: { id: string; label: string; icon: ReactNode; open: boolean; onToggle: (id: string) => void; children: ReactNode }): ReactElement {
  const listId = useId()
  return <>
    <Button variant="ghost" role="menuitem" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} className={paneMenu.item} data-testid={`pane-menu-group-${id}`}
      onClick={event => { event.stopPropagation(); onToggle(id) }}
      onKeyDown={event => { if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) { event.preventDefault(); onToggle(id) } }}>
      {icon}{label}{open ? <ChevronDown size={14} className={paneMenu.chevron} aria-hidden="true" /> : <ChevronRight size={14} className={paneMenu.chevron} aria-hidden="true" />}
    </Button>
    {open ? <div id={listId} role="menu" aria-label={label} className={paneMenu.submenu}>{children}</div> : null}
  </>
}

export function PaneContainer({ agentProfile, autoStart, hasPreviousPane = true, isActive, isMaximized, onActivate, onArrange, onClose, onSplitHorizontal, onSplitVertical, onToggleMaximize, pane, workspace }: PaneContainerProps): ReactElement {
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
  // F32: what main did with this pane's earlier Claude/Codex session when the app reopened (B17).
  const identityKey = resolvePaneIdentity({ pane, profile: agentProfile, shellProfileName }).key
  const resumeAgent = identityKey === 'claude' || identityKey === 'codex' ? identityKey : null
  const resume = usePaneResume(pane.id, display.title, isTerminalPane && terminalState.status === 'running', resumeAgent, terminalState.agentState)
  const terminalCanMutate = terminalState.status === 'running'
  // BRD-14: the focused pane's header is the primitive's `focused`; the grid says which, else the terminal store.
  const storeActive = useTerminalStore((s) => s.activePaneId === pane.id)
  const focused = isActive ?? storeActive
  // CA-4: an agent pane shows how long its agent has been in its state (main's PaneAgentState.since); a shell has none.
  const hasAgent = Boolean(pane.agentProfileId || agentProfile)
  const [agentSince, setAgentSince] = useState<number | null>(null)
  useEffect(() => {
    setAgentSince(null)
    const api = window.oxe?.agentState
    if (!hasAgent || !api) return
    let live = true
    void Promise.resolve(api.list(workspace.id)).then(list => {
      if (!live || !Array.isArray(list)) return
      const own = list.find(entry => entry.paneId === pane.id)
      setAgentSince(own ? own.since : null)
    }).catch(() => undefined)
    const off = api.onChanged?.(event => {
      if (!live || event.paneId !== pane.id) return
      setAgentSince('cleared' in event ? null : event.since)
    })
    return () => { live = false; off?.() }
  }, [hasAgent, pane.id, workspace.id])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (agentSince === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [agentSince])
  const runningTime = hasAgent && agentSince !== null ? elapsedLabel(now - agentSince) : null
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [providerSessionsOpen, setProviderSessionsOpen] = useState(false)
  const [explainOpen, setExplainOpen] = useState(false)
  const needsDecision = display.statusTone === 'needs-decision'
  // OXE-128 CA-5: the header wears the attention ring while the pane waits, until the first key pressed in the pane;
  // leaving the state and entering it again starts a new wait, with the ring back.
  const [ringDismissed, setRingDismissed] = useState(false)
  const [ringWasWaiting, setRingWasWaiting] = useState(needsDecision)
  if (ringWasWaiting !== needsDecision) {
    setRingWasWaiting(needsDecision)
    if (!needsDecision) setRingDismissed(false)
  }
  const showAttentionRing = needsDecision && !ringDismissed
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
  // Fixed placement so the menu is not clipped by the pane it belongs to, and kept above the status bar.
  const [menuPlacement, setMenuPlacement] = useState<PaneMenuPlacement>({ top: 0, right: 0, maxHeight: 320 })
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  // CODE-8: a right click (or Shift+F10, the context-menu key) on the header opens the ⋯ actions at the pointer.
  // The rename field keeps its own menu (cut, copy, paste).
  function openMenuFromContext(event: React.MouseEvent<HTMLElement>): void {
    const target = event.target as HTMLElement | null
    if (target?.closest('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const fromKeyboard = event.clientX === 0 && event.clientY === 0
    const button = menuButtonRef.current
    if (fromKeyboard && button) setMenuPlacement(paneMenuPlacement(button.getBoundingClientRect(), viewport, statusBarFloor()))
    else setMenuPlacement(paneMenuAtPointer({ x: event.clientX, y: event.clientY }, viewport, statusBarFloor()))
    setMenuOpen(true)
  }

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

  // BRD-16: one named group open at a time; the menu opens with all of them closed.
  const [submenu, setSubmenu] = useState<string | null>(null)
  useEffect(() => { if (!menuOpen) setSubmenu(null) }, [menuOpen])
  const toggleSubmenu = (id: string): void => setSubmenu(current => current === id ? null : id)
  const newSessionItem = <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => { window.dispatchEvent(new CustomEvent('oxe:terminal-new-session', { detail: { paneId: pane.id } })) }) }}><RotateCcw size={14} aria-hidden="true" />{tc('paneMenu.newSession')}</Button>

  return (
    <section className={`pane-container${isActive ? ' active' : ''}`} data-testid="pane-container" data-pane-id={pane.id} data-tone={display.statusTone} tabIndex={-1} onFocus={() => { if (!isAutoFocusingTerminal()) onActivate?.(pane.id) }} onPointerDown={() => onActivate?.(pane.id)} onKeyDown={() => { if (showAttentionRing) setRingDismissed(true) }}>
      <PaneHeader
        className="pane-header"
        focused={focused}
        {...workspaceColorAttrs(workspace)}
        data-attention={showAttentionRing ? 'true' : undefined}
        onContextMenu={openMenuFromContext}
        status={<>
          <span className={`pane-status-dot ${statusClass(pane.status)} activity-${display.statusTone}${display.statusEstimated ? ' is-estimated' : ''}`} aria-hidden="true" title={statusText} data-testid="pane-status-dot" data-origin={display.statusOrigin ?? undefined} />
          <span className="sr-only" data-testid="pane-status-text">{statusText}</span>
          {/* Polite and once: the text appears when the pane enters the state and stays while it holds. */}
          <span className="sr-only" role="status" data-testid="pane-decision-live">{needsDecision ? tc('pane.decisionAnnounce', { agent: display.providerLabel, reason: display.attentionReason ?? display.statusLabel }) : ''}</span>
        </>}
        provider={<>
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
          {isTerminalPane && <PanePhoneHeaderMark paneId={pane.id} />}
          {isTerminalPane && resume && <PaneResumeMarker paneId={pane.id} outcome={resume} />}
        </>}
        branch={isTerminalPane ? <PaneBranchBadge paneId={pane.id} workspace={workspace} pane={pane} /> : null}
        meta={runningTime ? <span data-ui="pane-running-time">{runningTime}</span> : null}
        title={renaming ? (
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
              title={tc('paneMenu.titleHint', { title: display.lastCommand ? `${display.title} · ${display.lastCommand}` : display.title })}
              onDoubleClick={(e) => startRename(e)}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="pane-intent-text">{display.title}</span>
              <Pencil size={12} className="pane-intent-edit-hint" aria-hidden="true" />
            </button>
          )}
      >
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
              ref={menuButtonRef}
              className={`tile-btn${menuOpen ? ' active' : ''}`}
              aria-label={tc('paneMenu.more')}
              title={tc('paneMenu.more')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                const trigger = e.currentTarget.getBoundingClientRect()
                setMenuPlacement(paneMenuPlacement(trigger, { width: window.innerWidth, height: window.innerHeight }, statusBarFloor()))
                setMenuOpen((open) => !open)
              }}
            >
              <MoreHorizontal size={12} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="pane-actions-popover" role="menu" data-testid="pane-actions-menu" data-placement={menuPlacement.bottom === undefined ? 'below' : 'above'} style={{ position: 'fixed', top: menuPlacement.top ?? 'auto', bottom: menuPlacement.bottom ?? 'auto', right: menuPlacement.right ?? 'auto', left: menuPlacement.left ?? 'auto', maxHeight: menuPlacement.maxHeight, overflowY: 'auto', width: 'min(260px, 75vw)', maxWidth: 'calc(100vw - 32px)' }}>
                {isTerminalPane ? <>
                  <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => setDetailsOpen(true)) }}><Info size={14} aria-hidden="true" />{tc('paneMenu.details')}</Button>
                  <Button variant="ghost" role="menuitem" className={paneMenu.item} data-testid="pane-why-status" onClick={event => { event.stopPropagation(); runMenuAction(() => setExplainOpen(true)) }}><CircleHelp size={14} aria-hidden="true" />{tc('paneMenu.whyStatus')}</Button>
                  <div role="separator" className="pane-actions-popover-sep" />
                  {/* BRD-16: what is unavailable is hidden, never shown disabled. Clear terminal is in the terminal's own right-click menu. */}
                  {resumeAgent ? <PaneSubmenu id="session" label={tc('paneMenu.sessionGroup')} icon={<History size={14} aria-hidden="true" />} open={submenu === 'session'} onToggle={toggleSubmenu}>
                    {terminalCanRestart ? newSessionItem : null}
                    <EnableResumeMenuItem agent={resumeAgent} onDone={runMenuAction} />
                    {resume?.outcome === 'resumed' && <StartFreshMenuItem paneId={pane.id} agent={resume.agent} onDone={runMenuAction} />}
                  </PaneSubmenu> : terminalCanRestart ? newSessionItem : null}
                  <PaneSubmenu id="keys" label={tc('paneMenu.keysGroup')} icon={<Keyboard size={14} aria-hidden="true" />} open={submenu === 'keys'} onToggle={toggleSubmenu}>
                    <Suspense fallback={null}><TerminalFocusMenuItems paneId={pane.id} onDone={() => setMenuOpen(false)} /></Suspense>
                    <PanePhoneMenuItems paneId={pane.id} onDone={runMenuAction} />
                  </PaneSubmenu>
                  <div role="separator" className="pane-actions-popover-sep" />
                </> : null}
                <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => onSplitVertical?.(pane.id)) }}><PanelRight size={14} aria-hidden="true" />{tc('paneMenu.splitRight')}</Button>
                <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => onSplitHorizontal?.(pane.id)) }}><PanelBottom size={14} aria-hidden="true" />{tc('paneMenu.splitDown')}</Button>
                {onArrange ? <PaneSubmenu id="arrange" label={tc('paneMenu.arrange')} icon={<LayoutGrid size={14} aria-hidden="true" />} open={submenu === 'arrange'} onToggle={toggleSubmenu}>
                  {hasPreviousPane ? <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => onArrange('bottom')) }}><PanelBottom size={14} aria-hidden="true" />{tc('paneMenu.moveBelow')}</Button> : null}
                  {hasPreviousPane ? <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => onArrange('right')) }}><PanelRight size={14} aria-hidden="true" />{tc('paneMenu.moveRight')}</Button> : null}
                  <Button variant="ghost" role="menuitem" className={paneMenu.item} onClick={event => { event.stopPropagation(); runMenuAction(() => onArrange('balance')) }}><RotateCcw size={14} aria-hidden="true" />{tc('paneMenu.balance')}</Button>
                </PaneSubmenu> : null}
                {onClose ? <>
                  <div role="separator" className="pane-actions-popover-sep" />
                  <Button variant="ghost" role="menuitem" className={`${paneMenu.item} ${paneMenu.danger} pane-actions-popover-item danger`} onClick={event => { event.stopPropagation(); runMenuAction(() => onClose(pane.id)) }}><X size={14} aria-hidden="true" />{tc('paneMenu.close')}</Button>
                </> : null}
              </div>
            ) : null}
          </div>
        </div>
      </PaneHeader>
      {/* F32: the status-hooks question for this pane's agent, without taking the terminal's focus. */}
      {isTerminalPane && <PaneHooksNotice paneId={pane.id} />}
      <div style={{ display: 'contents' }}>
        <PaneContent pane={pane} workspaceId={workspace.id} workspaceRootPath={workspace.rootPath} autoStart={autoStart} />
      </div>
      {detailsOpen && <Dialog size="md" title={tc('paneMenu.detailsTitle')} description={tc('paneMenu.detailsDescription')} onClose={() => setDetailsOpen(false)}>
        {/* F32: the native session main resumed or recorded; the note on finding it only when there is none. */}
        {sessionDetails?.agentSession && <AgentSessionDetails session={sessionDetails.agentSession} resume={sessionDetails.agentResume} />}
        {(!sessionDetails?.agentSession || sessionDetails.agentSession.source === 'notFound') && <p className="terminal-session-identity-note">{tc('paneMenu.identityNote')}</p>}
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
