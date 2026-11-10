import { create } from 'zustand'

export interface AgentActivityFilterState {
  filter: Record<string, unknown> | null
  open: (filter: Record<string, unknown>) => void
  clear: () => void
  setFilter: (filter: Record<string, unknown> | null) => void
}

export const useAgentActivityFilter = create<AgentActivityFilterState>((set) => ({
  filter: null,
  open: (filter) => set({ filter }),
  clear: () => set({ filter: null }),
  setFilter: (filter) => set({ filter })
}))
