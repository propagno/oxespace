/**
 * S7.1 · `window.oxe.agents`: the agents read model (shared/types/ipc/agents.ts). Its own module, so the domain's
 * bridge does not grow `api.ts`, the way the IPC types are split into `shared/types/ipc/<domain>.ts`.
 */
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AgentMarkSeenResult, AgentsApi, AgentsChange, AgentsOverview } from '../../shared/types/ipc/agents'
import type { PreloadIpc } from './api'

export function createAgentsApi(ipc: PreloadIpc): Required<AgentsApi> {
  return {
    overview: () => ipc.invoke(IPC_CHANNELS.agents.overview) as Promise<AgentsOverview>,
    markSeen: input => ipc.invoke(IPC_CHANNELS.agents.markSeen, input) as Promise<AgentMarkSeenResult>,
    onChanged: listener => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as AgentsChange)
      ipc.on(IPC_CHANNELS.agents.changed, wrapped)
      return () => ipc.removeListener(IPC_CHANNELS.agents.changed, wrapped)
    }
  }
}
