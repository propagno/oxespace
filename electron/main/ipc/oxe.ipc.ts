import { BrowserWindow, ipcMain } from 'electron'
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
export function registerOxeIpc(): OxeService {
  const broadcast = (rootPath: string): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.oxe.onEventsChanged, { rootPath })
    }
  }
  const service = new OxeService(broadcast)

  ipcMain.handle(IPC_CHANNELS.oxe.detect, (_e, force?: boolean) => service.detect(force === true))
  ipcMain.handle(IPC_CHANNELS.oxe.status, (_e, rootPath: string, force?: boolean) => service.status(rootPath, force === true))
  ipcMain.handle(IPC_CHANNELS.oxe.statusSummary, (_e, rootPath: string, force?: boolean) => service.statusSummary(rootPath, force === true))
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, (_e, rootPath: string) => service.openDashboard(rootPath))
  ipcMain.handle(IPC_CHANNELS.oxe.startDashboard, (_e, rootPath: string) => service.startDashboard(rootPath))
  ipcMain.handle(IPC_CHANNELS.oxe.stopDashboard, (_e, rootPath: string) => service.stopDashboard(rootPath))
  ipcMain.handle(IPC_CHANNELS.oxe.watchEvents, (_e, rootPath: string) => service.watchEvents(rootPath))
  ipcMain.handle(IPC_CHANNELS.oxe.unwatchEvents, (_e, rootPath: string) => service.unwatchEvents(rootPath))

  return service
}
