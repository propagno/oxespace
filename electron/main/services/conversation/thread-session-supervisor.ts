import type { ThreadConnectionStatus } from '../../../../shared/types/thread'

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const CIRCUIT_THRESHOLD = 5

/** Pure connection state machine. It never replays provider work by itself. */
export class ThreadSessionSupervisor {
  private readonly states = new Map<string, ThreadConnectionStatus>()

  begin(threadId: string, now = Date.now()): ThreadConnectionStatus {
    const previous = this.states.get(threadId)
    const attempt = previous?.state === 'degraded' || previous?.state === 'reconnecting' ? previous.attempt + 1 : 1
    return this.set(threadId, { state: attempt > 1 ? 'reconnecting' : 'starting', attempt, changedAt: now })
  }

  connected(threadId: string, now = Date.now()): ThreadConnectionStatus {
    return this.set(threadId, { state: 'connected', attempt: 0, changedAt: now, lastHeartbeatAt: now })
  }

  heartbeat(threadId: string, now = Date.now()): ThreadConnectionStatus {
    const previous = this.states.get(threadId)
    return this.set(threadId, { state: 'connected', attempt: 0, changedAt: previous?.changedAt ?? now, lastHeartbeatAt: now, lastNativeSignalAt: previous?.lastNativeSignalAt })
  }

  nativeSignal(threadId: string, at: number): ThreadConnectionStatus {
    const previous = this.states.get(threadId)
    return this.set(threadId, { state: previous?.state ?? 'connected', attempt: previous?.attempt ?? 0,
      changedAt: previous?.changedAt ?? at, lastHeartbeatAt: previous?.lastHeartbeatAt,
      lastNativeSignalAt: at })
  }

  failed(threadId: string, detail: string, now = Date.now()): ThreadConnectionStatus {
    const attempt = Math.max(1, this.states.get(threadId)?.attempt ?? 1)
    // Stable per-thread jitter prevents reconnect herds while keeping fault
    // tests and diagnostics reproducible for the same conversation.
    const hash = [...threadId].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, attempt)
    const jitter = .85 + (hash % 31) / 100
    const backoff = Math.round(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt - 1, 5)) * jitter)
    return this.set(threadId, { state: 'degraded', attempt, changedAt: now, nextRetryAt: now + backoff, detail: detail.slice(0, 500) })
  }

  close(threadId: string, now = Date.now()): ThreadConnectionStatus {
    return this.set(threadId, { state: 'closed', attempt: 0, changedAt: now })
  }

  canAttempt(threadId: string, now = Date.now()): boolean {
    const state = this.states.get(threadId)
    if (!state || state.state !== 'degraded') return true
    if (state.attempt < CIRCUIT_THRESHOLD) return true
    return (state.nextRetryAt ?? 0) <= now
  }

  get(threadId: string): ThreadConnectionStatus | undefined {
    return this.states.get(threadId)
  }

  restore(threadId: string, state: ThreadConnectionStatus): void {
    this.states.set(threadId, { ...state })
  }

  private set(threadId: string, state: ThreadConnectionStatus): ThreadConnectionStatus {
    this.states.set(threadId, state)
    return state
  }
}
