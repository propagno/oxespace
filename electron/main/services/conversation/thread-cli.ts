import type { ConversationThread } from '../../../../shared/types/thread'
import { NativeSessionReader } from './native-session-history'

interface Options {
  historyReader?: { read(thread: ConversationThread, id: string, cursor?: ConversationThread['nativeHistoryCursor']): Promise<import('./native-session-history').NativeSessionHistory>; close(): Promise<void> }
}

/**
 * Reads a provider's own saved session history (for resume, import, fork and
 * rewind proofs). The interactive TUI lease that used to live here was replaced
 * by integrated Thread controls and has been removed.
 */
export class ThreadNativeCli {
  constructor(private readonly executable: (thread: ConversationThread) => string, private readonly options: Options = {}) {}

  read(thread: ConversationThread, id: string, cursor?: ConversationThread['nativeHistoryCursor']) {
    return this.options.historyReader ? this.options.historyReader.read(thread, id, cursor) : new NativeSessionReader(this.executable).read(thread, id, cursor)
  }

  async closeHistoryReader(): Promise<void> { await this.options.historyReader?.close() }
}
