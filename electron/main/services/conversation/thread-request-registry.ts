import type { ThreadRequest, ThreadRequestResponse } from '../../../../shared/types/thread'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'

interface PendingEntry {
  request: ThreadRequest
  respond: (response: ThreadRequestResponse) => Promise<void>
  onExpire?: (request: ThreadRequest) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Owns the lifetime of provider requests. A renderer response is accepted only
 * for the same Thread generation and exactly once.
 */
export class ThreadRequestRegistry {
  private readonly pending = new Map<string, Map<string, PendingEntry>>()

  register(threadId: string, request: ThreadRequest, respond: PendingEntry['respond'], onExpire?: PendingEntry['onExpire']): void {
    if (request.state !== 'pending' || request.generation < 0) throw Error('Invalid pending request')
    const requests = this.pending.get(threadId) ?? new Map<string, PendingEntry>()
    if (requests.has(request.id)) throw Error('Duplicate pending request')
    const entry: PendingEntry = { request: { ...request, threadId }, respond, onExpire }
    if (request.expiresAt !== undefined && request.expiresAt - Date.now() <= 2_147_483_647) {
      const delay = Math.max(0, request.expiresAt - Date.now())
      entry.timer = setTimeout(() => this.expire(threadId), delay)
      entry.timer.unref?.()
    }
    requests.set(request.id, entry)
    this.pending.set(threadId, requests)
  }

  list(threadId: string, generation?: number): ThreadRequest[] {
    this.expire(threadId)
    return [...(this.pending.get(threadId)?.values() ?? [])]
      .map(entry => entry.request)
      .filter(request => generation === undefined || request.generation === generation)
  }

  async resolve(threadId: string, requestId: string, generation: number, response: ThreadRequestResponse): Promise<ThreadRequest> {
    this.expire(threadId)
    const requests = this.pending.get(threadId)
    const entry = requests?.get(requestId)
    if (!entry || entry.request.state !== 'pending') throw Error('Request is no longer pending')
    if (entry.request.generation !== generation) throw Error('Request belongs to an older conversation generation')
    if (entry.request.kind === 'question' && !['decline', 'cancel'].includes(response.decision ?? '')) {
      const questions = entry.request.questions ?? []
      if (!questions.length || questions.some(question => !response.answers?.[question.id]?.some(value => value.trim()))) throw Error('Answer every question before continuing')
    }
    requests!.delete(requestId)
    if (entry.timer) clearTimeout(entry.timer)
    if (requests!.size === 0) this.pending.delete(threadId)
    try {
      await entry.respond(response)
      Object.assign(entry.request, requestOutcome(entry.request.kind, response), { resolvedAt: Date.now() })
    } catch (error) {
      if (entry.request.expiresAt === undefined || entry.request.expiresAt > Date.now()) {
        if (entry.request.expiresAt !== undefined && entry.request.expiresAt - Date.now() <= 2_147_483_647) {
          entry.timer = setTimeout(() => this.expire(threadId), Math.max(0, entry.request.expiresAt - Date.now()))
          entry.timer.unref?.()
        }
        requests!.set(requestId, entry)
      } else entry.onExpire?.({ ...entry.request, state: 'expired', resolution: 'unknown', resolvedAt: Date.now() })
      this.pending.set(threadId, requests!)
      throw error
    }
    return entry.request
  }

  settle(threadId: string, requestId: string, state: 'resolved' | 'cancelled' | 'expired' = 'resolved'): ThreadRequest | undefined {
    const requests = this.pending.get(threadId)
    const entry = requests?.get(requestId)
    if (!entry) return undefined
    entry.request.state = state
    entry.request.resolvedAt = Date.now()
    if (entry.timer) clearTimeout(entry.timer)
    requests!.delete(requestId)
    if (requests!.size === 0) this.pending.delete(threadId)
    return entry.request
  }

  invalidate(threadId: string, state: 'cancelled' | 'expired' = 'cancelled'): ThreadRequest[] {
    const requests = this.pending.get(threadId)
    if (!requests) return []
    this.pending.delete(threadId)
    return [...requests.values()].map(entry => { if (entry.timer) clearTimeout(entry.timer); return { ...entry.request, state, resolvedAt: Date.now() } })
  }

  private expire(threadId: string): void {
    const requests = this.pending.get(threadId)
    if (!requests) return
    const now = Date.now()
    for (const [id, entry] of requests) if (entry.request.expiresAt !== undefined && entry.request.expiresAt <= now) {
      entry.request.state = 'expired'
      entry.request.resolvedAt = now
      entry.request.resolution = 'unknown'
      if (entry.timer) clearTimeout(entry.timer)
      requests.delete(id)
      entry.onExpire?.(entry.request)
    }
    if (requests.size === 0) this.pending.delete(threadId)
  }
}
