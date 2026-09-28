import type { ConversationThread } from './types/thread'

export const PARTIAL_NATIVE_HISTORY_NOTICE = 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.'

/** A bounded transcript is informational; only ownership or import failures block a turn. */
export function blocksThreadInput(thread: Pick<ConversationThread, 'cliActive' | 'cliNotice'>): boolean {
  return Boolean(thread.cliActive || thread.cliNotice && thread.cliNotice !== PARTIAL_NATIVE_HISTORY_NOTICE)
}
