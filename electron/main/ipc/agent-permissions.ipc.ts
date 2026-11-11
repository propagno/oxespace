import { BrowserWindow, ipcMain } from 'electron'
import { AGENT_HOST_ACCESS_LEVELS } from '../../../shared/types/agent-permissions'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentAccess } from '../../../shared/types/oxequery'
import type { AgentPermissions } from '../services/approvals/agent-permissions'
import { parseOneOf, parseRecord, parseText } from './ipc-guards'

export function broadcastAgentPermissionsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agentPermissions.changed)
  }
}

/** F7 A55 · Window channels for Settings › What agents can do. Main frame only; never an MCP tool. */
export function registerAgentPermissionsIpc(permissions: AgentPermissions): void {
  ipcMain.handle(IPC_CHANNELS.agentPermissions.list, (_event, value: unknown) => {
    const input = value === undefined || value === null ? {} : parseRecord(value, 'AgentPermissions.list')
    const workspaceId = input.workspaceId === undefined ? '' : parseText(input.workspaceId, 'workspaceId', 200)
    return permissions.list({ workspaceId })
  })
  ipcMain.handle(IPC_CHANNELS.agentPermissions.revokeRule, (_event, value: unknown) => {
    const id = parseText(value, 'Rule id', 200)
    return permissions.revokeRule(id)
  })
  ipcMain.handle(IPC_CHANNELS.agentPermissions.setDatabaseAccess, (_event, value: unknown) => {
    const input = parseRecord(value, 'AgentPermissions.setDatabaseAccess')
    return permissions.setDatabaseAccess({
      id: parseText(input.id, 'Database id', 200),
      access: parseText(input.access, 'Database access', 40) as AgentAccess
    })
  })
  ipcMain.handle(IPC_CHANNELS.agentPermissions.setHostAccess, (_event, value: unknown) => {
    const input = parseRecord(value, 'AgentPermissions.setHostAccess')
    return permissions.setHostAccess({
      workspaceId: parseText(input.workspaceId, 'workspaceId', 200),
      host: parseText(input.host, 'host', 255),
      access: parseOneOf(input.access, AGENT_HOST_ACCESS_LEVELS, 'host access')
    })
  })
  ipcMain.handle(IPC_CHANNELS.agentPermissions.undo, (_event, value: unknown) => {
    const token = parseText(value, 'Undo token', 200)
    return permissions.undo(token)
  })
}
