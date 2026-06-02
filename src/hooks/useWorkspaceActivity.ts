import { useMemo } from 'react'
import type { Workspace } from '../../shared/types/workspace'
import { useTerminalStore } from '../store/terminal.store'
import { deriveStatusTone, type PaneDisplayTone } from '../utils/paneDisplay'

/**
 * Aggregate agent-activity for a workspace, reusing the same per-pane tone
 * machine (`deriveStatusTone`) that drives the pane dots. Used by the sidebar
 * card signaling and the workspace status summary so both stay in sync.
 */
export interface WorkspaceActivity {
  total: number
  counts: Record<PaneDisplayTone, number>
  /** Most attention-worthy tone across the panes, or null when there are none. */
  dominant: PaneDisplayTone | null
}

const EMPTY_ENTRY = {
  status: 'idle' as const,
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false
}

// Priority when collapsing many panes into one card dot: a blocked/awaiting
// agent must win over background noise so "needs you" never hides behind idle.
const DOMINANCE: PaneDisplayTone[] = ['error', 'awaiting', 'thinking', 'starting', 'idle', 'exited']

export function useWorkspaceActivity(workspace: Pick<Workspace, 'panes'>): WorkspaceActivity {
  const panes = useTerminalStore((s) => s.panes)
  return useMemo(() => {
    const counts: Record<PaneDisplayTone, number> = { thinking: 0, awaiting: 0, starting: 0, error: 0, exited: 0, idle: 0 }
    let total = 0
    for (const pane of workspace.panes) {
      if (pane.type !== 'terminal') continue
      total += 1
      counts[deriveStatusTone(panes[pane.id] ?? EMPTY_ENTRY)] += 1
    }
    const dominant = total === 0 ? null : (DOMINANCE.find((tone) => counts[tone] > 0) ?? 'idle')
    return { total, counts, dominant }
  }, [workspace.panes, panes])
}
