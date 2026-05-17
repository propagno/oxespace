import { create } from 'zustand'
import type { AgentProvider } from '../../shared/types/agent'
import type { ContextUsageSnapshot } from '../../shared/types/usage'
import { EMPTY_CONTEXT_USAGE } from '../../shared/types/usage'
import type { UsageSessionMetadata } from '../../shared/types/usage/sessions'

/**
 * Usage snapshots are keyed by `${workspaceId}|${provider}` so that two panes in the same
 * workspace running different agents (e.g. Claude in one pane, Codex in another) each get
 * their own tracker without one provider's data bleeding into the other's chip.
 */

const key = (workspaceId: string, provider: AgentProvider): string => `${workspaceId}|${provider}`

interface UsageStoreState {
  byWorkspaceProvider: Record<string, ContextUsageSnapshot>
  loading: Record<string, boolean>
  sessionsByWorkspaceProvider: Record<string, UsageSessionMetadata[]>
  activeSessionByWorkspaceProvider: Record<string, string | null>
  supportedProviders: AgentProvider[]

  refreshFor: (workspaceId: string, workspaceRootPath: string, provider: AgentProvider) => Promise<void>
  loadSessions: (workspaceId: string, workspaceRootPath: string, provider: AgentProvider) => Promise<void>
  setActiveSession: (workspaceId: string, provider: AgentProvider, sessionId: string | null) => void
  loadSupportedProviders: () => Promise<void>
  startPolling: (workspaceId: string, workspaceRootPath: string, provider: AgentProvider, intervalMs?: number) => () => void
}

export const useUsageStore = create<UsageStoreState>((set, get) => ({
  byWorkspaceProvider: {},
  loading: {},
  sessionsByWorkspaceProvider: {},
  activeSessionByWorkspaceProvider: {},
  supportedProviders: [],

  refreshFor: async (workspaceId, workspaceRootPath, provider) => {
    const k = key(workspaceId, provider)
    set((state) => ({ loading: { ...state.loading, [k]: true } }))
    try {
      const activeSessionId = get().activeSessionByWorkspaceProvider[k] ?? null
      const snapshot = await window.oxe.usage.getSnapshotFor({ provider, workspaceRootPath, sessionId: activeSessionId })
      set((state) => ({
        byWorkspaceProvider: { ...state.byWorkspaceProvider, [k]: snapshot },
        loading: { ...state.loading, [k]: false }
      }))
    } catch {
      set((state) => ({
        byWorkspaceProvider: { ...state.byWorkspaceProvider, [k]: EMPTY_CONTEXT_USAGE },
        loading: { ...state.loading, [k]: false }
      }))
    }
  },

  loadSessions: async (workspaceId, workspaceRootPath, provider) => {
    try {
      const sessions = await window.oxe.usage.listSessions({ provider, workspaceRootPath })
      set((state) => ({
        sessionsByWorkspaceProvider: { ...state.sessionsByWorkspaceProvider, [key(workspaceId, provider)]: sessions }
      }))
    } catch {
      // ignore
    }
  },

  setActiveSession: (workspaceId, provider, sessionId) => {
    set((state) => ({
      activeSessionByWorkspaceProvider: { ...state.activeSessionByWorkspaceProvider, [key(workspaceId, provider)]: sessionId }
    }))
  },

  loadSupportedProviders: async () => {
    try {
      const providers = await window.oxe.usage.supportedProviders()
      set({ supportedProviders: providers })
    } catch {
      set({ supportedProviders: [] })
    }
  },

  startPolling: (workspaceId, workspaceRootPath, provider, intervalMs = 8_000) => {
    let stopped = false
    const tick = (): void => {
      if (stopped) return
      void get().refreshFor(workspaceId, workspaceRootPath, provider)
    }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }
}))

export function selectContextUsage(workspaceId: string, provider: AgentProvider | null): (state: UsageStoreState) => ContextUsageSnapshot {
  if (!provider) return () => EMPTY_CONTEXT_USAGE
  return (state) => state.byWorkspaceProvider[key(workspaceId, provider)] ?? EMPTY_CONTEXT_USAGE
}

export function selectSessions(workspaceId: string, provider: AgentProvider): (state: UsageStoreState) => UsageSessionMetadata[] {
  return (state) => state.sessionsByWorkspaceProvider[key(workspaceId, provider)] ?? []
}

export function selectActiveSessionId(workspaceId: string, provider: AgentProvider): (state: UsageStoreState) => string | null {
  return (state) => state.activeSessionByWorkspaceProvider[key(workspaceId, provider)] ?? null
}
