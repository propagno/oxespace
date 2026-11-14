import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { emptyContextUsage, type ContextUsageInput } from '../../../shared/types/contextUsage'
import { ContextUsageService } from '../services/contextUsage'
import { parseRecord, parseText, parseToken } from './ipc-guards'

/** The agent session a pane is in now for that provider, or null when none is known. */
export type PaneSessionLookup = (paneId: string, provider: ContextUsageInput['provider']) => string | null

/**
 * Renderer-facing IPC for the live context-window % chip.
 *   - `context-usage:get` — current `/context` fill for a pane's provider.
 *
 * A7: with a `paneId`, the figure is that pane's own agent session (`sessionOf`), never the newest session of the
 * folder; a pane with no known session of that provider shows nothing. Without a `paneId` it reads as before.
 */
export function registerContextUsageIpc(service = new ContextUsageService(), sessionOf?: PaneSessionLookup): ContextUsageService {
  ipcMain.handle(IPC_CHANNELS.contextUsage.get, (_event, value: unknown) => {
    const input = parseRecord(value, 'Context usage request')
    const rootPath = parseText(input.workspaceRootPath, 'Workspace root', 4096)
    if (!rootPath) throw new Error('Workspace root must not be empty')
    const provider = parseToken(input.provider, 'Provider', 40) as ContextUsageInput['provider']
    if (input.paneId !== undefined && input.paneId !== null) {
      const paneId = parseToken(input.paneId, 'Pane id', 400)
      const own = sessionOf ? sessionOf(paneId, provider) : null
      return own ? service.get(provider, rootPath, own) : emptyContextUsage(provider)
    }
    const sessionId = input.sessionId === undefined || input.sessionId === null ? input.sessionId : parseToken(input.sessionId, 'Session id')
    return service.get(provider, rootPath, sessionId)
  })
  return service
}
