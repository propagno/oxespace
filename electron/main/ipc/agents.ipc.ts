import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentMarkSeenResult, AgentNudgeSetting, AgentsOverview } from '../../../shared/types/ipc/agents'
import { requireAppFrame } from './ipc-guards'

export interface AgentsIpcDeps {
  /** The read model, created on the first call (S7.1 loads it on demand). */
  model(): Promise<{ overview(): AgentsOverview; markSeen(input: unknown): AgentMarkSeenResult }>
  /** The needs-you delay (§5.10): read, and write one of the choices (anything else throws, storing nothing). */
  nudge: { get(): Promise<AgentNudgeSetting>; set(input: unknown): Promise<AgentNudgeSetting> }
  sender?: (event: IpcMainInvokeEvent) => void
}

/**
 * S7.1 · `agents:overview`, `agents:mark-seen` and the nudge setting, main frame only. `agents:changed` and
 * `agents:activate` are pushed by main.
 */
export function registerAgentsIpc({ model, nudge, sender = event => requireAppFrame(event, 'Agents') }: AgentsIpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.agents.overview, async event => { sender(event); return (await model()).overview() })
  ipcMain.handle(IPC_CHANNELS.agents.markSeen, async (event, input: unknown) => { sender(event); return (await model()).markSeen(input) })
  ipcMain.handle(IPC_CHANNELS.agents.nudgeSetting, event => { sender(event); return nudge.get() })
  ipcMain.handle(IPC_CHANNELS.agents.setNudgeSetting, (event, input: unknown) => {
    sender(event)
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).join() !== 'afterMs') throw new Error('Expected { afterMs }')
    return nudge.set((input as { afterMs: unknown }).afterMs)
  })
}
