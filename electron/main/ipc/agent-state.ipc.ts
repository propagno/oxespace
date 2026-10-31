import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PaneAgentStateEvent } from '../../../shared/types/agent-state'
import type { AgentStateService } from '../services/agent-state/agent-state.service'
import { requireAppFrame } from './ipc-guards'
import { notifyAgentSource } from '../services/agents/source-events'

/** Renderer-facing agent lifecycle state: the sidebar, pane chips, notifications and the "why" view read it. */
export function registerAgentStateIpc(service: AgentStateService): void {
  ipcMain.handle(IPC_CHANNELS.agentState.list, (event, workspaceId: unknown) => {
    requireAppFrame(event, 'Agent state')
    return service.list(typeof workspaceId === 'string' && workspaceId ? workspaceId : undefined)
  })
  ipcMain.handle(IPC_CHANNELS.agentState.markSeen, (event, paneId: unknown) => {
    requireAppFrame(event, 'Agent state')
    if (typeof paneId === 'string' && paneId) service.markSeen(paneId)
  })
  ipcMain.handle(IPC_CHANNELS.agentState.explain, (event, paneId: unknown) => {
    requireAppFrame(event, 'Agent state')
    return typeof paneId === 'string' && paneId ? service.explain(paneId) : null
  })
}

export function broadcastAgentState(event: PaneAgentStateEvent): void {
  notifyAgentSource({ source: 'pane', id: event.paneId, ...('cleared' in event ? { deleted: true } : {}) })
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agentState.onChanged, event)
}
