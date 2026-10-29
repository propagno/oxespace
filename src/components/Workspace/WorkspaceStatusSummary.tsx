import { Activity } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useWorkspaceActivity } from '../../hooks/useWorkspaceActivity'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

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
        <Activity size={12} aria-hidden="true" />
        <strong>{counts.total}</strong>
        <span className="workspace-status-pill-label">{tc('workspace.summary.agents', { count: counts.total })}</span>
      </span>
      {counts.thinking > 0 ? (
        <span className="workspace-status-chip activity-thinking" title={tc('workspace.summary.thinkingTitle', { count: counts.thinking })}>
          <span className="workspace-status-dot activity-thinking" aria-hidden="true" />
          {tc('sidebar.activity.thinking', { count: counts.thinking })}
        </span>
      ) : null}
      {counts.awaiting > 0 ? (
        <span className="workspace-status-chip activity-awaiting" title={tc('workspace.summary.awaitingTitle', { count: counts.awaiting })}>
          <span className="workspace-status-dot activity-awaiting" aria-hidden="true" />
          {tc('sidebar.activity.awaiting', { count: counts.awaiting })}
        </span>
      ) : null}
      {counts.idle > 0 ? (
        <span className="workspace-status-chip activity-idle" title={tc('workspace.summary.idleTitle', { count: counts.idle })}>
          <span className="workspace-status-dot activity-idle" aria-hidden="true" />
          {tc('sidebar.activity.idle', { count: counts.idle })}
        </span>
      ) : null}
    </div>
  )
}
