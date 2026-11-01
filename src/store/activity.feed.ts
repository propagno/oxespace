import { deriveStatusTone } from '../utils/paneDisplay'
import { useActivityStore, type LiveAttention } from './activity.store'
import { useTerminalStore } from './terminal.store'
import { useThreadStore } from './thread.store'
import { useWorkspaceStore } from './workspace.store'

/**
 * Keeps the activity store's live attention in step with the terminal and Thread stores, synchronously,
 * so the mode switch badge reads one source and still changes in the same render as the state it counts.
 */
function codeLive(): Record<string, LiveAttention> {
  const entries: Record<string, LiveAttention> = {}
  const panes = useTerminalStore.getState().panes
  for (const workspace of useWorkspaceStore.getState().workspaces) {
    for (const pane of workspace.panes) {
      if (pane.type !== 'terminal') continue
      const entry = panes[pane.id]
      if (!entry) continue
      const tone = deriveStatusTone(entry)
      // Only an agent stopped on an approval or a question needs a person; a finished turn is news, not a request
      // (it stays visible on its pane and row, and in the activity center).
      if (tone === 'needs-decision') entries[pane.id] = 'needs-you'
      else if (tone === 'error') entries[pane.id] = 'failed'
      // bisect only (F7.3): a pane that is only working is not counted, to see the cost of its flips
    }
  }
  return entries
}

function threadLive(): Record<string, LiveAttention> {
  const entries: Record<string, LiveAttention> = {}
  const { threads, unreadIds } = useThreadStore.getState()
  for (const thread of threads) {
    if (thread.status === 'approval') entries[thread.id] = 'needs-you'
    // A failure counts until the person opens that conversation; one already seen stays in the list, not on the rail.
    else if (thread.status === 'failed' && unreadIds.includes(thread.id)) entries[thread.id] = 'failed'
    else if (thread.status === 'running') entries[thread.id] = 'working'
  }
  return entries
}

let connected = false

/** Idempotent; the subscriptions live as long as the stores do. */
export function connectAttentionFeed(): void {
  if (connected) return
  connected = true
  const syncCode = (): void => useActivityStore.getState().setLive('code', codeLive())
  const syncThread = (): void => useActivityStore.getState().setLive('thread', threadLive())
  useTerminalStore.subscribe((state, previous) => { if (state.panes !== previous.panes) syncCode() })
  useWorkspaceStore.subscribe((state, previous) => { if (state.workspaces !== previous.workspaces) syncCode() })
  useThreadStore.subscribe((state, previous) => { if (state.threads !== previous.threads || state.unreadIds !== previous.unreadIds) syncThread() })
  syncCode()
  syncThread()
}
