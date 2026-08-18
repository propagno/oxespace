import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentCreditsInput } from '../../../shared/types/agentCredits'
import { AgentCreditsService } from '../services/agentCredits'

/**
 * Renderer-facing IPC for the per-provider usage/credits counter.
 *   - `agent-credits:get` — quota snapshot for a given provider (Claude/Codex).
 */
export function registerAgentCreditsIpc(service = new AgentCreditsService()): void {
  ipcMain.handle(IPC_CHANNELS.agentCredits.get, (_e, input: AgentCreditsInput) =>
    service.getCredits(input.provider, input.force === true)
  )
}
