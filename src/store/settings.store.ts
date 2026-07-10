import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * General app preferences, persisted to localStorage (OXESpace has no global
 * settings backend yet). Keep this lean — feature-specific prefs live in their
 * own stores (e.g. voice.store).
 */
export const VISITED_WORKSPACES_CAP_MIN = 1
export const VISITED_WORKSPACES_CAP_MAX = 5
export const VISITED_WORKSPACES_CAP_DEFAULT = 3

function clampVisitedCap(n: number): number {
  if (!Number.isFinite(n)) return VISITED_WORKSPACES_CAP_DEFAULT
  return Math.min(VISITED_WORKSPACES_CAP_MAX, Math.max(VISITED_WORKSPACES_CAP_MIN, Math.round(n)))
}

interface SettingsState {
  /** Fire native desktop notifications when a background agent needs you. */
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void
  /**
   * How many workspaces stay mounted in the DOM (active + recent).
   * Higher = more memory / faster switch-back. Range 1–5.
   */
  visitedWorkspacesCap: number
  setVisitedWorkspacesCap: (cap: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      visitedWorkspacesCap: VISITED_WORKSPACES_CAP_DEFAULT,
      setVisitedWorkspacesCap: (cap) => set({ visitedWorkspacesCap: clampVisitedCap(cap) })
    }),
    {
      name: 'oxe-settings',
      version: 2,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<SettingsState>
        return {
          notificationsEnabled: s.notificationsEnabled ?? true,
          visitedWorkspacesCap: clampVisitedCap(s.visitedWorkspacesCap ?? VISITED_WORKSPACES_CAP_DEFAULT)
        }
      }
    }
  )
)
