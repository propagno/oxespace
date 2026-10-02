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
  private readonly lastGood = new Map<AgentProvider, AgentCreditsSnapshot>()
  private readonly inFlight = new Map<AgentProvider, Promise<AgentCreditsSnapshot>>()

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
    const pending = this.inFlight.get(provider)
    if (pending) return pending
    const read = impl.getCredits(force).then(value => {
      if (value.available) { this.lastGood.set(provider, value); return value }
      const previous = this.lastGood.get(provider)
      const age = Date.now() - (previous?.observedAtMs ?? 0)
      // Never present a former account's quota after authentication is rejected.
      if (previous && value.installed && value.error && !/\b(?:401|403)\b/.test(value.error) && age < 30 * 60_000) {
        return { ...previous, stale: true, error: value.error }
      }
      return value
    }).finally(() => { if (this.inFlight.get(provider) === read) this.inFlight.delete(provider) })
    this.inFlight.set(provider, read)
    return read
  }
}
