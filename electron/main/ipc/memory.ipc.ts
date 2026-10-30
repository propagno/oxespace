import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { MemoryApi, MemoryManageApi, MemoryRuntimeSettings, MemorySettings } from '../../../shared/types/memory'
import type { MemoryControl } from '../services/memory/memory-control'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid memory input')
  return value
}
export function registerMemoryIpc(service: Omit<MemoryApi, keyof MemoryManageApi> & { featureEnabled(): boolean; control(): Promise<MemoryControl> }): void {
  // Off in this build: status answers "not available" so the interface can hide itself; nothing else is served.
  const gate = <A extends unknown[], R>(handler: (...args: A) => R) => (...args: A): R => {
    if (!service.featureEnabled()) throw new Error('Shared Project Memory is not enabled')
    return handler(...args)
  }
  ipcMain.handle(IPC_CHANNELS.memory.status, (_event, workspaceId) => service.status(text(workspaceId)))
  ipcMain.handle(IPC_CHANNELS.memory.recent, gate((_event, workspaceId) => service.recent(text(workspaceId))))
  ipcMain.handle(IPC_CHANNELS.memory.handoffs, gate((_event, workspaceId) => service.handoffs(text(workspaceId))))
  ipcMain.handle(IPC_CHANNELS.memory.acceptHandoff, gate((_event, input) => service.acceptHandoff({ workspaceId: text(input?.workspaceId), handoffId: text(input?.handoffId) })))
  ipcMain.handle(IPC_CHANNELS.memory.storage, gate(() => service.storage()))
  // Looking through, exporting, deleting and resetting stored memory: the handlers load on first use.
  for (const action of ['notes', 'noteDelete', 'export', 'reset'] as const) {
    ipcMain.handle(IPC_CHANNELS.memory[action], gate(async (_event, input) => (await import('./memory-manage.ipc')).handleMemoryManage(action, () => service.control(), input)))
  }
  ipcMain.handle(IPC_CHANNELS.memory.install, gate(() => service.install()))
  ipcMain.handle(IPC_CHANNELS.memory.rollback, gate((_event, workspaceId) => service.rollback(text(workspaceId))))
  ipcMain.handle(IPC_CHANNELS.memory.setupAgents, gate((_event, workspaceId) => service.setupAgents(text(workspaceId))))
  ipcMain.handle(IPC_CHANNELS.memory.search, gate((_event, input) => service.search({ workspaceId: text(input?.workspaceId), query: text(input?.query) })))
  ipcMain.handle(IPC_CHANNELS.memory.configure, gate((_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid memory configuration')
    const value = input as Record<string, unknown>
    const settings = value.settings as MemorySettings | undefined
    const runtime = value.runtime as MemoryRuntimeSettings | undefined
    if (!settings || !runtime || !['enabled', 'automaticCapture', 'automaticContext'].every(key => typeof (settings as unknown as Record<string, unknown>)[key] === 'boolean')) throw new Error('Invalid memory settings')
    if (!['managed', 'connected'].includes(runtime.mode)) throw new Error('Invalid memory runtime mode')
    if (value.token !== undefined && (typeof value.token !== 'string' || value.token.length > 4096)) throw new Error('Invalid token')
    return service.configure({ workspaceId: text(value.workspaceId), settings: { enabled: settings.enabled, automaticCapture: settings.automaticCapture, automaticContext: settings.automaticContext },
      runtime: { mode: runtime.mode, executable: text(runtime.executable), url: text(runtime.url) }, token: value.token as string | undefined })
  }))
}
