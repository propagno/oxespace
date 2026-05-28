import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { buildPaneManifest, type OxeContextDeps } from '../services/oxe-context.service'

/**
 * Renderer-facing IPC for the OXESpace context manifest. TerminalPane
 * calls `buildPaneManifest` at pane spawn and prepends the result to the
 * agent's initial prompt — so the agent reads the workspace state on its
 * very first turn without needing to call any MCP tools.
 */
export function registerOxeContextIpc(deps: OxeContextDeps): void {
  ipcMain.handle(IPC_CHANNELS.oxeContext.buildPaneManifest, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') return ''
    const record = input as Record<string, unknown>
    const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : ''
    const paneId = typeof record.paneId === 'string' ? record.paneId : ''
    if (!workspaceId || !paneId) return ''
    try {
      return await buildPaneManifest(deps, { workspaceId, paneId })
    } catch (err) {
      // Manifest is a best-effort enhancement — failures must not block the
      // pane from starting. Returning empty string causes the resolver in
      // TerminalPane.tsx to fall through to the prompt without prefix.
      // eslint-disable-next-line no-console
      console.warn('[oxe-context] buildPaneManifest failed:', err instanceof Error ? err.message : err)
      return ''
    }
  })
}
