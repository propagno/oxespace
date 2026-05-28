import { EventEmitter } from 'node:events'
import type { InternalMcpWorktreeChangedEvent } from '../../../shared/types/mcp-internal'

/**
 * Minimal in-memory bus that the `oxespace_create_worktree` /
 * `oxespace_remove_worktree` tools write to after a successful git mutation.
 * The renderer subscribes via IPC and re-fetches the affected workspace's
 * worktrees so the panel + sidebar badge track the agent's action live.
 * No persistence — fire-and-forget, mirroring WebPreviewBus.
 */
export class WorktreeEventBus extends EventEmitter {
  emitChanged(event: InternalMcpWorktreeChangedEvent): void {
    this.emit('changed', event)
  }

  subscribe(listener: (event: InternalMcpWorktreeChangedEvent) => void): () => void {
    this.on('changed', listener)
    return () => { this.off('changed', listener) }
  }
}
