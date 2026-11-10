import { ipcMain } from 'electron'
import type { HttpAuditQuery } from '../../../shared/types/http-audit'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { HttpAuditLog } from '../services/http-audit/store'

export function registerHttpAuditIpc(log: HttpAuditLog): void {
  ipcMain.handle(IPC_CHANNELS.httpAudit.list, (_event, query: HttpAuditQuery) => log.list(query))
}
