import { create } from 'zustand'
import type { AgentProfile, AgentReadiness } from '../../shared/types/agent'
import type { CreateAgentProfileInput, UpdateAgentProfileInput } from '../../shared/types/agent'

export const BUILTIN_AGENTS: AgentProfile[] = [
  { agentProfileId: 'oxe-planner',  name: 'OXE Planner',  provider: 'oxe', command: 'npx oxe-cc plan',    commandTemplate: 'npx oxe-cc plan',    isBuiltin: true },
  { agentProfileId: 'oxe-executor', name: 'OXE Executor', provider: 'oxe', command: 'npx oxe-cc execute', commandTemplate: 'npx oxe-cc execute', isBuiltin: true },
  { agentProfileId: 'oxe-reviewer', name: 'OXE Reviewer', provider: 'oxe', command: 'npx oxe-cc verify',  commandTemplate: 'npx oxe-cc verify',  isBuiltin: true },
  { agentProfileId: 'rubber-duck',  name: 'Rubber Duck',  provider: 'oxe', command: 'npx oxe-cc duck',    commandTemplate: 'npx oxe-cc duck',    isBuiltin: true },
]

interface AgentState {
  profiles: AgentProfile[]
  allProfiles: AgentProfile[]
  readiness: AgentReadiness[]
  isLoading: boolean
  isDiscovering: boolean
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
  allProfiles: [...BUILTIN_AGENTS],
  readiness: [],
  isLoading: false,
  isDiscovering: false,
  error: null,

  loadProfiles: async () => {
    set({ isLoading: true, error: null })
    try {
      const profiles = await window.oxe.agent.list()
      set({ profiles, allProfiles: [...BUILTIN_AGENTS, ...profiles], isLoading: false })
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
      set({ readiness, isDiscovering: false })
    } catch (error) {
      set({ error: toMessage(error), isDiscovering: false })
    }
  },

  createProfile: async (input) => {
    const profile = await window.oxe.agent.create(input)
    set((state) => {
      const profiles = [...state.profiles, profile]
      return { profiles, allProfiles: [...BUILTIN_AGENTS, ...profiles], error: null }
    })
    return profile
  },

  updateProfile: async (id, input) => {
    const profile = await window.oxe.agent.update(id, input)
    set((state) => {
      const profiles = state.profiles.map((p) => (p.agentProfileId === id ? profile : p))
      return { profiles, allProfiles: [...BUILTIN_AGENTS, ...profiles], error: null }
    })
    return profile
  },

  deleteProfile: async (id) => {
    await window.oxe.agent.delete(id)
    set((state) => {
      const profiles = state.profiles.filter((p) => p.agentProfileId !== id)
      return { profiles, allProfiles: [...BUILTIN_AGENTS, ...profiles], error: null }
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
