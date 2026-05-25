import { Activity, Clock } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useAgentStore } from '../../store/agent.store'
import { useTerminalStore } from '../../store/terminal.store'
import { derivePaneDisplayState } from '../../utils/paneDisplay'

interface WorkspaceStatusSummaryProps {
  workspace: Workspace
}

/**
 * Vibe-coding glanceable header: instead of an empty topbar spacer, surface
 * "how many agents are busy / waiting / idle" plus the workspace cost so far
 * today. Reuses the same activity derivation as panes — the source of truth
 * stays in terminalStore + derivePaneDisplayState.
 *
 * No new IPC, no new persistence — pure projection of state the renderer
 * already has.
 */
export function WorkspaceStatusSummary({ workspace }: WorkspaceStatusSummaryProps): ReactElement | null {
  // Subscribe narrowly: only the pane states for this workspace's panes.
  // Filtering inside the selector would be wasted work since pane lists move
  // rarely; we do it here so the component re-renders on any pane's activity
  // change but not on unrelated panes elsewhere in the store.
  const panesState = useTerminalStore((s) => s.panes)
  const allProfiles = useAgentStore((s) => s.allProfiles)

  const counts = useMemo(() => {
    let thinking = 0
    let awaiting = 0
    let idle = 0
    let total = 0
    for (const pane of workspace.panes) {
      if (pane.type !== 'terminal') continue
      total += 1
      const profile = pane.agentProfileId
        ? allProfiles.find((p) => p.agentProfileId === pane.agentProfileId) ?? null
        : null
      const terminal = panesState[pane.id] ?? {
        status: 'idle' as const,
        error: null,
        lastActivityAt: null,
        lastOutput: null,
        lastIntent: null,
        lastIntentAt: null,
        isWorking: false,
        hasUnread: false
      }
      const { statusTone } = derivePaneDisplayState({
        pane,
        workspace,
        terminal,
        profile,
        paneIndex: 0
      })
      if (statusTone === 'thinking') thinking += 1
      else if (statusTone === 'awaiting') awaiting += 1
      else idle += 1
    }
    return { thinking, awaiting, idle, total }
  }, [workspace, panesState, allProfiles])

  if (counts.total === 0) return null

  return (
    <div className="workspace-status-summary" role="status" aria-live="polite">
      <span className="workspace-status-pill">
        <Activity size={11} aria-hidden="true" />
        <strong>{counts.total}</strong>
        <span className="workspace-status-pill-label">{counts.total === 1 ? 'agent' : 'agents'}</span>
      </span>
      {counts.thinking > 0 ? (
        <span className="workspace-status-chip activity-thinking" title={`${counts.thinking} agent${counts.thinking === 1 ? '' : 's'} thinking right now`}>
          <span className="workspace-status-dot activity-thinking" aria-hidden="true" />
          {counts.thinking} thinking
        </span>
      ) : null}
      {counts.awaiting > 0 ? (
        <span className="workspace-status-chip activity-awaiting" title={`${counts.awaiting} agent${counts.awaiting === 1 ? '' : 's'} waiting for your input`}>
          <span className="workspace-status-dot activity-awaiting" aria-hidden="true" />
          {counts.awaiting} awaiting
        </span>
      ) : null}
      {counts.idle > 0 ? (
        <span className="workspace-status-chip activity-idle" title={`${counts.idle} idle agent${counts.idle === 1 ? '' : 's'}`}>
          <span className="workspace-status-dot activity-idle" aria-hidden="true" />
          {counts.idle} idle
        </span>
      ) : null}
      <span className="workspace-status-clock" title="Wall clock for the workspace session">
        <Clock size={10} aria-hidden="true" />
        <RelativeTime workspaceCreatedAt={null} />
      </span>
    </div>
  )
}

/**
 * Lightweight ticking clock that doesn't need a store — useEffect with
 * setInterval keeps it cheap and isolated to this small node.
 */
function RelativeTime({ workspaceCreatedAt }: { workspaceCreatedAt: number | null }): ReactElement {
  // For now, just show the current time HH:MM. We can swap to "session
  // elapsed" once workspaces persist a session-start timestamp — not adding
  // a schema change here.
  const formatter = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }), [])
  return <span>{formatter.format(new Date())}</span>
}
