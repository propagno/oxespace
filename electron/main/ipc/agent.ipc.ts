import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { CreateAgentProfileInput, UpdateAgentProfileInput } from '../../../shared/types/agent'
import { AgentService } from '../services/agent.service'

export function registerAgentIpc(db: AppDatabase): void {
  const agentService = new AgentService(db)

  ipcMain.handle(IPC_CHANNELS.agent.list, () =>
    agentService.list()
  )

  ipcMain.handle(IPC_CHANNELS.agent.create, (_event, input: unknown) =>
    agentService.create(input as CreateAgentProfileInput)
  )

  ipcMain.handle(IPC_CHANNELS.agent.update, (_event, id: unknown, input: unknown) =>
    agentService.update(id as string, input as UpdateAgentProfileInput)
  )

  ipcMain.handle(IPC_CHANNELS.agent.delete, (_event, id: unknown) =>
    agentService.delete(id as string)
  )

  ipcMain.handle(IPC_CHANNELS.agent.discover, (_event, forceRefresh: unknown) =>
    agentService.discover(forceRefresh === true)
  )

  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () =>
    agentService.getCachedReadiness()
  )
}
