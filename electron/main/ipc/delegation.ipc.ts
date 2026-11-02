import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { DelegationService } from '../services/delegation.service'
import { parseId } from './validation'
export function registerDelegationIpc(service: DelegationService): void {
  ipcMain.handle(IPC_CHANNELS.delegation.create, (event, ws, origin, input) => service.createFromSurface(parseId(ws), origin, input))
  ipcMain.handle(IPC_CHANNELS.delegation.configureTarget, (event, ws, path, enabled, evidence) => service.configureTarget(parseId(ws), path, enabled, evidence))
  ipcMain.handle(IPC_CHANNELS.delegation.adopt, (event, ws, task, pane) => service.adopt(parseId(ws), parseId(task), parseId(pane)))
  ipcMain.handle(IPC_CHANNELS.delegation.status, (event, id, cursor, limit) => service.status(parseId(id), cursor, limit))
  ipcMain.handle(IPC_CHANNELS.delegation.preview, (event, id, objective, branchIntent) => service.preview(parseId(id), objective, branchIntent))
  ipcMain.handle(IPC_CHANNELS.delegation.configure, (event, id, enabled) => service.configure(parseId(id), enabled))
  ipcMain.handle(IPC_CHANNELS.delegation.control, (event, ws, task, action) => service.control(parseId(ws), parseId(task), action))
}
