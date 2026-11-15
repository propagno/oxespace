import { GitBranch, Hand } from 'lucide-react'
import { useState, useRef, useEffect, type ReactElement } from 'react'
import { copyText, SidebarRow, StatusSignal, type SignalState } from '../../ui'
import { useTranslation } from 'react-i18next'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { formatActivityTime } from '../../utils/formatTime'
import { derivePaneDisplayState } from '../../utils/paneDisplay'
import { AgentProviderIcon } from './AgentProviderIcon'

interface PaneSessionRowProps {
  pane: WorkspacePane
  paneIndex: number
  workspace: Workspace
  isActive: boolean
  agentProfiles: AgentProfile[]
  onClick: () => void
  onActivatePane: (paneId: string) => void
}

/** The pane's tone as the brand's state signal (src/ui StatusSignal): the same shape for the same state everywhere. */
const SIGNAL: Record<string, SignalState> = {
  'needs-decision': 'needs-you',
  thinking: 'working',
  awaiting: 'done',
  idle: 'waiting',
  error: 'failed',
  exited: 'interrupted',
  starting: 'unconfirmed'
}

/**
 * A terminal in the OxeCode sidebar (BRD-01, OXE-60): a src/ui SidebarRow, one line, led by its status signal, its
 * state words in its accessible name. A terminal that needs a decision gets the row's second line, saying what is asked.
 */
