import { useState, useRef, useEffect, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { formatActivityTime } from '../../utils/formatTime'
import { AgentProviderIcon } from './AgentProviderIcon'

interface PaneSessionRowProps {
  pane: WorkspacePane
  paneIndex: number
  isActive: boolean
  agentProfiles: AgentProfile[]
  onClick: () => void
  onActivatePane: (paneId: string) => void
}

const AVATAR_TOKENS = [
  'var(--avatar-1)', 'var(--avatar-2)', 'var(--avatar-3)',
  'var(--avatar-4)', 'var(--avatar-5)', 'var(--avatar-6)',
]

const RECENT_MS = 15 * 60 * 1000

function pickAvatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return AVATAR_TOKENS[Math.abs(hash) % AVATAR_TOKENS.length]
}

function WorkingIndicator(): ReactElement {
  return (
    <span className="session-working-indicator" aria-label="Working">
      <span />
      <span />
      <span />
    </span>
  )
}

function DormantIndicator(): ReactElement {
  return (
    <span className="session-dormant-indicator" aria-label="Idle">
      z<sup>z</sup>Z
    </span>
  )
}

export function PaneSessionRow({ pane, paneIndex, isActive, agentProfiles, onClick, onActivatePane }: PaneSessionRowProps): ReactElement {
  const getStatus = useTerminalStore(s => s.getStatus)
  const markRead = useTerminalStore(s => s.markRead)
  const terminalState = getStatus(pane.id)
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
  const avatarColor = pickAvatarColor(pane.id)

  const { status, lastActivityAt, lastOutput, isWorking, hasUnread } = terminalState
  const isRunning = status === 'running'
  const isStarting = status === 'starting'
  const canStopTerminal = pane.type === 'terminal' && (isRunning || isStarting)
  const isExited = status === 'exited'
  const isError = status === 'error'
  const isRecent = lastActivityAt !== null && Date.now() - lastActivityAt < RECENT_MS

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

  return (
    <div
      className={`pane-session-row${isActive ? ' active' : ''}${isExited ? ' exited' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={e => !editing && e.key === 'Enter' && handleClick()}
    >
      {/* Left icon */}
      <div className={`pane-row-icon${isExited ? ' dimmed' : ''}`}>
        {agentProfile ? (
          <AgentProviderIcon provider={agentProfile.provider} />
        ) : (
          <div className="pane-avatar" style={{ background: avatarColor }}>
            {paneIndex + 1}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="pane-session-body">
        <div className="pane-row-top">
          {editing ? (
            <input
              ref={inputRef}
              className="pane-session-rename"
              value={draft}
              autoFocus
              onChange={e => setDraft(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span
              className={`pane-session-label${isExited ? ' dimmed' : ''}`}
              onDoubleClick={handleDoubleClick}
            >
              {label}
            </span>
          )}
          {lastActivityAt && !editing && (
            <span className={`pane-row-time${isRecent ? ' recent' : ''}`}>
              {formatActivityTime(lastActivityAt)}
            </span>
          )}
        </div>

        <div className="pane-row-bottom">
          {/* Status indicator */}
          {isRunning && (
            <span className="pane-row-status-indicator">
              {isWorking ? <WorkingIndicator /> : <DormantIndicator />}
            </span>
          )}
          {isStarting && (
            <span className="pane-row-status-indicator">
              <span className="session-starting-dot" />
            </span>
          )}
          {isError && (
            <span className="pane-row-status-indicator session-error-dot" />
          )}

          {/* Preview text */}
          {isExited ? (
            <span className="pane-session-resume">Resume →</span>
          ) : lastOutput ? (
            <span className="pane-row-preview">{lastOutput}</span>
          ) : (
            <span className="pane-row-preview pane-row-preview-empty">
              {isStarting ? 'Starting…' : isRunning ? 'Running' : 'Idle'}
            </span>
          )}

          {/* Unread dot */}
          {showUnreadDot && <span className="pane-unread-dot" aria-label="Unread output" />}
        </div>
      </div>
      {menu ? (
        <div
          className="pane-session-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {canStopTerminal ? (
            <button type="button" role="menuitem" onClick={() => void stopTerminal()}>
              Stop terminal
            </button>
          ) : null}
          <button type="button" role="menuitem" className="danger" onClick={() => void closeTerminal()}>
            Close terminal
          </button>
        </div>
      ) : null}
    </div>
  )
}
