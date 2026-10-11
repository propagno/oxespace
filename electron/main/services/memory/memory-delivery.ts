import type { AiMemoryClient } from './ai-memory.client'
import { MemoryOutbox, type MemoryOutboxRecord } from './memory-outbox'

const RESULTS = new Set(['stored', 'replayed', 'resumed', 'ignored_end', 'dropped_policy', 'dropped_subagent', 'dropped_unauthorized', 'dropped_collision', 'dropped_invalid'])
const STORED = new Set(['stored', 'replayed', 'resumed'])

export interface DeliveryStats { stored: number; replayed: number; dropped: number; failed: number; state: 'idle' | 'pending' | 'delivering' | 'failed' }

/** At most two sessions in flight; a session's items remain ordered in one batch. */
export class MemoryDeliveryWorker {
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushing: Promise<boolean> | undefined
  private stopped = false
  private wakePending = false
  private failures = 0
  private readonly retries = new Map<string, { failures: number; due: number; attempt: number }>()
  private attempt = 0
  private readonly counts: DeliveryStats = { stored: 0, replayed: 0, dropped: 0, failed: 0, state: 'idle' }
  constructor(private readonly outbox: MemoryOutbox, private readonly client: () => AiMemoryClient,
    private readonly eligible: (record: MemoryOutboxRecord) => boolean = () => true,
    private readonly now: () => number = Date.now) {}

  stats(): DeliveryStats { return { ...this.counts } }

  wake(): void {
    if (this.stopped) return
    if (this.flushing) { this.wakePending = true; return }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}) }, 0)
    this.timer.unref?.()
  }

  private schedule(delay: number): void {
    if (this.stopped || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => {}) }, Math.max(25, delay))
    this.timer.unref?.()
  }

  private backoff(failures: number): number {
    return Math.min(60_000, 1000 * 2 ** Math.min(failures - 1, 6) + Math.floor(Math.random() * 1000))
  }

  async flush(): Promise<boolean> {
    if (this.flushing) return this.flushing
    if (this.stopped) return false
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    const work = this.flushOnce().catch(() => {
      this.failures++
      this.counts.failed++
      this.counts.state = 'failed'
      this.schedule(this.backoff(this.failures))
      return false
    })
    this.flushing = work
    try { return await work }
    finally {
      this.flushing = undefined
      if (this.wakePending) { this.wakePending = false; this.wake() }
    }
  }

  private async flushOnce(): Promise<boolean> {
    const all = await this.outbox.pending()
    this.failures = 0
    const records = all.filter(this.eligible)
    const live = new Set(all.map(record => `${record.projectId}\0${record.sessionId}`))
    for (const key of this.retries.keys()) if (!live.has(key)) this.retries.delete(key)
    if (!records.length) { this.counts.state = all.length ? 'pending' : 'idle'; return false }
    this.counts.state = 'delivering'
    const bySession = new Map<string, MemoryOutboxRecord[]>()
    for (const record of records) {
      const key = `${record.projectId}\0${record.sessionId}`
      const batch = bySession.get(key) ?? []
      if (batch.length < 64) batch.push(record)
      bySession.set(key, batch)
    }
    const groups = [...bySession.entries()]
      .filter(([key]) => (this.retries.get(key)?.due ?? 0) <= this.now())
      .sort(([a], [b]) => (this.retries.get(a)?.attempt ?? 0) - (this.retries.get(b)?.attempt ?? 0))
      .slice(0, 2)
    const outcomes = await Promise.all(groups.map(async ([key, group]) => {
      const result = await this.deliver(group)
      const failures = result.complete ? 0 : (this.retries.get(key)?.failures ?? 0) + 1
      this.retries.set(key, { failures, due: this.now() + (failures ? this.backoff(failures) : 0), attempt: ++this.attempt })
      if (failures) this.counts.failed++
      return result.progress
    }))
    const progress = outcomes.some(Boolean)
    this.counts.state = [...bySession.keys()].some(key => this.retries.get(key)?.failures) ? 'failed' : 'pending'
    this.schedule(Math.min(...[...bySession.keys()].map(key => Math.max(25, (this.retries.get(key)?.due ?? 0) - this.now()))))
    return progress
  }

  private async deliver(batch: MemoryOutboxRecord[]): Promise<{ progress: boolean; complete: boolean }> {
    try {
      const { status, body } = await this.client().hookBatch(batch.map(row => row.item))
      if (status === 401 || status === 403) return { progress: false, complete: false }
      const result = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
      const explicit = Array.isArray(result.accepted_indices) ? result.accepted_indices : undefined
      const prefix = Number.isSafeInteger(result.accepted) ? Math.min(batch.length, Math.max(0, Number(result.accepted))) : 0
      const indices = explicit ?? Array.from({ length: prefix }, (_, index) => index)
      const acknowledged = new Set<number>()
      for (const value of indices) if (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < batch.length) acknowledged.add(Number(value))
      const outcomes = new Map<number, string>()
      if (Array.isArray(result.results)) for (const row of result.results) {
        if (!row || typeof row !== 'object') continue
        const value = row as { index?: unknown; outcome?: unknown }
        if (Number.isSafeInteger(value.index) && typeof value.outcome === 'string' && RESULTS.has(value.outcome)) outcomes.set(Number(value.index), value.outcome)
      }
      let progress = false
      const settled = new Set<number>()
      for (const index of [...acknowledged].sort((a, b) => a - b)) {
        const outcome = outcomes.get(index)
        // A malformed result must not turn a terminal failure into a false success.
        if (result.results !== undefined && !outcome) continue
        await this.outbox.settle(batch[index].key, outcome === 'dropped_collision' || outcome === 'dropped_invalid' ? 'quarantine' : 'ack')
        settled.add(index)
        if (outcome === 'replayed' || outcome === 'resumed') this.counts.replayed++
        else if (outcome && !STORED.has(outcome)) this.counts.dropped++
        else this.counts.stored++
        progress = true
      }
      if ([400, 422].includes(status) && Number.isSafeInteger(result.failed_index)) {
        const failed = Number(result.failed_index)
        if (failed >= 0 && failed < batch.length && !settled.has(failed)) {
          await this.outbox.settle(batch[failed].key, 'quarantine')
          this.counts.dropped++
          settled.add(failed)
          progress = true
        }
      }
      return { progress, complete: settled.size === batch.length && status >= 200 && status < 300 }
    } catch { return { progress: false, complete: false } }
  }

  async stop(timeoutMs = 1500): Promise<void> {
    this.stopped = true
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (this.flushing) await Promise.race([this.flushing.catch(() => false), new Promise(resolve => setTimeout(resolve, timeoutMs))])
  }
}
