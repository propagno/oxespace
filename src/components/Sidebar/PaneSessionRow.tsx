import { GitBranch } from 'lucide-react'
import { useState, useRef, useEffect, type ReactElement } from 'react'
import { AnchoredMenu, copyText, SidebarRow, StatusSignal, type MenuEntry, type SignalState } from '../../ui'
import { useTranslation } from 'react-i18next'
import type { AgentProfile, AgentProvider } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { formatActivityTime } from '../../utils/formatTime'
import { compactPreview, derivePaneDisplayState, sanitizeTerminalPreview } from '../../utils/paneDisplay'
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
 * Its right-click menu is the src/ui AnchoredMenu (BRD-16, OXE-85): Rename, Copy context, Stop terminal while there is
 * one to stop, then Close terminal alone in the last group.
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

  const { status, lastActivityAt, hasUnread } = terminalState
  const isRunning = status === 'running'
  const isStarting = status === 'starting'
  const canStopTerminal = pane.type === 'terminal' && (isRunning || isStarting)
  const display = derivePaneDisplayState({ pane, workspace, terminal: terminalState, profile: agentProfile, paneIndex })
  const hasBoundOrRuntimeAgent = Boolean(
    agentProfile || pane.agentName?.trim() || terminalState.agentName?.trim()
  )
  const hasActiveLauncherAgent =
    display.providerKey !== 'shell' &&
    (Boolean(terminalState.agentState) ||
      Boolean(terminalState.hookState) ||
      terminalState.isWorking ||
      Boolean(terminalState.lastIntent?.trim()) ||
      Boolean(terminalState.lastOutput?.trim()))
  const hasAgent = hasBoundOrRuntimeAgent || hasActiveLauncherAgent
  const taskSummary = hasAgent
    ? (terminalState.lastIntent?.trim() ? compactPreview(terminalState.lastIntent) : terminalState.lastOutput?.trim() ? sanitizeTerminalPreview(terminalState.lastOutput) : null)
    : null
  const fallbackTypeLabel = pane.type === 'terminal' ? t('panels.terminal') : pane.type
  const baseLabel = hasAgent
    ? (taskSummary && taskSummary !== display.providerLabel ? `${display.providerLabel} · ${taskSummary}` : display.providerLabel)
    : `${fallbackTypeLabel} ${paneIndex + 1}`
  const label = pane.displayName?.trim() || baseLabel
  const providerIconKey: AgentProvider | null = agentProfile?.provider
    ?? (hasAgent ? (display.providerKey as AgentProvider) : null)
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

  /** The row the menu belongs to: the keyboard goes back there when the menu closes. */
  function rowElement(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[data-testid="pane-session-row"]')].find(el => el.dataset.paneId === pane.id) ?? null
  }

  // BRD-16: nothing unavailable is shown (Stop only while there is a shell to stop); Close is danger, so the src/ui
  // menu puts it last, alone, after a separator (orderMenuEntries).
  const menuItems: MenuEntry[] = [
    { label: t('sidebar.renameItem'), onSelect: startRename },
    { label: t('sidebar.session.copy'), onSelect: copyContext },
    ...(canStopTerminal ? [{ label: t('sidebar.session.stop'), onSelect: () => { void stopTerminal() } }] : []),
    { label: t('sidebar.session.close'), danger: true, onSelect: () => { void closeTerminal() } }
  ]

  const showUnreadDot = hasUnread && !isActive && isRunning
  const time = lastActivityAt && !editing ? <span className="pane-row-time">{formatActivityTime(lastActivityAt)}</span> : null

  return (
    <>
      <SidebarRow
        lead={<StatusSignal state={SIGNAL[display.statusTone] ?? 'unconfirmed'} label={toneLabel} size={12} data-testid={needsDecision ? 'pane-row-decision-mark' : undefined} />}
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
        ) : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
          {providerIconKey ? <AgentProviderIcon provider={providerIconKey} size={14} /> : null}
          {pane.originPaneId && <span title={t('sidebar.session.delegated')} role="img" aria-label={t('sidebar.session.delegated')}><GitBranch size={12} aria-hidden="true" /></span>}
          <span title={label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onDoubleClick={handleDoubleClick}>{label}</span>
          {/* The row is named by what it shows; its state is added for screen readers (an aria-label that left out the
              visible text failed axe's label-content-name-mismatch). */}
          <span className="sr-only">, {toneLabel}{display.originLabel ? `, ${display.originLabel}` : ''}{pane.originPaneId ? `, ${t('sidebar.session.delegated')}` : ''}</span>
        </span>}
        meta={time || showUnreadDot ? <>
          {showUnreadDot ? <span className="pane-unread-dot" role="img" aria-label={t('sidebar.session.unread')} /> : null}
          {time}
        </> : undefined}
        detail={needsDecision ? <span className="pane-row-preview is-decision" data-testid="pane-row-status" title={statusTitle}>{display.attentionReason ?? display.subtitle}</span> : undefined}
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
        <span style={{ position: 'fixed', left: menu.x, top: menu.y, width: 0, height: 0 }}>
          <AnchoredMenu open onOpenChange={open => { if (!open) setMenu(null) }} side="bottom" label={t('sidebar.session.menu')} returnFocus={rowElement} items={menuItems} />
        </span>
      ) : null}
    </>
  )
}
