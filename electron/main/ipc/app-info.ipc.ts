import { app, BrowserWindow, ipcMain, net } from 'electron'
import { release } from 'node:os'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { openExternalOrRecord } from '../utils/external-open'

/**
 * `app:connectivity` (+ `app:connectivity-changed`), `app:about` and `app:open-external`. The module behind the first two
 * loads on first use.
 */
export function registerAppInfoIpc(): () => void {
  let watcher: import('../services/app-info').ConnectivityWatcher | undefined
  const service = () => import('../services/app-info')
  ipcMain.handle(IPC_CHANNELS.app.connectivity, async event => {
    const { ConnectivityWatcher } = await service()
    watcher ??= new ConnectivityWatcher(() => net.isOnline(), state => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.app.onConnectivity, state)
    })
    return watcher.read()
  })
  ipcMain.handle(IPC_CHANNELS.app.about, async event => {
    const { aboutFacts, APP_VERSION } = await service()
    return aboutFacts({ version: APP_VERSION, packaged: app.isPackaged, versions: process.versions, platform: process.platform, arch: process.arch, osRelease: release() })
  })
  // The main window's only way to open a link outside the app, called once the person confirmed its host. Its main
  // frame only, through the central sender guard (B12). The URL is checked by the same rule and per-minute budget as
  // every other link: a refusal is journalled by its reason, never the URL.
  ipcMain.handle(IPC_CHANNELS.app.openExternal, (_event, url: unknown): { opened: boolean } => ({ opened: openExternalOrRecord(url) }))
  return () => watcher?.stop()
}
