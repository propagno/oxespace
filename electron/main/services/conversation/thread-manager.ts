import { ThreadOrchestrator } from './thread-orchestrator'
import { coordinatorIds, setThreadCoordinator, withCoordinator } from './thread-coordinator'
import type { ConversationThread, ThreadDelta, ThreadSnapshot, ThreadSyncCursor } from '../../../../shared/types/thread'

/**
 * Stable public boundary for Thread IPC/runtime consumers. Runtime coordination
 * lives in ThreadOrchestrator; persistence, requests, sessions, exports,
 * portable packages and checkpoints are separate services behind it.
 *
 * The coordinator flag (B1.4) lives in its own table, so the threads served to
 * the window carry it as the table says; it is never stored in a thread's data.
 */
export class ThreadManager extends ThreadOrchestrator {
  override list(): ConversationThread[] {
    const ids = coordinatorIds(this.db)
    return super.list().map(thread => withCoordinator(thread, ids))
  }

  override readForRenderer(id: string): ThreadSnapshot {
    const window = super.readForRenderer(id)
    return { ...window, thread: withCoordinator(window.thread, coordinatorIds(this.db)) }
  }

  override readSinceForRenderer(id: string, cursor: ThreadSyncCursor): ThreadDelta {
    const delta = super.readSinceForRenderer(id, cursor)
    return delta.ok ? { ...delta, thread: withCoordinator(delta.thread, coordinatorIds(this.db)) } : delta
  }

  /** The person's choice only (`thread:set-coordinator`); never an MCP tool. Another conversation of the project stops being it. */
  setCoordinator(id: string, coordinator: boolean): void {
    for (const changed of setThreadCoordinator(this.db, id, coordinator)) this.changed(changed)
  }
}
