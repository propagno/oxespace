import { Activity, Clock } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useWorkspaceActivity } from '../../hooks/useWorkspaceActivity'

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
  // Shared aggregator — same per-pane tone machine the sidebar card dots use,
  // so the topbar summary and the sidebar signaling never disagree. The summary
  // only distinguishes thinking / awaiting / (everything else = idle).
  const activity = useWorkspaceActivity(workspace)
  const counts = useMemo(() => {
    const thinking = activity.counts.thinking
    const awaiting = activity.counts.awaiting
    return { thinking, awaiting, idle: activity.total - thinking - awaiting, total: activity.total }
  }, [activity])

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
