import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { OxeQueryEvent, OxeQueryOp, OxeQueryResponse } from '../../../shared/types/oxequery'
import { requireAppFrame } from './ipc-guards'

export interface OxeQueryIpcService {
  call(op: OxeQueryOp, input: unknown): Promise<OxeQueryResponse<unknown>>
}

/** Every operation the window may ask OxeQuery for. Containers are OxePod's channel (`oxepod.ipc.ts`). */
export const OXEQUERY_OPS: readonly OxeQueryOp[] = [
  'system.ping',
  'connections.list', 'preferences.get', 'preferences.set', 'connections.save', 'connections.update', 'connections.duplicate', 'connections.connectEphemeral', 'connections.reconnect', 'connections.export', 'connections.import', 'connections.delete', 'connections.test',
  'connections.fromContainer', 'connections.createInContainer',
  'connections.trustHostKey', 'connections.knownHosts', 'connections.forgetHostKey', 'files.pick',
  'sql.schemas', 'sql.tables', 'sql.table', 'workspace.load', 'workspace.save', 'sql.run', 'sql.more', 'sql.script', 'sql.tx', 'sql.browse', 'sql.cancel', 'sql.check', 'safety.get', 'sql.editability', 'sql.previewChanges', 'sql.apply', 'sql.structure.preview', 'sql.structure.apply', 'sql.maintenance',
  'mongo.databases', 'mongo.document', 'mongo.collections', 'mongo.find', 'mongo.aggregate', 'mongo.bulk', 'mongo.collection', 'mongo.stats', 'mongo.validation', 'mongo.setValidation', 'mongo.explain', 'mongo.cancel', 'mongo.indexes', 'mongo.schema', 'mongo.createIndex', 'mongo.dropIndex', 'sql.functions', 'sql.databases', 'sql.createDatabase', 'sql.dropDatabase', 'sql.roles', 'sql.objects', 'sql.extensions', 'sql.search', 'sql.definition', 'mongo.write', 'export.run', 'export.cancel', 'sql.explain',
  'audit.list', 'library.list', 'library.save', 'library.delete', 'library.clearHistory', 'import.preview', 'import.reparse', 'import.run', 'import.cancel'
]
const OPS = new Set<string>(OXEQUERY_OPS)

/** One command channel. Every operation is validated again inside the service. */
export function registerOxeQueryIpc(service: OxeQueryIpcService): void {
  ipcMain.handle(IPC_CHANNELS.oxeQuery.call, (event, request: unknown) => {
    requireAppFrame(event, 'OxeQuery')
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string' || !OPS.has(body.op)) throw new Error('Unknown OxeQuery operation')
    return service.call(body.op as OxeQueryOp, body.input)
  })
}

export function broadcastOxeQueryEvent(event: OxeQueryEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxeQuery.onEvent, event)
}
