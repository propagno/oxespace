import { create } from 'zustand'
import type { AgentProvider } from '../../shared/types/agent'
import { emptyAgentCredits, type AgentCreditsSnapshot } from '../../shared/types/agentCredits'

/**
 * Global (account-wide, not per-workspace) per-provider quota snapshots — the
 * Claude/Codex counterpart to `useCopilotCreditsStore`. Sourced via IPC
 * (`agent-credits:get`) and refreshed lazily + on focus + on an interval by the
 * chip. Keyed by provider so panes of different agents don't clobber each other.
 */
interface AgentCreditsState {
  byProvider: Partial<Record<AgentProvider, AgentCreditsSnapshot>>
  loading: Partial<Record<AgentProvider, boolean>>
  refresh: (provider: AgentProvider, force?: boolean) => Promise<void>
}

export const useAgentCreditsStore = create<AgentCreditsState>((set, get) => ({
  byProvider: {},
  loading: {},

  refresh: async (provider, force = false) => {
    if (get().loading[provider]) return
    set((s) => ({ loading: { ...s.loading, [provider]: true } }))
    try {
      const snapshot = await window.oxe.agentCredits.get({ provider, force })
      set((s) => ({
        byProvider: { ...s.byProvider, [provider]: snapshot },
        loading: { ...s.loading, [provider]: false }
      }))
    } catch (err) {
      set((s) => ({
        byProvider: {
          ...s.byProvider,
          [provider]: { ...emptyAgentCredits(provider), error: err instanceof Error ? err.message : String(err) }
        },
        loading: { ...s.loading, [provider]: false }
      }))
    }
  }
}))
