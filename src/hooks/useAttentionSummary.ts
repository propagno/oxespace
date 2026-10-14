import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTerminalStore } from '../store/terminal.store'
import { useThreadStore } from '../store/thread.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { deriveStatusTone } from '../utils/paneDisplay'

export interface AttentionCounts {
  /** Waiting for a person: an approval, a question, or an agent that stopped for input. */
  needsYou: number
  failed: number
  /** Agents busy on their own; informational, never an alert. */
  working: number
}

export interface AttentionSummary {
  code: AttentionCounts
  thread: AttentionCounts
}

const IDLE = { status: 'idle' as const, error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false }

/**
 * What needs a person, across every workspace and conversation, so the mode rail can say so
 * even when the project or workspace that holds it is collapsed or in the other mode.
 */
export function useAttentionSummary(): AttentionSummary {
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const paneStates = useTerminalStore(useShallow(state => workspaces.flatMap(workspace => workspace.panes.filter(pane => pane.type === 'terminal').map(pane => state.panes[pane.id] ?? IDLE))))
  const threadStatuses = useThreadStore(useShallow(state => state.threads.map(thread => thread.status)))
  return useMemo(() => {
    const code: AttentionCounts = { needsYou: 0, failed: 0, working: 0 }
    for (const entry of paneStates) {
      const tone = deriveStatusTone(entry)
      if (tone === 'awaiting') code.needsYou += 1
      else if (tone === 'error') code.failed += 1
      else if (tone === 'thinking') code.working += 1
    }
    const thread: AttentionCounts = { needsYou: 0, failed: 0, working: 0 }
    for (const status of threadStatuses) {
      if (status === 'approval') thread.needsYou += 1
      else if (status === 'failed') thread.failed += 1
      else if (status === 'running') thread.working += 1
    }
    return { code, thread }
  }, [paneStates, threadStatuses])
}

/** Spoken form for the badge, so the count is not color alone. */
export function describeAttention(counts: AttentionCounts): string {
  const parts: string[] = []
  if (counts.needsYou) parts.push(`${counts.needsYou} need${counts.needsYou === 1 ? 's' : ''} you`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (!parts.length && counts.working) parts.push(`${counts.working} working`)
  return parts.join(', ')
}
