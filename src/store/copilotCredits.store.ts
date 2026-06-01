import { create } from 'zustand'
import type { CopilotCredits } from '../../shared/types/copilot'

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
        credits: { available: false, installed: false, plan: null, sku: null, premium: null, resetDate: null, tokenBasedBilling: false, error: err instanceof Error ? err.message : String(err) },
        loading: false
      })
    }
  }
}))
