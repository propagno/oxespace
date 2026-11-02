import { Worker } from 'node:worker_threads'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { maskLogLine } from './agent-output'
import { recordIncident } from '../diagnostics/incident-sink'

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; budgetMs: number; op?: string; connection?: ResolvedConnection; onProgress?: (progress: unknown) => void }

/** One line about a worker failure with credentials in URLs and key=value pairs masked. */
function describeFault(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '')
  return maskLogLine(raw.replace(/\s+/g, ' ').trim())
}

/** Slack on top of the server-side statement timeout, so the server reports its own timeout first. */
const STATEMENT_SLACK_MS = 30_000
/** After a request times out, the worker must answer a ping this fast or it is restarted. */
const PROBE_MS = 10_000
/** Requests that stop or close work rather than do it. */
const CONTROL_OPS = new Set(['ping', 'close', 'closeAll', 'sql.cancel', 'mongo.cancel'])
/** Mongo reads that `mongo.cancel` stops (they are tagged in the worker); any other Mongo request is stopped by closing its client. */
const MONGO_CANCELLABLE = new Set(['mongo.find', 'mongo.aggregate'])

/** Work the person started on a connection: the worker is never restarted under it. */
function isPersonWork(request: Pick<Pending, 'op' | 'connection'>): boolean {
  return Boolean(request.connection) && (request.connection?.role ?? 'person') === 'person' && !CONTROL_OPS.has(request.op ?? '')
}

/**
 * A lazily started worker; a crash fails the requests in flight and the next call starts a fresh one. A request that
 * runs out of time fails alone: its statement is cancelled (or its connection closed), and only for its own role, so an
 * agent's timeout never touches the person's session.
 *
 * Restarting the worker drops every connection, so it is the last resort: only when the worker no longer answers a
 * ping AND no person session is at risk — none with a transaction open or failed or a command running, as the worker
 * last reported (`personAtRisk` on every answer), and no request of the person's still waiting. Otherwise the restart
 * is put off and the next timeout asks again.
 */
export class OxeQueryWorkerClient {
  private worker?: Worker
  private probing?: Promise<void>
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, Pending>()
  /** The person's sessions at risk, as the worker last reported them. */
  private personAtRisk = 0

  /** `onFault` receives what the worker died of, for the log; the message the user sees carries a short, masked form. */
  constructor(private readonly path: string, private readonly timeoutMs = 120_000, private readonly onFault?: (detail: string) => void, private readonly probeMs = PROBE_MS) {}

