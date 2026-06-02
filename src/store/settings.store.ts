import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * General app preferences, persisted to localStorage (OXESpace has no global
 * settings backend yet). Keep this lean — feature-specific prefs live in their
 * own stores (e.g. voice.store).
 */
interface SettingsState {
  /** Fire native desktop notifications when a background agent needs you. */
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled })
    }),
    { name: 'oxe-settings' }
  )
)
