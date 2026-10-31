import { app, BrowserWindow, ipcMain, net } from 'electron'
import { release } from 'node:os'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { requireAppFrame } from './ipc-guards'
import { openExternalOrRecord } from '../utils/external-open'

/**
 * `app:connectivity` (+ `app:connectivity-changed`), `app:about` and `app:open-external`. The module behind the first two
 * loads on first use.
 */
export function registerAppInfoIpc(): () => void {
  let watcher: import('../services/app-info').ConnectivityWatcher | undefined
  const service = () => import('../services/app-info')
  ipcMain.handle(IPC_CHANNELS.app.connectivity, async event => {
    requireAppFrame(event, 'Connectivity')
    const { ConnectivityWatcher } = await service()
    watcher ??= new ConnectivityWatcher(() => net.isOnline(), state => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.app.onConnectivity, state)
    })
    return watcher.read()
  })
  ipcMain.handle(IPC_CHANNELS.app.about, async event => {
    requireAppFrame(event, 'About')
    const { aboutFacts, APP_VERSION } = await service()
    return aboutFacts({ version: APP_VERSION, packaged: app.isPackaged, versions: process.versions, platform: process.platform, arch: process.arch, osRelease: release() })
  })
  // The main window's only way to open a link outside the app, called once the person confirmed its host. Its main
  // frame only (requireAppFrame; B12 centralises the sender check). The URL is checked by the same rule and per-minute
  // budget as every other link: a refusal is journalled by its reason, never the URL.
  ipcMain.handle(IPC_CHANNELS.app.openExternal, (event, url: unknown): { opened: boolean } => {
    requireAppFrame(event, 'Opening a link')
    return { opened: openExternalOrRecord(url) }
  })
  return () => watcher?.stop()
}
