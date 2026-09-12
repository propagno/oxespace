import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { MemoryApi, MemoryRuntimeSettings, MemorySettings } from '../../../shared/types/memory'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid memory input')
  return value
}
export function registerMemoryIpc(service: MemoryApi): void {
  ipcMain.handle(IPC_CHANNELS.memory.status, (_event, workspaceId) => service.status(text(workspaceId)))
  ipcMain.handle(IPC_CHANNELS.memory.recent, (_event, workspaceId) => service.recent(text(workspaceId)))
  ipcMain.handle(IPC_CHANNELS.memory.install, () => service.install())
  ipcMain.handle(IPC_CHANNELS.memory.setupAgents, (_event, workspaceId) => service.setupAgents(text(workspaceId)))
  ipcMain.handle(IPC_CHANNELS.memory.search, (_event, input) => service.search({ workspaceId: text(input?.workspaceId), query: text(input?.query) }))
  ipcMain.handle(IPC_CHANNELS.memory.configure, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid memory configuration')
    const value = input as Record<string, unknown>
    const settings = value.settings as MemorySettings | undefined
    const runtime = value.runtime as MemoryRuntimeSettings | undefined
    if (!settings || !runtime || !['enabled', 'automaticCapture', 'automaticContext'].every(key => typeof (settings as unknown as Record<string, unknown>)[key] === 'boolean')) throw new Error('Invalid memory settings')
    if (!['managed', 'connected'].includes(runtime.mode)) throw new Error('Invalid memory runtime mode')
    if (value.token !== undefined && (typeof value.token !== 'string' || value.token.length > 4096)) throw new Error('Invalid token')
    return service.configure({ workspaceId: text(value.workspaceId), settings: { enabled: settings.enabled, automaticCapture: settings.automaticCapture, automaticContext: settings.automaticContext },
      runtime: { mode: runtime.mode, executable: text(runtime.executable), url: text(runtime.url) }, token: value.token as string | undefined })
  })
}
