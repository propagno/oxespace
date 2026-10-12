import { parentPort } from 'node:worker_threads'
import { NativeSessionReader } from '../services/conversation/native-session-history'
import type { ConversationThread } from '../../../shared/types/thread'

// Serial requests keep parsing memory bounded even when several conversations
// request pages simultaneously. No renderer-selected filesystem path is used.
let pending = Promise.resolve()
parentPort?.on('message', (input: { requestId: number; executable: string; thread: ConversationThread; id: string; cursor?: ConversationThread['nativeHistoryCursor'] }) => {
  pending = pending.then(async () => {
    try {
      const result = await new NativeSessionReader(() => input.executable).read(input.thread, input.id, input.cursor)
      parentPort?.postMessage({ requestId: input.requestId, result })
    } catch (error) {
      parentPort?.postMessage({ requestId: input.requestId, error: error instanceof Error ? error.message : 'Native history could not be read' })
    }
  })
})
