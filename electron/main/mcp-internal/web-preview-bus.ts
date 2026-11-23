import { EventEmitter } from 'node:events'
import type { InternalMcpWebPreviewEvent } from '../../../shared/types/mcp-internal'

/** Where an owner's page is in its load; null when the owner's preview is not on that URL. Never what the page holds. */
export type PreviewLoadState = 'loaded' | 'failed' | 'loading' | null
type PreviewLoadProbe = (ownerKey: string, url: string) => PreviewLoadState | Promise<PreviewLoadState>

/** How long the tool waits for the page. The bridge gives oxespace_open_web_preview 10 s in all. */
export const PREVIEW_LOAD_WAIT_MS = 8_000
const POLL_MS = 150
/** A failure already there when the wait starts may be the last attempt's: the window gets this long to start again. */
const STALE_FAILURE_MS = 750

/**
 * Minimal in-memory bus that the `oxespace_open_web_preview` tool writes to.
 * Renderer subscribes via IPC and the matching workspace's WebPreview panel
 * updates its URL. No persistence — events are fire-and-forget; `confirmLoad`
 * asks the probe afterwards whether the page got there. The bridge
 * is per-workspace so the workspaceId in the event is always the bridge's
 * own scope; cross-workspace previews aren't possible in v1.
 */
export class WebPreviewBus extends EventEmitter {
  constructor(private readonly probe?: PreviewLoadProbe) {
    super()
  }

  emitPreview(event: InternalMcpWebPreviewEvent): void {
    this.emit('preview', event)
  }

  /** Waits until the owner's page loaded or failed. Without a probe nothing can be confirmed, so it does not wait. */
  async confirmLoad(ownerKey: string, url: string, timeoutMs = PREVIEW_LOAD_WAIT_MS): Promise<'loaded' | 'failed' | 'timeout'> {
    if (!this.probe) return 'timeout'
    const startedAt = Date.now()
    let attemptSeen = false
    for (;;) {
      let state: PreviewLoadState
      // A probe that cannot answer confirms nothing: the page stays queued.
      try { state = await this.probe(ownerKey, url) } catch { return 'timeout' }
      if (state === 'loaded') return 'loaded'
      const waited = Date.now() - startedAt
      if (state === 'failed') {
        if (attemptSeen || waited >= STALE_FAILURE_MS || waited >= timeoutMs) return 'failed'
      } else {
        attemptSeen = true
        if (waited >= timeoutMs) return 'timeout'
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(POLL_MS, timeoutMs - waited)))
    }
  }

  subscribe(listener: (event: InternalMcpWebPreviewEvent) => void): () => void {
    this.on('preview', listener)
    return () => { this.off('preview', listener) }
  }
}
