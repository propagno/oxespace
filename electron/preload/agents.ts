/**
 * S7.1 · `window.oxe.agents`: the agents read model (shared/types/ipc/agents.ts). Its own module, so the domain's
 * bridge does not grow `api.ts`, the way the IPC types are split into `shared/types/ipc/<domain>.ts`.
 */
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AgentActivateEvent, AgentMarkSeenResult, AgentNudgeSetting, AgentsApi, AgentsChange, AgentsOverview } from '../../shared/types/ipc/agents'
import type { PreloadIpc } from './api'

function subscribe<Payload>(ipc: PreloadIpc, channel: string, listener: (payload: Payload) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as Payload)
  ipc.on(channel, wrapped)
  return () => ipc.removeListener(channel, wrapped)
}

export function createAgentsApi(ipc: PreloadIpc): Required<AgentsApi> {
  return {
    overview: () => ipc.invoke(IPC_CHANNELS.agents.overview) as Promise<AgentsOverview>,
    markSeen: input => ipc.invoke(IPC_CHANNELS.agents.markSeen, input) as Promise<AgentMarkSeenResult>,
    onChanged: listener => subscribe<AgentsChange>(ipc, IPC_CHANNELS.agents.changed, listener),
    onActivate: listener => subscribe<AgentActivateEvent>(ipc, IPC_CHANNELS.agents.activate, listener),
    nudgeSetting: () => ipc.invoke(IPC_CHANNELS.agents.nudgeSetting) as Promise<AgentNudgeSetting>,
    setNudgeSetting: input => ipc.invoke(IPC_CHANNELS.agents.setNudgeSetting, input) as Promise<AgentNudgeSetting>
  }
}
