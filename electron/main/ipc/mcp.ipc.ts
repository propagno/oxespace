import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { McpServerHealthEvent } from '../../../shared/types/mcp'
import type { McpManager } from '../services/mcp.service'

export function registerMcpIpc(manager: McpManager): void {
  ipcMain.handle(IPC_CHANNELS.mcp.list, (_event, workspaceId: unknown) => {
    const wid = typeof workspaceId === 'string' && workspaceId ? workspaceId : null
    return manager.list(wid)
  })

  ipcMain.handle(IPC_CHANNELS.mcp.create, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid create input')
    const { workspaceId, name, transport, config, enabled, trusted } = input as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim()) throw new Error('name is required')
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') throw new Error('invalid transport')
    if (!config || typeof config !== 'object') throw new Error('config is required')
    return manager.create({
      workspaceId: typeof workspaceId === 'string' && workspaceId ? workspaceId : null,
      name,
      transport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config as any,
      enabled: enabled === undefined ? undefined : enabled === true,
      trusted: trusted === undefined ? undefined : trusted === true
    })
  })

  ipcMain.handle(IPC_CHANNELS.mcp.update, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid update input')
    const { id, name, transport, config, enabled, trusted } = input as Record<string, unknown>
    if (typeof id !== 'string' || !id) throw new Error('id is required')
    return manager.update({
      id,
      name: typeof name === 'string' ? name : undefined,
      transport: (transport === 'stdio' || transport === 'http' || transport === 'sse') ? transport : undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: config && typeof config === 'object' ? (config as any) : undefined,
      enabled: enabled === undefined ? undefined : enabled === true,
      trusted: trusted === undefined ? undefined : trusted === true
    })
  })

  ipcMain.handle(IPC_CHANNELS.mcp.delete, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('id is required')
    manager.delete(id)
  })

  ipcMain.handle(IPC_CHANNELS.mcp.start, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('id is required')
    return manager.start(id)
  })

  ipcMain.handle(IPC_CHANNELS.mcp.stop, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('id is required')
    manager.stopRuntime(id)
  })

  ipcMain.handle(IPC_CHANNELS.mcp.callTool, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid callTool input')
    const { serverId, toolName, arguments: args } = input as Record<string, unknown>
    if (typeof serverId !== 'string' || !serverId) throw new Error('serverId is required')
    if (typeof toolName !== 'string' || !toolName) throw new Error('toolName is required')
    return manager.callTool({
      serverId,
      toolName,
      arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
    })
  })
}

export function broadcastMcpHealth(event: McpServerHealthEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.mcp.onHealth, event)
  }
}
