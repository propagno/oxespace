import type { ConversationThread } from '../../../shared/types/thread'
import { backgroundRunning } from '../../../shared/threadBackground'
import { i18n } from '../../i18n'

export type ThreadNavigationStatus = 'ready' | 'completed' | 'running' | 'attention' | 'failed' | 'interrupted'

/** The state words a conversation row can say (docs/design/glossary.md § 5): Needs you · Working · Idle · Failed · Finished · Stopped. */
type StateWord = 'attention' | 'running' | 'idle' | 'failed' | 'completed' | 'interrupted'

const status = (kind: ThreadNavigationStatus, word: StateWord) => ({ kind, label: i18n.t(`thread:status.${word}`) })

/** Execution state alone determines the status color; unread and selection are separate signals. */
export function threadNavigationStatus(thread: ConversationThread): { kind: ThreadNavigationStatus; label: string } {
  switch (thread.status) {
    case 'running': return status('running', 'running')
    case 'approval': return status('attention', 'attention')
    case 'failed': return status('failed', 'failed')
    // Stopped by someone: Stopped, beside its stop square.
    case 'interrupted': return status('interrupted', 'interrupted')
    // The turn is over but work the agent started in the background still runs: not done yet.
    case 'idle': if (backgroundRunning(thread)) return status('running', 'running')
      // No finished turn yet (a new conversation): nothing runs and nothing waits.
      return thread.lastTurnStatus === 'completed' ? status('completed', 'completed') : status('ready', 'idle')
  }
}
