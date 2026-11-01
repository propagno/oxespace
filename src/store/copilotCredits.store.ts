import { create } from 'zustand'
import type { CopilotCredits } from '../../shared/types/copilot'
import { humanizeError } from '../utils/humanizeError'

/**
 * Global (account-wide, not per-workspace) Copilot AI-Credits snapshot. Mirrors
 * VS Code's Copilot status menu, sourced from `gh api copilot_internal/user`
 * via IPC. Refreshed lazily + on window focus + on an interval by the chip.
 */
interface CopilotCreditsState {
  credits: CopilotCredits | null
  loading: boolean
  refresh: (force?: boolean) => Promise<void>
}

export const useCopilotCreditsStore = create<CopilotCreditsState>((set, get) => ({
  credits: null,
  loading: false,

  refresh: async (force = false) => {
    if (get().loading) return
    set({ loading: true })
    try {
      const credits = await window.oxe.copilot.credits(force)
      set({ credits, loading: false })
    } catch (err) {
      set({
        credits: { available: false, installed: false, plan: null, sku: null, credits: null, resetDate: null, tokenBasedBilling: false, error: humanizeError(err) },
        loading: false
      })
    }
  }
}))

// bisect only (F7.3): which fields change during a cold switch
useCopilotCreditsStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as Record<string, unknown>)[key] !== (prev as Record<string, unknown>)[key]) w.__stores['CopilotCredits.' + key] = (w.__stores['CopilotCredits.' + key] ?? 0) + 1 })
