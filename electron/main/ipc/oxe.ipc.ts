import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { parseDirectory, parseOptionalBoolean } from './ipc-guards'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { OxeService } from '../services/oxe.service'

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

export function registerOxeIpc(service = new OxeService(broadcastOxeEvents)): OxeService {

  // Every handler below runs the oxe CLI or a dashboard server with the project root as its working directory.
  const root = (_event: IpcMainInvokeEvent, value: unknown): string => parseDirectory(value)
  ipcMain.handle(IPC_CHANNELS.oxe.detect, (event, force?: unknown) => service.detect(parseOptionalBoolean(force)))
  ipcMain.handle(IPC_CHANNELS.oxe.status, (event, rootPath: unknown, force?: unknown) => service.status(root(event, rootPath), parseOptionalBoolean(force)))
  ipcMain.handle(IPC_CHANNELS.oxe.statusSummary, (event, rootPath: unknown, force?: unknown) => service.statusSummary(root(event, rootPath), parseOptionalBoolean(force)))
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, (event, rootPath: unknown) => service.openDashboard(root(event, rootPath)))
  ipcMain.handle(IPC_CHANNELS.oxe.startDashboard, (event, rootPath: unknown) => service.startDashboard(root(event, rootPath)))
  ipcMain.handle(IPC_CHANNELS.oxe.stopDashboard, (event, rootPath: unknown) => { if (typeof rootPath !== 'string') throw new Error('rootPath must be a string'); return service.stopDashboard(rootPath) })
  ipcMain.handle(IPC_CHANNELS.oxe.watchEvents, (event, rootPath: unknown) => service.watchEvents(root(event, rootPath)))
  ipcMain.handle(IPC_CHANNELS.oxe.unwatchEvents, (event, rootPath: unknown) => { if (typeof rootPath !== 'string') throw new Error('rootPath must be a string'); return service.unwatchEvents(rootPath) })

  return service
}
