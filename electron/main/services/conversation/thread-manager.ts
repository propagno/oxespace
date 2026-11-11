import { ThreadOrchestrator } from './thread-orchestrator'

/**
 * Stable public boundary for Thread IPC/runtime consumers. Runtime coordination
 * lives in ThreadOrchestrator; persistence, requests, sessions, exports,
 * portable packages and checkpoints are separate services behind it.
 */
export class ThreadManager extends ThreadOrchestrator {
  /** CR-F4-7b: a place added, or a drift seen or answered, per conversation; '*' hears every one (see ThreadPlaceObserver). */
  subscribePlaces = (id: string, listener: (id: string) => void): (() => void) => this.placeObserver.subscribePlaces(id, listener)
}
