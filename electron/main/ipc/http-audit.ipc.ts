import { ipcMain } from 'electron'
import type { HttpAuditQuery } from '../../../shared/types/http-audit'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { HttpAuditHistory } from '../services/http-audit/history'

export function registerHttpAuditIpc(log: HttpAuditHistory): void {
  ipcMain.handle(IPC_CHANNELS.httpAudit.list, (_event, query: HttpAuditQuery) => log.list(query))
}
