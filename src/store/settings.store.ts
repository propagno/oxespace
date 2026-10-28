import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Appearance } from '../design/mode'

/**
 * General app preferences, persisted to localStorage (OXESpace has no global
 * settings backend yet). Keep this lean — feature-specific prefs live in their
 * own stores (e.g. voice.store).
 */
export const VISITED_WORKSPACES_CAP_MIN = 1
// Raised from 5/3 once eviction stopped killing shells: keeping a workspace
// mounted now only costs render resources (bounded separately by the WebGL
// pane budget), not a respawn on return. The old default of 3 meant a user
// with 4-5 projects paid a shell restart on nearly every switch.
export const VISITED_WORKSPACES_CAP_MAX = 8
export const VISITED_WORKSPACES_CAP_DEFAULT = 5

function clampVisitedCap(n: number): number {
  if (!Number.isFinite(n)) return VISITED_WORKSPACES_CAP_DEFAULT
  return Math.min(VISITED_WORKSPACES_CAP_MAX, Math.max(VISITED_WORKSPACES_CAP_MIN, Math.round(n)))
}

function cleanOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every(chord => typeof chord === 'string')))
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
  /** Light or dark mode, or follow the operating system. */
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
  /** Settings › Keyboard: chords per keybinding id; an empty list turns the shortcut off. */
  keybindingOverrides: Record<string, string[]>
  /** `null` returns the shortcut to its default. */
  setKeybindingOverride: (id: string, chords: string[] | null) => void
  resetKeybindings: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      visitedWorkspacesCap: VISITED_WORKSPACES_CAP_DEFAULT,
      setVisitedWorkspacesCap: (cap) => set({ visitedWorkspacesCap: clampVisitedCap(cap) }),
      appearance: 'system',
      setAppearance: (appearance) => set({ appearance }),
      keybindingOverrides: {},
      setKeybindingOverride: (id, chords) => set(state => {
        const next = { ...state.keybindingOverrides }
        if (chords) next[id] = chords
        else delete next[id]
        return { keybindingOverrides: next }
      }),
      resetKeybindings: () => set({ keybindingOverrides: {} })
    }),
    {
      name: 'oxe-settings',
      version: 4,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<SettingsState>
        return {
          notificationsEnabled: s.notificationsEnabled ?? true,
          visitedWorkspacesCap: clampVisitedCap(s.visitedWorkspacesCap ?? VISITED_WORKSPACES_CAP_DEFAULT),
          appearance: s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : 'system',
          keybindingOverrides: cleanOverrides(s.keybindingOverrides)
        }
      }
    }
  )
)
