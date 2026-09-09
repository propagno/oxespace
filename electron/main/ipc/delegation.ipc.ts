import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { DelegationService } from '../services/delegation.service'
import { parseId } from './validation'
export function registerDelegationIpc(service: DelegationService): void {
  ipcMain.handle(IPC_CHANNELS.delegation.status, (_event, id) => service.status(parseId(id)))
  ipcMain.handle(IPC_CHANNELS.delegation.configure, (_event, id, enabled) => service.configure(parseId(id), enabled))
  ipcMain.handle(IPC_CHANNELS.delegation.control, (_event, ws, task, action) => service.control(parseId(ws),parseId(task),action))
}
