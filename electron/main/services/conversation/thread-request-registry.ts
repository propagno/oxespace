import type { ThreadRequest, ThreadRequestResponse } from '../../../../shared/types/thread'

interface PendingEntry {
  request: ThreadRequest
  respond: (response: ThreadRequestResponse) => Promise<void>
}

/**
 * Owns the lifetime of provider requests. A renderer response is accepted only
 * for the same Thread generation and exactly once.
 */
export class ThreadRequestRegistry {
  private readonly pending = new Map<string, Map<string, PendingEntry>>()

  register(threadId: string, request: ThreadRequest, respond: PendingEntry['respond']): void {
    if (request.state !== 'pending' || request.generation < 0) throw Error('Invalid pending request')
    const requests = this.pending.get(threadId) ?? new Map<string, PendingEntry>()
    if (requests.has(request.id)) throw Error('Duplicate pending request')
    requests.set(request.id, { request: { ...request, threadId }, respond })
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
    requests!.delete(requestId)
    if (requests!.size === 0) this.pending.delete(threadId)
    try {
      await entry.respond(response)
      entry.request.state = 'resolved'
    } catch (error) {
      requests!.set(requestId, entry)
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
    requests!.delete(requestId)
    if (requests!.size === 0) this.pending.delete(threadId)
    return entry.request
  }

  invalidate(threadId: string, state: 'cancelled' | 'expired' = 'cancelled'): ThreadRequest[] {
    const requests = this.pending.get(threadId)
    if (!requests) return []
    this.pending.delete(threadId)
    return [...requests.values()].map(entry => ({ ...entry.request, state }))
  }

  private expire(threadId: string): void {
    const requests = this.pending.get(threadId)
    if (!requests) return
    const now = Date.now()
    for (const [id, entry] of requests) if (entry.request.expiresAt !== undefined && entry.request.expiresAt <= now) {
      entry.request.state = 'expired'
      requests.delete(id)
    }
    if (requests.size === 0) this.pending.delete(threadId)
  }
}
