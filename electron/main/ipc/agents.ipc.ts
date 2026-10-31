import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentMarkSeenResult, AgentsOverview } from '../../../shared/types/ipc/agents'
import { requireAppFrame } from './ipc-guards'

export interface AgentsIpcDeps {
  /** The read model, created on the first call (S7.1 loads it on demand). */
  model(): Promise<{ overview(): AgentsOverview; markSeen(input: unknown): AgentMarkSeenResult }>
  sender?: (event: IpcMainInvokeEvent) => void
}

/** S7.1 · `agents:overview` and `agents:mark-seen`, main frame only; `agents:changed` is pushed by the read model. */
export function registerAgentsIpc({ model, sender = event => requireAppFrame(event, 'Agents') }: AgentsIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.agents.overview, async event => { sender(event); return (await model()).overview() })
  ipcMain.handle(IPC_CHANNELS.agents.markSeen, async (event, input: unknown) => { sender(event); return (await model()).markSeen(input) })
}
