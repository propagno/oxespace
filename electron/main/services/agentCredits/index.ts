import type { AgentProvider } from '../../../../shared/types/agent'
import { emptyAgentCredits, type AgentCreditsSnapshot } from '../../../../shared/types/agentCredits'
import { ClaudeCreditsService } from './claudeCredits.service'
import { CodexCreditsService } from './codexCredits.service'
import type { AgentCreditsProvider } from './types'

/**
 * Dispatches per-provider quota lookups. Mirrors `CopilotCreditsService` but for
 * the agents whose credits the app now surfaces (Claude, Codex). Copilot keeps
 * its own dedicated service/channel. Antigravity has no machine-readable source
 * yet, so it's intentionally absent → callers get `available: false`.
 */
export class AgentCreditsService {
  private readonly providers: Map<AgentProvider, AgentCreditsProvider>

  constructor(providers?: AgentCreditsProvider[]) {
    const defaults: AgentCreditsProvider[] = providers ?? [
      new ClaudeCreditsService(),
      new CodexCreditsService()
    ]
    this.providers = new Map(defaults.map((p) => [p.provider, p]))
  }

  async getCredits(provider: AgentProvider, force = false): Promise<AgentCreditsSnapshot> {
    const impl = this.providers.get(provider)
    if (!impl) return emptyAgentCredits(provider)
    return impl.getCredits(force)
  }
}
