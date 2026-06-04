import type { AgentProvider } from '../../../../shared/types/agent'
import type { AgentCreditsSnapshot } from '../../../../shared/types/agentCredits'

/**
 * One provider's quota source. Implementations cache internally (short TTL) and
 * must never throw — on any failure they return a snapshot with
 * `available: false` so the renderer simply hides the chip.
 */
export interface AgentCreditsProvider {
  readonly provider: AgentProvider
  getCredits(force?: boolean): Promise<AgentCreditsSnapshot>
}
