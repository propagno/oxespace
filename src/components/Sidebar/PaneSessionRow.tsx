import { GitBranch } from 'lucide-react'
import { useState, useRef, useEffect, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { formatActivityTime } from '../../utils/formatTime'
import { derivePaneDisplayState } from '../../utils/paneDisplay'
import { ActivityDot } from '../Indicators/ActivityDot'
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

const RECENT_MS = 15 * 60 * 1000

export function PaneSessionRow({ pane, paneIndex, workspace, isActive, agentProfiles, onClick, onActivatePane }: PaneSessionRowProps): ReactElement {
  const getStatus = useTerminalStore(s => s.getStatus)
  const markRead = useTerminalStore(s => s.markRead)
  const terminalState = getStatus(pane.id)
  const updatePaneName = useWorkspaceStore(s => s.updatePaneName)
  const closePane = useWorkspaceStore(s => s.closePane)
  // Branch from the shared `useGitBranch` hook — backed by `git.getBranch`
  // IPC, not the github.store. The github store is loaded lazily when the
  // GitHub panel opens, so depending on it left the sidebar branch chip
  // permanently blank in normal use. The hook caches per rootPath so N
  // sidebar rows + the pane statusbar share a single fetch every 10s.
  const branchRootPath = pane.rootPath ?? workspace.rootPath
  const branchStatus = useGitBranch(workspace.id, branchRootPath)
  const currentBranch = branchStatus?.branch ?? null
  const branchLabel = formatBranch(currentBranch)
  const rowContextLabel = branchLabel ?? displayBranchFromWorktreePath(pane.rootPath)
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
  const isExited = status === 'exited'
  const isError = status === 'error'
  const isRecent = lastActivityAt !== null && Date.now() - lastActivityAt < RECENT_MS
  const display = derivePaneDisplayState({ pane, workspace, terminal: terminalState, profile: agentProfile, paneIndex })
  const hasTopContext = Boolean(rowContextLabel) || editing

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

  function startRename(): void {
    setMenu(null)
    setDraft(label)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function copyContext(): void {
    setMenu(null)
    const context = `${display.meta}\n${display.title}\n${display.subtitle}`
    void navigator.clipboard?.writeText(context)
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
      data-testid="pane-session-row"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={e => !editing && e.key === 'Enter' && handleClick()}
    >
      {/* Left status indicator — pure activity dot.
          Previously rendered "✓" or a 1-based pane index, which read as a
          checkbox/selection affordance and competed with the agent provider
          icon shown later in the row. A dot communicates "this pane is in
          state X" without implying an action. */}
      <div className={`pane-row-icon${isExited ? ' dimmed' : ''}`} aria-hidden="true">
        <span className={`pane-activity-dot activity-${display.statusTone}`} />
      </div>

      {/* Body */}
      <div className={`pane-session-body${hasTopContext ? '' : ' compact'}`}>
        {hasTopContext ? (
          <div className="pane-row-top">
            {rowContextLabel ? (
              <span className="pane-row-context" title={currentBranch ?? pane.rootPath ?? workspace.rootPath}>
                <GitBranch size={10} aria-hidden="true" />
                {rowContextLabel}
              </span>
            ) : null}
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
            ) : null}
            {lastActivityAt && !editing ? (
              <span className={`pane-row-time${isRecent ? ' recent' : ''}`}>
                {formatActivityTime(lastActivityAt)}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="pane-row-title-line">
          <span
            className={`pane-row-title${display.title === terminalState.lastIntent ? ' pane-row-intent' : ''}`}
            title={display.title}
            onDoubleClick={handleDoubleClick}
          >
            {display.title}
          </span>
          {lastActivityAt && !editing && !hasTopContext ? (
            <span className={`pane-row-time title-time${isRecent ? ' recent' : ''}`}>
              {formatActivityTime(lastActivityAt)}
            </span>
          ) : null}
        </div>

        <div className="pane-row-bottom">
          {/* Status indicator — 3-tier activity (thinking/awaiting/idle).
              Starting and error keep their dedicated cues so they aren't
              conflated with the 3 normal states. */}
          {(isRunning || isStarting) && !isError && (
            <span className="pane-row-status-indicator">
              {isStarting
                ? <span className="session-starting-dot" />
                : <ActivityDot level={display.statusTone} />}
            </span>
          )}
          {isError && (
            <span className="pane-row-status-indicator session-error-dot" />
          )}

          {agentProfile ? <AgentProviderIcon provider={agentProfile.provider} /> : null}

          {/* Preview text */}
          <span className="pane-row-preview">{display.subtitle}</span>

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
          <button type="button" role="menuitem" onClick={startRename}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={copyContext}>
            Copy context
          </button>
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

/**
 * Truncate a branch name to ~18 chars so it fits next to the provider chip on
 * the third line without pushing the unread dot off the row. Splits on `/`
 * and keeps the trailing segment when it's a slash-prefixed branch (e.g.
 * `codex/workspace-customization-release` → `…ization-release`). Long single
 * names just get a trailing ellipsis.
 */
function formatBranch(branch: string | null): string | null {
  if (!branch) return null
  if (branch.length <= 18) return branch
  // Slash-prefixed conventional branches: drop the prefix (feat/, codex/,
  // chore/…) and keep the descriptive tail.
  const slashIdx = branch.indexOf('/')
  if (slashIdx > 0 && slashIdx < branch.length - 1) {
    const tail = branch.slice(slashIdx + 1)
    if (tail.length <= 16) return tail
    return tail.slice(0, 15) + '…'
  }
  return branch.slice(0, 17) + '…'
}

function displayBranchFromWorktreePath(path: string | null): string | null {
  if (!path) return null
  const match = path.match(/[\\/]worktrees[\\/]([^\\/]+)/i)
  if (!match?.[1]) return null
  return formatBranch(match[1])
}
