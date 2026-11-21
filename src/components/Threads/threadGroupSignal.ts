import type { ConversationThread } from '../../../shared/types/thread'
import type { SignalState } from '../../ui/StatusSignal'
import { threadNavigationStatus } from './threadNavigationStatus'

/** The signals a collapsed group can inherit, most urgent first (RN-1, OXE-187): Needs you > Failed > Working > Finished unread. */
export type GroupSignal = Extract<SignalState, 'needs-you' | 'failed' | 'working' | 'done'>

const ORDER: readonly GroupSignal[] = ['needs-you', 'failed', 'working', 'done']

/** The thread:status.* word each inherited signal says. */
export const GROUP_SIGNAL_WORD: Record<GroupSignal, 'attention' | 'failed' | 'running' | 'completed'> = {
  'needs-you': 'attention', failed: 'failed', working: 'running', done: 'completed'
}

function signalOf(thread: ConversationThread, unread: ReadonlySet<string>): GroupSignal | null {
  const kind = threadNavigationStatus(thread).kind
  if (kind === 'attention') return 'needs-you'
  if (kind === 'failed') return 'failed'
  if (kind === 'running') return 'working'
  if (kind === 'completed' && unread.has(thread.id)) return 'done'
  return null
}

/** The StatusSignal state of a group's most urgent conversation; null when none needs saying. */
export function dominantGroupSignal(threads: readonly ConversationThread[], unreadIds: readonly string[]): GroupSignal | null {
  const unread = new Set(unreadIds)
  let best = ORDER.length
  for (const thread of threads) {
    const signal = signalOf(thread, unread)
    if (signal) best = Math.min(best, ORDER.indexOf(signal))
    if (best === 0) break
  }
  return best < ORDER.length ? ORDER[best] : null
}
