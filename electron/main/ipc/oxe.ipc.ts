import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { parseDirectory, parseOptionalBoolean } from './ipc-guards'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { OxeService } from '../services/oxe.service'

/**
 * Renderer-facing IPC for the native OXE (oxe-cc) integration.
 *   - `oxe:detect`          — is oxe-cc installed? which version?
 *   - `oxe:status`          — full `oxe status --json` (detailed view).
 *   - `oxe:status-summary`  — cheap `status --json --summary` (hot path).
 *   - `oxe:open-dashboard`  — open the dashboard in the external browser (legacy).
 *   - `oxe:start/stop-dashboard` — embedded dashboard server lifecycle.
 *   - `oxe:watch/unwatch-events` — watch .oxe/ and push `oxe:on-events-changed`.
 *
 * Returns the service so the app can `disposeAll()` on quit.
 */
function broadcastOxeEvents(rootPath: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.oxe.onEventsChanged, { rootPath })
  }
}

/** The oxe-cc runner loads with the first OXE request; a launch that never opens an OXE project never loads it. */
async function createOxeService(): Promise<OxeService> {
  const { OxeService } = await import('../services/oxe.service')
  return new OxeService(broadcastOxeEvents)
}

/** What the app keeps of the service: tearing it down on quit, which is a no-op while it was never loaded. */
export interface OxeIpcHandle { disposeAll(): void }

export function registerOxeIpc(load: () => Promise<OxeService> = createOxeService): OxeIpcHandle {
  let loaded: OxeService | null = null
  let pending: Promise<OxeService> | null = null
  const service = (): Promise<OxeService> => (pending ??= load().then(value => (loaded = value), error => { pending = null; throw error }))

  // Every handler below runs the oxe CLI or a dashboard server with the project root as its working directory.
  const root = (_event: IpcMainInvokeEvent, value: unknown): string => parseDirectory(value)
  const path = (_event: IpcMainInvokeEvent, value: unknown): string => { if (typeof value !== 'string') throw new Error('rootPath must be a string'); return value }
  ipcMain.handle(IPC_CHANNELS.oxe.detect, async (event, force?: unknown) => { const refresh = parseOptionalBoolean(force); return (await service()).detect(refresh) })
  ipcMain.handle(IPC_CHANNELS.oxe.status, async (event, rootPath: unknown, force?: unknown) => { const dir = root(event, rootPath); const refresh = parseOptionalBoolean(force); return (await service()).status(dir, refresh) })
  ipcMain.handle(IPC_CHANNELS.oxe.statusSummary, async (event, rootPath: unknown, force?: unknown) => { const dir = root(event, rootPath); const refresh = parseOptionalBoolean(force); return (await service()).statusSummary(dir, refresh) })
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, async (event, rootPath: unknown) => { const dir = root(event, rootPath); return (await service()).openDashboard(dir) })
  ipcMain.handle(IPC_CHANNELS.oxe.startDashboard, async (event, rootPath: unknown) => { const dir = root(event, rootPath); return (await service()).startDashboard(dir) })
  ipcMain.handle(IPC_CHANNELS.oxe.stopDashboard, async (event, rootPath: unknown) => { const dir = path(event, rootPath); return (await service()).stopDashboard(dir) })
  ipcMain.handle(IPC_CHANNELS.oxe.watchEvents, async (event, rootPath: unknown) => { const dir = root(event, rootPath); return (await service()).watchEvents(dir) })
  ipcMain.handle(IPC_CHANNELS.oxe.unwatchEvents, async (event, rootPath: unknown) => { const dir = path(event, rootPath); return (await service()).unwatchEvents(dir) })

  return { disposeAll: () => loaded?.disposeAll() }
}
