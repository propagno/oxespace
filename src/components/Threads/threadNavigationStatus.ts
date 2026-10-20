import type { ConversationThread } from '../../../shared/types/thread'
import { backgroundRunning } from '../../../shared/threadBackground'

export type ThreadNavigationStatus = 'ready' | 'completed' | 'running' | 'attention' | 'failed' | 'interrupted'

/** Execution state alone determines the status color; unread and selection are separate signals. */
export function threadNavigationStatus(thread: ConversationThread): { kind: ThreadNavigationStatus; label: string } {
  switch (thread.status) {
    case 'running': return { kind: 'running', label: 'Running' }
    case 'approval': return { kind: 'attention', label: 'Needs input' }
    case 'failed': return { kind: 'failed', label: 'Failed' }
    case 'interrupted': return { kind: 'interrupted', label: 'Interrupted' }
    // The turn is over but work the agent started in the background still runs: not done yet.
    case 'idle': if (backgroundRunning(thread)) return { kind: 'running', label: 'Background' }
      return thread.lastTurnStatus === 'completed'
      ? { kind: 'completed', label: 'Completed' }
      : { kind: 'ready', label: 'Ready' }
  }
}
