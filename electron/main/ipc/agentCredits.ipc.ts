import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentCreditsInput } from '../../../shared/types/agentCredits'
import { AgentCreditsService } from '../services/agentCredits'
import { parseRecord, parseToken } from './ipc-guards'

/**
 * Renderer-facing IPC for the per-provider usage/credits counter.
 *   - `agent-credits:get` — quota snapshot for a given provider (Claude/Codex).
 */
export function registerAgentCreditsIpc(service = new AgentCreditsService()): AgentCreditsService {
  ipcMain.handle(IPC_CHANNELS.agentCredits.get, (event, value: unknown) => {
    const input = parseRecord(value, 'Usage request')
    return service.getCredits(parseToken(input.provider, 'Provider', 40) as AgentCreditsInput['provider'], input.force === true)
  })
  return service
}
