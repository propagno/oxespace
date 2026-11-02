import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { CopilotCreditsService } from '../services/copilotCredits.service'

let loading: Promise<CopilotCreditsService> | null = null

/** The counter's service (its `gh api` call through safe git) loads on the first request: boot never asks for credits. */
function defaultService(): Promise<CopilotCreditsService> {
  loading ??= import('../services/copilotCredits.service').then(module => new module.CopilotCreditsService())
    .catch((error: unknown) => { loading = null; throw error })
  return loading
}

/**
 * Renderer-facing IPC for the global Copilot AI-Credits counter.
 *   - `copilot:credits` — quota snapshot (premium_interactions) via `gh api`.
 * The channel registers at boot; a service that cannot load refuses that call, and the next one tries again.
 */
export function registerCopilotIpc(service: () => Promise<CopilotCreditsService> = defaultService): void {
  ipcMain.handle(IPC_CHANNELS.copilot.credits, async (_e, force?: boolean) => (await service()).getCredits(force === true))
}
