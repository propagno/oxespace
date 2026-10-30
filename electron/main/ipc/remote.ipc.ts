import { app, BrowserWindow, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { RemoteChange } from '../../../shared/types/remote'
import type { RemoteGateway } from '../services/remote/gateway'
import { parseNoInput } from '../services/remote/inputs'
import { requireAppFrame } from './ipc-guards'

/**
 * Settings › Devices (B9). Every channel is the person's own action, accepted only from the app's main frame; none is
 * an MCP tool. The gateway module loads on the first call, so a person who never opens Settings › Devices never loads
 * it, and it starts off on every launch.
 */
export function registerRemoteIpc(db: AppDatabase): void {
  let gateway: Promise<RemoteGateway> | null = null
  const broadcast = (change: RemoteChange) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.remote.changed, change)
  }
  const load = () => gateway ??= import('../services/remote/gateway').then(({ RemoteGateway }) => new RemoteGateway({ db, storage: safeStorage, broadcast }))
  const handle = (channel: string, run: (gateway: RemoteGateway, input: unknown) => unknown) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, input: unknown) => {
      requireAppFrame(event, 'Remote devices')
      return run(await load(), input)
    })
  }
  const noInput = (run: (gateway: RemoteGateway) => unknown) => (gateway: RemoteGateway, input: unknown) => { parseNoInput(input); return run(gateway) }

  handle(IPC_CHANNELS.remote.status, noInput(gateway => gateway.status()))
  handle(IPC_CHANNELS.remote.devices, noInput(gateway => gateway.devices()))
  handle(IPC_CHANNELS.remote.setEnabled, (gateway, input) => gateway.setEnabled(input))
  handle(IPC_CHANNELS.remote.startPairing, noInput(gateway => gateway.startPairing()))
  handle(IPC_CHANNELS.remote.cancelPairing, noInput(gateway => gateway.cancelPairing()))
  handle(IPC_CHANNELS.remote.answerPairing, (gateway, input) => gateway.answerPairing(input))
  handle(IPC_CHANNELS.remote.revoke, (gateway, input) => gateway.revoke(input))
  handle(IPC_CHANNELS.remote.rename, (gateway, input) => gateway.rename(input))
  handle(IPC_CHANNELS.remote.setDesktopName, (gateway, input) => gateway.setDesktopName(input))

  app.on('before-quit', () => { void gateway?.then(loaded => loaded.stop()) })
}
