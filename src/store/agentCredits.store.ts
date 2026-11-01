import { create } from 'zustand'
import type { AgentProvider } from '../../shared/types/agent'
import { emptyAgentCredits, type AgentCreditsSnapshot } from '../../shared/types/agentCredits'
import { humanizeError } from '../utils/humanizeError'

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
          [provider]: { ...emptyAgentCredits(provider), error: humanizeError(err) }
        },
        loading: { ...s.loading, [provider]: false }
      }))
    }
  }
}))

// bisect only (F7.3): which fields change during a cold switch
useAgentCreditsStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as Record<string, unknown>)[key] !== (prev as Record<string, unknown>)[key]) w.__stores['AgentCredits.' + key] = (w.__stores['AgentCredits.' + key] ?? 0) + 1 })