export function PaneSessionRow({ pane, paneIndex, workspace, isActive, agentProfiles, onClick, onActivatePane }: PaneSessionRowProps): ReactElement {
  const { t } = useTranslation('code')
  const markRead = useTerminalStore(s => s.markRead)
  const terminalState = useTerminalStore(s => s.getStatus(pane.id))
  const updatePaneName = useWorkspaceStore(s => s.updatePaneName)
  const closePane = useWorkspaceStore(s => s.closePane)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const agentProfile = pane.agentProfileId
    ? agentProfiles.find(p => p.agentProfileId === pane.agentProfileId) ?? null
    : null
  // Prefer the persisted agentName; fall back to the profile's name when the
  // pane has a profile bound but agentName wasn't recorded (legacy rows /
  // restored panes whose agentName was lost on a prior write).
  const resolvedAgentName = pane.agentName ?? agentProfile?.name ?? null
  const hasAgent = resolvedAgentName !== null
  const baseLabel = hasAgent ? resolvedAgentName! : `${pane.type} ${paneIndex + 1}`
  const label = pane.displayName ?? baseLabel

  const { status, lastActivityAt, hasUnread } = terminalState
  const isRunning = status === 'running'
  const isStarting = status === 'starting'
  const canStopTerminal = pane.type === 'terminal' && (isRunning || isStarting)
  const display = derivePaneDisplayState({ pane, workspace, terminal: terminalState, profile: agentProfile, paneIndex })
  const needsDecision = display.statusTone === 'needs-decision'
  // Where the status comes from (UX-07), for the detail's tooltip.
  const statusTitle = [display.attentionReason, display.originLabel].filter(Boolean).join(' · ') || undefined
  const toneLabel = t(`sidebar.session.tone.${display.statusTone}`)

  // Mark read when the row becomes active
  useEffect(() => {
    if (isActive && hasUnread) markRead(pane.id)
  }, [isActive, hasUnread, markRead, pane.id])

  function handleClick(): void {
    if (menu) {
      setMenu(null)
      return
    }
    onClick()
    onActivatePane(pane.id)
    markRead(pane.id)
  }

  function handleContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  function handleDoubleClick(e: React.MouseEvent): void {
    e.stopPropagation()
    setDraft(label)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function handleSave(): void {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== baseLabel) {
      void updatePaneName(pane.id, trimmed)
    } else if (!trimmed || trimmed === baseLabel) {
      void updatePaneName(pane.id, null)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') setEditing(false)
  }

  async function stopTerminal(): Promise<void> {
    setMenu(null)
    if (pane.type !== 'terminal') return
    try {
      await window.oxe.terminal.stop({ paneId: pane.id })
      // A stop by hand sends no exit to the pane (main forgets the process first): without this the pane kept
      // reading "running" over a shell that was gone, and nothing said the stop had happened.
      useTerminalStore.getState().setStatus(pane.id, 'exited')
    } catch {
      // The pane may already be stopped; the close action should stay available.
    }
  }

  async function closeTerminal(): Promise<void> {
    setMenu(null)
    if (canStopTerminal) {
      try {
        await window.oxe.terminal.stop({ paneId: pane.id })
      } catch {
        // Keep closing the pane even if the PTY was already gone.
      }
    }
    await closePane(pane.id)
  }

  function startRename(): void {
    setMenu(null)
    setDraft(label)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function copyContext(): void {
    setMenu(null)
    const context = `${display.meta}\n${display.title}\n${display.subtitle}`
    void copyText(context, t('sidebar.session.context'), t('sidebar.session.contextCopied'))
  }

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const showUnreadDot = hasUnread && !isActive && isRunning
  const time = lastActivityAt && !editing ? <span className="pane-row-time">{formatActivityTime(lastActivityAt)}</span> : null

  return (
    <>
      <SidebarRow
        lead={<StatusSignal state={SIGNAL[display.statusTone] ?? 'unconfirmed'} label={toneLabel} size={12} />}
        title={editing ? (
          <input
            ref={inputRef}
            className="pane-session-rename"
            value={draft}
            autoFocus
            aria-label={t('sidebar.renameItem')}
            onChange={e => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
          />
        ) : <>
          {agentProfile ? <AgentProviderIcon provider={agentProfile.provider} /> : null}
          {pane.originPaneId && <span title={t('sidebar.session.delegated')} role="img" aria-label={t('sidebar.session.delegated')}><GitBranch size={12} aria-hidden="true" /></span>}
          <span title={label} onDoubleClick={handleDoubleClick}>{label}</span>
          {/* Shape, not color: a decision is marked beside the name too. The screen-reader text below says it. */}
          {needsDecision && <Hand size={12} className="pane-row-decision-mark" aria-hidden="true" data-testid="pane-row-decision-mark" />}
          {/* The row is named by what it shows; its state is added for screen readers (an aria-label that left out the
              visible text failed axe's label-content-name-mismatch). */}
          <span className="sr-only">, {toneLabel}{display.originLabel ? `, ${display.originLabel}` : ''}{pane.originPaneId ? `, ${t('sidebar.session.delegated')}` : ''}</span>
        </>}
        meta={time || showUnreadDot ? <>
          {showUnreadDot ? <span className="pane-unread-dot" role="img" aria-label={t('sidebar.session.unread')} /> : null}
          {time}
        </> : undefined}
        detail={needsDecision ? <span data-testid="pane-row-status" title={statusTitle}>{display.attentionReason ?? display.subtitle}</span> : undefined}
        selected={isActive}
        onSelect={handleClick}
        onContextMenu={handleContextMenu}
        data-list-item
        data-testid="pane-session-row"
        data-pane-id={pane.id}
        data-tone={display.statusTone}
        data-origin={display.statusOrigin ?? undefined}
      />
      {menu ? (
        <div
          className="pane-session-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={startRename}>
            {t('sidebar.renameItem')}
          </button>
          <button type="button" role="menuitem" onClick={copyContext}>
            {t('sidebar.session.copy')}
          </button>
          {canStopTerminal ? (
            <button type="button" role="menuitem" onClick={() => void stopTerminal()}>
              {t('sidebar.session.stop')}
            </button>
          ) : null}
          <button type="button" role="menuitem" className="danger" onClick={() => void closeTerminal()}>
            {t('sidebar.session.close')}
          </button>
        </div>
      ) : null}
    </>
  )
}
