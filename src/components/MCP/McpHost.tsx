import { chunk, lazyFrom } from '../../lib/chunk'

// The MCP servers dialog's chunk. Rendered through lazyFrom, so once the chunk has arrived the dialog opens in the
// same commit: a plain React.lazy holds its Suspense fallback ~300 ms on the first open even when the module is
// already loaded (OXE-39). App preloads it after first paint; the MCP button preloads it on hover/focus.
export const MCP_PANEL_CHUNK = chunk(() => import('./McpPanel'))

/** McpPanel, same props, rendered from MCP_PANEL_CHUNK. */
export const McpPanelHost = lazyFrom(MCP_PANEL_CHUNK, m => m.McpPanel)

/** Starts loading the dialog's chunk; a failed load is retried on the next call. */
export function preloadMcpPanel(): void {
  void MCP_PANEL_CHUNK.load().catch(() => undefined)
}
