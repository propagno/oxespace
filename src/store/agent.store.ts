import { create } from 'zustand'
import type { AgentProfile, AgentReadiness } from '../../shared/types/agent'
import type { CreateAgentProfileInput, UpdateAgentProfileInput } from '../../shared/types/agent'

const LAST_HEALTH_KEY = 'oxe-last-agent-health-check-at'

function readLastHealthCheckAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_HEALTH_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writeLastHealthCheckAt(ts: number): void {
  try {
    localStorage.setItem(LAST_HEALTH_KEY, String(ts))
  } catch {
    /* private mode / SSR */
  }
}

interface AgentState {
  profiles: AgentProfile[]
  allProfiles: AgentProfile[]
  readiness: AgentReadiness[]
  isLoading: boolean
  isDiscovering: boolean
  /** Epoch ms of last successful health check (persisted). */
  lastHealthCheckAt: number | null
  error: string | null
  loadProfiles: () => Promise<void>
  loadReadiness: () => Promise<void>
  discover: (forceRefresh?: boolean) => Promise<void>
  createProfile: (input: CreateAgentProfileInput) => Promise<AgentProfile>
  updateProfile: (id: string, input: UpdateAgentProfileInput) => Promise<AgentProfile>
  deleteProfile: (id: string) => Promise<void>
  clearError: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  profiles: [],
  allProfiles: [],
  readiness: [],
  isLoading: false,
  isDiscovering: false,
  lastHealthCheckAt: typeof localStorage !== 'undefined' ? readLastHealthCheckAt() : null,
  error: null,

  loadProfiles: async () => {
    set({ isLoading: true, error: null })
    try {
      const profiles = await window.oxe.agent.list()
      set({ profiles, allProfiles: profiles, isLoading: false })
    } catch (error) {
      set({ error: toMessage(error), isLoading: false })
    }
  },

  loadReadiness: async () => {
    try {
      const readiness = await window.oxe.agent.getReadiness()
      set({ readiness })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  discover: async (forceRefresh = false) => {
    set({ isDiscovering: true, error: null })
    try {
      const readiness = await window.oxe.agent.discover(forceRefresh)
      const lastHealthCheckAt = Date.now()
      writeLastHealthCheckAt(lastHealthCheckAt)
      set({ readiness, isDiscovering: false, lastHealthCheckAt })
    } catch (error) {
      set({ error: toMessage(error), isDiscovering: false })
    }
  },

  createProfile: async (input) => {
    const profile = await window.oxe.agent.create(input)
    set((state) => {
      const profiles = [...state.profiles, profile]
      return { profiles, allProfiles: profiles, error: null }
    })
    return profile
  },

  updateProfile: async (id, input) => {
    const profile = await window.oxe.agent.update(id, input)
    set((state) => {
      const profiles = state.profiles.map((p) => (p.agentProfileId === id ? profile : p))
      return { profiles, allProfiles: profiles, error: null }
    })
    return profile
  },

  deleteProfile: async (id) => {
    await window.oxe.agent.delete(id)
    set((state) => {
      const profiles = state.profiles.filter((p) => p.agentProfileId !== id)
      return { profiles, allProfiles: profiles, error: null }
    })
  },

  clearError: () => set({ error: null })
}))

export function selectReadinessByProvider(state: AgentState, provider: string): AgentReadiness | undefined {
  return state.readiness.find((r) => r.provider === provider)
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected agent error'
}
