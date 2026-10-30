import { app, BrowserWindow, ipcMain, net } from 'electron'
import { release } from 'node:os'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { requireAppFrame } from './ipc-guards'

/** `app:connectivity` (+ `app:connectivity-changed`) and `app:about`. The module behind them loads on first use. */
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
    const { aboutFacts } = await service()
    return aboutFacts({ version: app.getVersion(), packaged: app.isPackaged, versions: process.versions, platform: process.platform, arch: process.arch, osRelease: release() })
  })
  return () => watcher?.stop()
}
