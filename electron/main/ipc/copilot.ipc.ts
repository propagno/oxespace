import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { CopilotCreditsService } from '../services/copilotCredits.service'

/**
 * Renderer-facing IPC for the global Copilot AI-Credits counter.
 *   - `copilot:credits` — quota snapshot (premium_interactions) via `gh api`.
 */
export function registerCopilotIpc(): void {
  const service = new CopilotCreditsService()
  ipcMain.handle(IPC_CHANNELS.copilot.credits, (_e, force?: boolean) => service.getCredits(force === true))
}
