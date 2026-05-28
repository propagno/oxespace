import { EventEmitter } from 'node:events'
import type { InternalMcpWebPreviewEvent } from '../../../shared/types/mcp-internal'

/**
 * Minimal in-memory bus that the `oxespace_open_web_preview` tool writes to.
 * Renderer subscribes via IPC and the matching workspace's WebPreview panel
 * updates its URL. No persistence — events are fire-and-forget. The bridge
 * is per-workspace so the workspaceId in the event is always the bridge's
 * own scope; cross-workspace previews aren't possible in v1.
 */
export class WebPreviewBus extends EventEmitter {
  emitPreview(event: InternalMcpWebPreviewEvent): void {
    this.emit('preview', event)
  }

  subscribe(listener: (event: InternalMcpWebPreviewEvent) => void): () => void {
    this.on('preview', listener)
    return () => { this.off('preview', listener) }
  }
}
