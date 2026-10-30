import type { ConversationThread } from '../../../shared/types/thread'
import { backgroundRunning } from '../../../shared/threadBackground'
import { i18n } from '../../i18n'

export type ThreadNavigationStatus = 'ready' | 'completed' | 'running' | 'attention' | 'failed' | 'interrupted'

const status = (kind: ThreadNavigationStatus, key: ThreadNavigationStatus | 'background' = kind) => ({ kind, label: i18n.t(`thread:status.${key}`) })

/** Execution state alone determines the status color; unread and selection are separate signals. */
export function threadNavigationStatus(thread: ConversationThread): { kind: ThreadNavigationStatus; label: string } {
  switch (thread.status) {
    case 'running': return status('running')
    case 'approval': return status('attention')
    case 'failed': return status('failed')
    case 'interrupted': return status('interrupted')
    // The turn is over but work the agent started in the background still runs: not done yet.
    case 'idle': if (backgroundRunning(thread)) return status('running', 'background')
      return thread.lastTurnStatus === 'completed' ? status('completed') : status('ready')
  }
}
