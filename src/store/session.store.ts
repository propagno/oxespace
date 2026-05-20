import { create } from 'zustand'
import type { AgentProvider } from '../../shared/types/agent'
import type { ForkSessionInput, SessionSummary } from '../../shared/types/session'

const key = (workspaceId: string, provider: AgentProvider): string => `${workspaceId}|${provider}`

interface SessionStoreState {
  byKey: Record<string, SessionSummary[]>
  loading: Record<string, boolean>
  load: (workspaceId: string, workspaceRootPath: string, provider: AgentProvider) => Promise<void>
  fork: (input: ForkSessionInput) => Promise<string>
  remove: (workspaceId: string, workspaceRootPath: string, provider: AgentProvider, sessionId: string) => Promise<void>
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  byKey: {},
  loading: {},

  load: async (workspaceId, workspaceRootPath, provider) => {
    const k = key(workspaceId, provider)
    set((s) => ({ loading: { ...s.loading, [k]: true } }))
    try {
      const sessions = await window.oxe.session.list({ workspaceId, workspaceRootPath, provider })
      set((s) => ({
        byKey: { ...s.byKey, [k]: sessions },
        loading: { ...s.loading, [k]: false }
      }))
    } catch {
      set((s) => ({
        byKey: { ...s.byKey, [k]: [] },
        loading: { ...s.loading, [k]: false }
      }))
    }
  },

  fork: async (input) => {
    const result = await window.oxe.session.fork(input)
    // Refresh list
    await get().load(input.workspaceId, input.workspaceRootPath, input.provider)
    return result.forkSessionId
  },

  remove: async (workspaceId, workspaceRootPath, provider, sessionId) => {
    await window.oxe.session.delete({ workspaceRootPath, sessionId, provider })
    await get().load(workspaceId, workspaceRootPath, provider)
  }
}))

export function selectSessions(workspaceId: string, provider: AgentProvider): (state: SessionStoreState) => SessionSummary[] {
  return (state) => state.byKey[key(workspaceId, provider)] ?? []
}