  call<T>(op: string, connection?: ResolvedConnection, input?: unknown, onProgress?: (progress: unknown) => void): Promise<T> {
    if (this.closed) return Promise.reject(new OxeQueryError('invalid', 'OxeQuery is shutting down.'))
    if (this.pending.size >= 32) return Promise.reject(new OxeQueryError('invalid', 'Too many database requests are running. Wait for one to finish.'))
    const worker = this.worker ?? this.start()
    const requestId = ++this.sequence
    // A connection may allow statements of up to an hour; the worker must not be
    // restarted (killing every connection and tunnel) before the server gives up.
    const statementMs = connection?.statementTimeoutMs
    const budgetMs = statementMs ? Math.max(this.timeoutMs, statementMs + STATEMENT_SLACK_MS) : this.timeoutMs
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => this.expire(requestId), budgetMs)
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer, budgetMs, op, ...(connection ? { connection } : {}), ...(onProgress ? { onProgress } : {}) })
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
    worker.on('message', (message: { requestId: number; result?: unknown; progress?: unknown; personAtRisk?: number; error?: { code: OxeQueryError['code']; message: string; reasons?: string[]; detail?: OxeQueryError['detail']; codes?: OxeQueryError['codes'] } }) => {
      if (this.worker !== worker) return
      if (typeof message.personAtRisk === 'number') this.personAtRisk = message.personAtRisk
      const request = this.pending.get(message.requestId)
      if (!request) return
      if (message.progress !== undefined) {
        // A long export is alive: its time budget restarts with every report.
        clearTimeout(request.timer)
        request.timer = setTimeout(() => this.expire(message.requestId), request.budgetMs)
        request.onProgress?.(message.progress)
        return
      }
      clearTimeout(request.timer); this.pending.delete(message.requestId)
      if (message.error?.code === 'timeout') recordIncident('incident.oxequery.timeout', request.connection?.id ?? request.op)
      if (message.error) request.reject(new OxeQueryError(message.error.code, message.error.message, message.error.reasons ?? [], message.error.detail ?? {}, message.error.codes ?? {}))
      else request.resolve(message.result)
    })
    worker.on('error', (error: unknown) => {
      if (this.worker !== worker) return
      const detail = describeFault(error)
      try { this.onFault?.(detail) } catch { /* logging must not stop the reset */ }
      void this.reset(`The database worker stopped unexpectedly${detail ? ` (${detail.slice(0, 160)})` : ''}. Retry the operation.`)
    })
    worker.on('exit', (code: number) => {
      if (this.worker !== worker) return
      try { this.onFault?.(`worker exited with code ${code}`) } catch { /* see above */ }
      void this.reset(`The database worker exited (code ${code}). Retry the operation.`)
    })
    return worker
  }

  /** One request ran out of time: fail it alone, stop its work on the server, and check the worker still answers. */
  private expire(requestId: number): void {
    const request = this.pending.get(requestId)
    if (!request) return
    this.pending.delete(requestId)
    recordIncident('incident.oxequery.timeout', request.connection?.id ?? request.op)
    request.reject(new OxeQueryError('invalid', 'The database did not answer in time. The request was cancelled; your other connections are unaffected.'))
    // The person's command may still be running in the worker: count it at risk until the worker says otherwise.
    if (isPersonWork(request)) this.personAtRisk = Math.max(this.personAtRisk, 1)
    if (request.connection && !CONTROL_OPS.has(request.op ?? '')) {
      // Stop the work of this request's role only: an agent's timeout cancels the agent's statement, never the person's.
      const connection = { ...request.connection, role: request.connection.role ?? 'person' as const }
      const stop = request.op?.startsWith('sql.') ? 'sql.cancel' : MONGO_CANCELLABLE.has(request.op ?? '') ? 'mongo.cancel' : 'close'
      void this.call(stop, connection).catch(() => undefined)
    }
    void this.probe(request.connection?.id)
  }

  /** Whether a restart would cost the person work: see the class comment. */
  private personSessionAtRisk(): boolean {
    return this.personAtRisk > 0 || [...this.pending.values()].some(isPersonWork)
  }

  /**
   * A worker that does not answer a ping in time is stuck, and only then is it restarted; `connectionId` names the
   * connection whose timeout asked, for the journal when the restart is put off.
   */
  private probe(connectionId?: string): Promise<void> {
    if (this.probing) return this.probing
    const worker = this.worker
    if (!worker) return Promise.resolve()
    const probe = new Promise<void>(resolve => {
      const requestId = ++this.sequence
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve()
        if (this.worker !== worker) return
        if (this.personSessionAtRisk()) {
          recordIncident('incident.oxequery.restartDeferred', connectionId)
          try { this.onFault?.('worker did not answer a ping; restart put off while a person session is at risk') } catch { /* logging must not decide */ }
          return
        }
        void this.reset('The database worker stopped responding and was restarted.')
      }, this.probeMs)
      this.pending.set(requestId, { resolve: () => resolve(), reject: () => resolve(), timer, budgetMs: this.probeMs, op: 'ping' })
      try { worker.postMessage({ requestId, op: 'ping' }) } catch { clearTimeout(timer); this.pending.delete(requestId); resolve() }
    })
    this.probing = probe
    void probe.finally(() => { if (this.probing === probe) this.probing = undefined })
    return probe
  }

  private async reset(reason: string): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    this.personAtRisk = 0
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new OxeQueryError('invalid', reason)) }
    this.pending.clear()
    await worker?.terminate().catch(() => undefined)
  }
}
