import { create } from 'zustand'
import { emptyContextUsage, type ContextUsageChip, type ContextUsageInput } from '../../shared/types/contextUsage'

/**
 * Live context-window % per (provider + workspace root). Sourced via IPC
 * (`context-usage:get`) and polled ~every 5s by the chip so it tracks each
 * agent turn. Keyed so panes of different agents/roots don't clobber each other.
 */
function keyOf(input: ContextUsageInput): string {
  return `${input.provider}|${input.workspaceRootPath}`
}

interface ContextUsageState {
  byKey: Record<string, ContextUsageChip>
  loading: Record<string, boolean>
  refresh: (input: ContextUsageInput, force?: boolean) => Promise<void>
}

export const useContextUsageStore = create<ContextUsageState>((set, get) => ({
  byKey: {},
  loading: {},

  refresh: async (input, force = false) => {
    const key = keyOf(input)
    if (get().loading[key]) return
    set((s) => ({ loading: { ...s.loading, [key]: true } }))
    try {
      const chip = await window.oxe.contextUsage.get({ ...input, force } as ContextUsageInput & { force?: boolean })
      set((s) => ({
        byKey: { ...s.byKey, [key]: chip },
        loading: { ...s.loading, [key]: false }
      }))
    } catch (err) {
      set((s) => ({
        byKey: { ...s.byKey, [key]: { ...emptyContextUsage(input.provider), error: err instanceof Error ? err.message : String(err) } },
        loading: { ...s.loading, [key]: false }
      }))
    }
  }
}))

export { keyOf as contextUsageKey }
