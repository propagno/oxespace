import { create } from 'zustand'
import type { LinearIssue, LinearIssueScope, LinearStatus, LinearTeam } from '../../shared/types/linear'

interface LinearState {
  status: LinearStatus | null
  issues: LinearIssue[]
  teams: LinearTeam[]
  scope: LinearIssueScope
  teamId: string | null
  query: string
  includeCompleted: boolean
  isLoading: boolean
  isConnecting: boolean
  error: string | null
  notice: string | null
  loadStatus: () => Promise<void>
  connect: (apiKey: string) => Promise<void>
  disconnect: () => Promise<void>
  setScope: (scope: LinearIssueScope) => void
  setTeam: (teamId: string | null) => void
  setQuery: (query: string) => void
  toggleCompleted: () => void
  loadIssues: () => Promise<void>
  createWorktree: (input: { workspaceId: string; rootPath: string; issueId: string }) => Promise<void>
  clearNotice: () => void
}

export const useLinearStore = create<LinearState>((set, get) => ({
  status: null,
  issues: [],
  teams: [],
  scope: 'assigned',
  teamId: null,
  query: '',
  includeCompleted: false,
  isLoading: false,
  isConnecting: false,
  error: null,
  notice: null,

  loadStatus: async () => {
    try {
      const status = await window.oxe.linear.getStatus()
      set({ status, error: status.error })
      if (status.connected && !status.error) {
        void get().loadIssues()
        void window.oxe.linear
          .listTeams()
          .then((teams) => set({ teams }))
          .catch(() => undefined)
      }
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  connect: async (apiKey) => {
    set({ isConnecting: true, error: null })
    try {
      const status = await window.oxe.linear.setApiKey({ apiKey })
      set({ status, isConnecting: false, notice: `Connected as ${status.viewerName ?? 'Linear user'}.` })
      void get().loadIssues()
      void window.oxe.linear
        .listTeams()
        .then((teams) => set({ teams }))
        .catch(() => undefined)
    } catch (error) {
      set({ isConnecting: false, error: toMessage(error) })
    }
  },

  disconnect: async () => {
    await window.oxe.linear.clearApiKey()
    set({
      status: { connected: false, encrypted: false, viewerName: null, viewerEmail: null, organization: null, error: null },
      issues: [],
      teams: [],
      notice: 'Linear disconnected.'
    })
  },

  setScope: (scope) => {
    set({ scope })
    void get().loadIssues()
  },

  setTeam: (teamId) => {
    set({ teamId })
    void get().loadIssues()
  },

  setQuery: (query) => set({ query }),

  toggleCompleted: () => {
    set((state) => ({ includeCompleted: !state.includeCompleted }))
    void get().loadIssues()
  },

  loadIssues: async () => {
    const { includeCompleted, query, scope, teamId } = get()
    set({ isLoading: true, error: null })
    try {
      const issues = await window.oxe.linear.listIssues({ scope, teamId, query, includeCompleted })
      set({ issues, isLoading: false })
    } catch (error) {
      set({ isLoading: false, error: toMessage(error) })
    }
  },

  createWorktree: async (input) => {
    set({ error: null, notice: null })
    try {
      const result = await window.oxe.linear.createWorktreeFromIssue(input)
      set({ notice: result.message })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  clearNotice: () => set({ notice: null })
}))

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected Linear error'
}
