import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { OxePodEvent, OxePodOp, OxePodResponse } from '../../../shared/types/oxepod'
import { requireAppFrame } from './ipc-guards'

export interface OxePodIpcService {
  call(op: OxePodOp, input: unknown): Promise<OxePodResponse<unknown>>
}

/** Every operation the window may ask OxePod for; anything else is refused before the service loads. */
export const OXEPOD_OPS: readonly OxePodOp[] = [
  'containers.engines', 'containers.candidates', 'containers.useCandidate', 'containers.list', 'containers.inspect', 'containers.stats', 'containers.action', 'containers.remove',
  'containers.compose', 'containers.exec', 'containers.logsStart', 'containers.logsStop', 'containers.shell', 'containers.suggestConnection',
  'resources.images', 'resources.volumes', 'resources.networks', 'resources.usage', 'resources.remove', 'resources.prune'
]
const OPS = new Set<string>(OXEPOD_OPS)

/**
 * The one command channel of OxePod. Only this stub is loaded at startup; the service is loaded by the first
 * request (or by OxeQuery, in process), so none of it weighs on boot. Every operation is validated again in the service.
 */
export function registerOxePodIpc(load: () => Promise<OxePodIpcService>, describeFailure: (error: unknown) => string): void {
  ipcMain.handle(IPC_CHANNELS.oxePod.call, async (event, request: unknown): Promise<OxePodResponse<unknown>> => {
    requireAppFrame(event, 'OxePod')
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string' || !OPS.has(body.op)) throw new Error('Unknown OxePod operation')
    let service: OxePodIpcService
    // The view asks through this channel; answer with the reason instead of a rejected call.
    try { service = await load() } catch (error) { return { ok: false, error: { code: 'failed', message: `OxePod did not start: ${describeFailure(error)}`, messageCode: { code: 'oxepod.startFailed', params: { reason: describeFailure(error) } } } } }
    return service.call(body.op as OxePodOp, body.input)
  })
}

export function broadcastOxePodEvent(event: OxePodEvent): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.oxePod.onEvent, event)
}
