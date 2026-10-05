import { Worker } from 'node:worker_threads'
import type { ConversationThread } from '../../../../shared/types/thread'
import type { NativeSessionHistory } from './native-session-history'

/** One lazy worker per Thread runtime; never executes parsing on Electron's UI thread. */
export class NativeHistoryWorkerClient {
  private worker?: Worker
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, { resolve: (result: NativeSessionHistory) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly path: string, private readonly executable: (thread: ConversationThread) => string) {}

  read = (thread: ConversationThread, id: string, cursor?: ConversationThread['nativeHistoryCursor']): Promise<NativeSessionHistory> => {
    if (this.closed) return Promise.reject(Error('Native history reader is shutting down'))
    if (this.pending.size >= 16) return Promise.reject(Error('Several histories are loading. Wait and retry this page.'))
    const executable = this.executable(thread)
    const worker = this.worker ?? this.start()
    const requestId = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.reset('Native history reading timed out. Retry this page.') }, 30_000)
      this.pending.set(requestId, { resolve, reject, timer })
      try { worker.postMessage({ requestId, executable, thread, id, cursor }) }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(Error('Native history request could not be sent')) }
    })
  }

  async close(): Promise<void> { this.closed = true; await this.reset('Native history reader closed') }

  private start(): Worker {
    const worker = new Worker(this.path, { resourceLimits: { maxOldGenerationSizeMb: 128 } })
    this.worker = worker
    worker.on('message', (message: { requestId: number; result?: NativeSessionHistory; error?: string }) => {
      if (this.worker !== worker) return
      const request = this.pending.get(message.requestId)
      if (!request) return
      clearTimeout(request.timer); this.pending.delete(message.requestId)
      if (message.error || !message.result) request.reject(Error(message.error || 'Invalid native history response'))
      else request.resolve(message.result)
    })
    worker.on('error', () => { if (this.worker === worker) void this.reset('Native history reader stopped unexpectedly. Retry this page.') })
    worker.on('exit', () => { if (this.worker === worker) void this.reset('Native history reader exited. Retry this page.') })
    return worker
  }

  private async reset(reason: string): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(Error(reason)) }
    this.pending.clear()
    await worker?.terminate()
  }
}
