import { app, BrowserWindow, ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import type { MainMessage } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { RemoteChange } from '../../../shared/types/remote'
import type { RemoteAgentStateHost, RemoteTerminalHost, RemoteThreadHost } from '../services/remote/desktop'
import type { RemoteGateway } from '../services/remote/gateway'
import { parseNoInput } from '../services/remote/inputs'

/**
 * Settings › Devices (B9). Every channel is the person's own action, accepted only from the app's main frame (the IPC sender guard); none is
 * an MCP tool. The gateway module loads on the first call, so a person who never opens Settings › Devices never loads
 * it, and it starts off on every launch. `hosts` are what phones may watch and do (M4, M5); the gateway gets only
 * the narrow view of them in `services/remote/desktop`.
 */
export function registerRemoteIpc(db: AppDatabase, hosts?: { threads: Promise<RemoteThreadHost>; terminals: RemoteTerminalHost; agentState: RemoteAgentStateHost }): void {
  let gateway: Promise<RemoteGateway> | null = null
  const send = (channel: string, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
  const broadcast = (change: RemoteChange) => send(IPC_CHANNELS.remote.changed, change)
  const pairingFailed = (message: MainMessage) => send(IPC_CHANNELS.remote.pairingFailed, message)
  const load = () => gateway ??= Promise.all([import('../services/remote/gateway'), import('../services/remote/desktop'), hosts?.threads]).then(([{ RemoteGateway }, { createRemoteDesktop }, threads]) =>
    new RemoteGateway({ db, storage: safeStorage, broadcast, pairingFailed, ...(hosts && threads ? { desktop: createRemoteDesktop({ db, threads, terminals: hosts.terminals, agentState: hosts.agentState }) } : {}) }))
  const handle = (channel: string, run: (gateway: RemoteGateway, input: unknown) => unknown) => {
    ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, input: unknown) => {
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
  handle(IPC_CHANNELS.remote.setPhoneWrite, (gateway, input) => gateway.setPhoneWrite(input))

  app.on('before-quit', () => { void gateway?.then(loaded => loaded.stop()) })
}
