import { ipcMain } from 'electron'
import type { AgentActivityBadgeQuery, AgentActivityQuery } from '../../../shared/types/agent-activity'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentActivity } from '../services/agent-activity/read-model'

export function registerAgentActivityIpc(activity: AgentActivity): void {
  ipcMain.handle(IPC_CHANNELS.agentActivity.list, (_event, query?: AgentActivityQuery) => activity.list(query ?? {}))
  ipcMain.handle(IPC_CHANNELS.agentActivity.detail, (_event, id: string) => activity.detail(id))
  ipcMain.handle(IPC_CHANNELS.agentActivity.badge, (_event, query: AgentActivityBadgeQuery) => activity.badge(query))
}
