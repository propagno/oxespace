import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { OxeQueryEvent, OxeQueryOp, OxeQueryResponse } from '../../../shared/types/oxequery'

export interface OxeQueryIpcService {
  call(op: OxeQueryOp, input: unknown): Promise<OxeQueryResponse<unknown>>
}

const OPS = new Set<OxeQueryOp>([
  'system.ping',
  'containers.engines', 'containers.list', 'containers.inspect', 'containers.action', 'containers.exec', 'containers.logsStart', 'containers.logsStop', 'containers.shell',
  'containers.suggestConnection', 'connections.list', 'connections.save', 'connections.delete', 'connections.test', 'connections.fromContainer',
  'connections.trustHostKey', 'connections.knownHosts', 'connections.forgetHostKey', 'files.pick',
  'sql.schemas', 'sql.tables', 'sql.table', 'sql.run', 'sql.browse', 'sql.cancel', 'sql.check', 'sql.editability', 'sql.previewChanges', 'sql.apply',
  'mongo.databases', 'mongo.collections', 'mongo.find', 'mongo.aggregate', 'mongo.indexes', 'mongo.write', 'export.run', 'export.cancel', 'import.preview', 'import.run', 'import.cancel'
])

function fromMainFrame(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('OxeQuery requests require the application main frame')
}

/** One command channel. Every operation is validated again inside the service. */
export function registerOxeQueryIpc(service: OxeQueryIpcService): void {
  ipcMain.handle(IPC_CHANNELS.oxeQuery.call, (event, request: unknown) => {
    fromMainFrame(event)
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string' || !OPS.has(body.op as OxeQueryOp)) throw new Error('Unknown OxeQuery operation')
    return service.call(body.op as OxeQueryOp, body.input)
  })
}

export function broadcastOxeQueryEvent(event: OxeQueryEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxeQuery.onEvent, event)
}
