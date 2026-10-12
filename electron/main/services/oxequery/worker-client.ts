import { Worker } from 'node:worker_threads'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; onProgress?: (progress: unknown) => void }

/** A lazily started worker; a crash fails the requests in flight and the next call starts a fresh one. */
export class OxeQueryWorkerClient {
  private worker?: Worker
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly path: string, private readonly timeoutMs = 120_000) {}

  call<T>(op: string, connection?: ResolvedConnection, input?: unknown, onProgress?: (progress: unknown) => void): Promise<T> {
    if (this.closed) return Promise.reject(new OxeQueryError('invalid', 'OxeQuery is shutting down.'))
    if (this.pending.size >= 32) return Promise.reject(new OxeQueryError('invalid', 'Too many database requests are running. Wait for one to finish.'))
    const worker = this.worker ?? this.start()
    const requestId = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { void this.reset('The database worker timed out and was restarted.') }, this.timeoutMs)
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer, ...(onProgress ? { onProgress } : {}) })
      try { worker.postMessage({ requestId, op, connection, input }) } catch {
        clearTimeout(timer); this.pending.delete(requestId)
        reject(new OxeQueryError('invalid', 'The request could not be sent.'))
      }
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    if (this.worker) await this.call('closeAll').catch(() => undefined)
    this.closed = true
    await this.reset('OxeQuery closed.')
  }

  private start(): Worker {
    const worker = new Worker(this.path, { resourceLimits: { maxOldGenerationSizeMb: 512 } })
    this.worker = worker
    worker.on('message', (message: { requestId: number; result?: unknown; progress?: unknown; error?: { code: OxeQueryError['code']; message: string; reasons?: string[] } }) => {
      if (this.worker !== worker) return
      const request = this.pending.get(message.requestId)
      if (!request) return
      if (message.progress !== undefined) {
        // A long export is alive: its time budget restarts with every report.
        clearTimeout(request.timer)
        request.timer = setTimeout(() => { void this.reset('The database worker timed out and was restarted.') }, this.timeoutMs)
        request.onProgress?.(message.progress)
        return
      }
      clearTimeout(request.timer); this.pending.delete(message.requestId)
      if (message.error) request.reject(new OxeQueryError(message.error.code, message.error.message, message.error.reasons ?? []))
      else request.resolve(message.result)
    })
    worker.on('error', () => { if (this.worker === worker) void this.reset('The database worker stopped unexpectedly. Retry the operation.') })
    worker.on('exit', () => { if (this.worker === worker) void this.reset('The database worker exited. Retry the operation.') })
    return worker
  }

  private async reset(reason: string): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new OxeQueryError('invalid', reason)) }
    this.pending.clear()
    await worker?.terminate().catch(() => undefined)
  }
}
