import type { ConversationThread } from '../../../shared/types/thread'
import { backgroundRunning } from '../../../shared/threadBackground'
import { i18n } from '../../i18n'

export type ThreadNavigationStatus = 'ready' | 'completed' | 'running' | 'attention' | 'failed' | 'interrupted'

/** The five state words (src/design/targets/README.md › State words): Needs you · Working · Idle · Failed · Finished. */
type StateWord = 'attention' | 'running' | 'idle' | 'failed' | 'completed'

const status = (kind: ThreadNavigationStatus, word: StateWord) => ({ kind, label: i18n.t(`thread:status.${word}`) })

/** Execution state alone determines the status color; unread and selection are separate signals. */
export function threadNavigationStatus(thread: ConversationThread): { kind: ThreadNavigationStatus; label: string } {
  switch (thread.status) {
    case 'running': return status('running', 'running')
    case 'approval': return status('attention', 'attention')
    case 'failed': return status('failed', 'failed')
    // Stopped by someone: nothing runs and nothing waits, so the word is Idle; the stop square still tells it apart.
    case 'interrupted': return status('interrupted', 'idle')
    // The turn is over but work the agent started in the background still runs: not done yet.
    case 'idle': if (backgroundRunning(thread)) return status('running', 'running')
      // No finished turn yet (a new conversation): nothing runs and nothing waits.
      return thread.lastTurnStatus === 'completed' ? status('completed', 'completed') : status('ready', 'idle')
  }
}
