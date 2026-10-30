import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { MemoryApi, MemoryRuntimeSettings, MemorySettings } from '../../../shared/types/memory'

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new Error('Invalid memory input')
  return value
}
export function registerMemoryIpc(service: MemoryApi & { featureEnabled(): boolean }): void {
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
  ipcMain.handle(IPC_CHANNELS.memory.notes, gate((_event, input) => service.notes({ workspaceId: text(input?.workspaceId), ...(input?.query ? { query: text(input.query) } : {}) })))
  ipcMain.handle(IPC_CHANNELS.memory.noteDelete, gate((_event, input) => service.noteDelete({ workspaceId: text(input?.workspaceId), path: text(input?.path) })))
  ipcMain.handle(IPC_CHANNELS.memory.export, gate((_event, input) => service.export({ workspaceId: text(input?.workspaceId), scope: input?.scope === 'team' ? 'team' : 'all' })))
  ipcMain.handle(IPC_CHANNELS.memory.reset, gate((_event, input) => {
    if (input?.scope !== 'project' && input?.scope !== 'all') throw new Error('Invalid reset scope')
    return service.reset({ workspaceId: text(input.workspaceId), scope: input.scope, confirm: typeof input.confirm === 'string' ? input.confirm : '' })
  }))
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
