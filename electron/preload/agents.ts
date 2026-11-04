import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AgentsApi } from '../../shared/types/ipc/agents'
import type { AgentsChange, AgentsOverview } from '../../shared/types/agents'
import type { PreloadIpc } from './api'

/** S7.1 · `window.oxe.agents` (CCR #513 §5): the agents overview, the person's "seen" mark, and the change push. */
export function createAgentsApi(ipc: PreloadIpc): AgentsApi {
  return {
    overview: () => ipc.invoke(IPC_CHANNELS.agents.overview) as Promise<AgentsOverview>,
    markSeen: key => ipc.invoke(IPC_CHANNELS.agents.markSeen, key) as Promise<void>,
    onChanged: listener => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload as AgentsChange)
      ipc.on(IPC_CHANNELS.agents.onChanged, wrapped)
      return () => ipc.removeListener(IPC_CHANNELS.agents.onChanged, wrapped)
    }
  }
}
