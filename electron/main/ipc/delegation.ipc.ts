import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { DelegationService } from '../services/delegation.service'
import { parseId } from './validation'
export function registerDelegationIpc(service: DelegationService): void {
  const sender = (event: IpcMainInvokeEvent) => {
    if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Delegation requires the application main frame')
  }
  ipcMain.handle(IPC_CHANNELS.delegation.create, (event, ws, origin, input) => { sender(event); return service.createFromSurface(parseId(ws), origin, input) })
  ipcMain.handle(IPC_CHANNELS.delegation.configureTarget, (event, ws, path, enabled, evidence) => { sender(event); return service.configureTarget(parseId(ws), path, enabled, evidence) })
  ipcMain.handle(IPC_CHANNELS.delegation.adopt, (event, ws, task, pane) => { sender(event); return service.adopt(parseId(ws), parseId(task), parseId(pane)) })
  ipcMain.handle(IPC_CHANNELS.delegation.status, (event, id, cursor, limit) => { sender(event); return service.status(parseId(id), cursor, limit) })
  ipcMain.handle(IPC_CHANNELS.delegation.preview, (event, id, objective, branchIntent) => { sender(event); return service.preview(parseId(id), objective, branchIntent) })
  ipcMain.handle(IPC_CHANNELS.delegation.configure, (event, id, enabled) => { sender(event); return service.configure(parseId(id), enabled) })
  ipcMain.handle(IPC_CHANNELS.delegation.control, (event, ws, task, action) => { sender(event); return service.control(parseId(ws), parseId(task), action) })
}
