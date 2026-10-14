import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { OxeQueryEvent, OxeQueryOp, OxeQueryResponse } from '../../../shared/types/oxequery'

export interface OxeQueryIpcService {
  call(op: OxeQueryOp, input: unknown): Promise<OxeQueryResponse<unknown>>
}

const OPS = new Set<OxeQueryOp>([
  'system.ping',
  'containers.engines', 'containers.candidates', 'containers.useCandidate', 'containers.list', 'containers.inspect', 'containers.action', 'containers.exec', 'containers.logsStart', 'containers.logsStop', 'containers.shell',
  'containers.suggestConnection', 'connections.list', 'connections.save', 'connections.delete', 'connections.test', 'connections.fromContainer',
  'connections.trustHostKey', 'connections.knownHosts', 'connections.forgetHostKey', 'files.pick',
  'sql.schemas', 'sql.tables', 'sql.table', 'workspace.load', 'workspace.save', 'sql.run', 'sql.script', 'sql.tx', 'sql.browse', 'sql.cancel', 'sql.check', 'sql.editability', 'sql.previewChanges', 'sql.apply', 'sql.structure.preview', 'sql.structure.apply', 'sql.maintenance',
  'mongo.databases', 'mongo.document', 'mongo.collections', 'mongo.find', 'mongo.aggregate', 'mongo.bulk', 'mongo.collection', 'mongo.stats', 'mongo.validation', 'mongo.setValidation', 'mongo.explain', 'mongo.cancel', 'mongo.indexes', 'mongo.schema', 'mongo.createIndex', 'mongo.dropIndex', 'sql.functions', 'sql.databases', 'sql.createDatabase', 'sql.dropDatabase', 'sql.roles', 'sql.objects', 'sql.extensions', 'sql.search', 'sql.definition', 'mongo.write', 'export.run', 'export.cancel', 'sql.explain', 'containers.stats', 'resources.images', 'resources.volumes', 'resources.networks', 'resources.usage', 'resources.remove', 'containers.createDatabase', 'audit.list', 'library.list', 'library.save', 'library.delete', 'library.clearHistory', 'import.preview', 'import.run', 'import.cancel'
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
