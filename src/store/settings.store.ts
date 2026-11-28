import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { colorSchemePreference, surfaceStylePreference, type Appearance, type ColorScheme, type SurfaceStyle } from '../design/mode'
import { isLanguagePreference, type LanguagePreference } from '../../shared/i18n'
import { motionPreference, type MotionPreference } from '../design/motion'
import type { UiDensity } from '../../shared/types/workspace'
import { clampUiScale, UI_SCALE_DEFAULT } from '../../shared/uiScale'
import { KEYBINDINGS } from '../keyboard/keybindings'

/**
 * General app preferences, persisted to localStorage (OXESpace has no global
 * settings backend yet). Keep this lean — feature-specific prefs live in their
 * own stores (e.g. terminal-prefs.store).
 */
export const VISITED_WORKSPACES_CAP_MIN = 1
// Raised from 5/3 once eviction stopped killing shells: keeping a workspace
// mounted now only costs render resources (bounded separately by the WebGL
// pane budget), not a respawn on return. The old default of 3 meant a user
// with 4-5 projects paid a shell restart on nearly every switch.
export const VISITED_WORKSPACES_CAP_MAX = 8
export const VISITED_WORKSPACES_CAP_DEFAULT = 5

/** When a category of desktop notification should fire (OXE-479). */
export type NotificationTriggerMode = 'off' | 'unfocused' | 'always'
export const NOTIFICATION_TRIGGER_MODES: readonly NotificationTriggerMode[] = ['off', 'unfocused', 'always']
export const APPROVAL_NOTIFY_DEFAULT: NotificationTriggerMode = 'unfocused'
export const COMPLETION_NOTIFY_DEFAULT: NotificationTriggerMode = 'unfocused'

export function isNotificationTriggerMode(value: unknown): value is NotificationTriggerMode {
  return value === 'off' || value === 'unfocused' || value === 'always'
}

/** Evaluates master desktop notification switch + per-category trigger mode against whether the target is being watched. */
export function shouldSendDesktopNotification(
  notificationsEnabled: boolean,
  mode: NotificationTriggerMode,
  watching: boolean
): boolean {
  if (!notificationsEnabled || mode === 'off') return false
  if (mode === 'always') return true
  return !watching
}

function clampVisitedCap(n: number): number {
  if (!Number.isFinite(n)) return VISITED_WORKSPACES_CAP_DEFAULT
  return Math.min(VISITED_WORKSPACES_CAP_MAX, Math.max(VISITED_WORKSPACES_CAP_MIN, Math.round(n)))
}

function cleanOverrides(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {}
  const validIds = new Set(KEYBINDINGS.map(binding => binding.id as string))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string[]] => validIds.has(entry[0]) && Array.isArray(entry[1]) && entry[1].every(chord => typeof chord === 'string')))
}

interface SettingsState {
  /** Fire native desktop notifications when a background agent needs you. */
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => void
  /** Desktop notification trigger when an agent needs approval or input (OXE-479). */
  approvalNotifyMode: NotificationTriggerMode
  setApprovalNotifyMode: (mode: NotificationTriggerMode) => void
  /** Desktop notification trigger when a turn or agent finishes (OXE-479). */
  completionNotifyMode: NotificationTriggerMode
  setCompletionNotifyMode: (mode: NotificationTriggerMode) => void
  /** Play the sound when an agent finishes (OXE-130); "needs you" always plays it. Off by factory default. */
  finishSound: boolean
  setFinishSound: (enabled: boolean) => void
  /**
   * How many workspaces stay mounted in the DOM (active + recent).
   * Higher = more memory / faster switch-back. Range 1–5.
   */
  visitedWorkspacesCap: number
  setVisitedWorkspacesCap: (cap: number) => void
  /** Light or dark mode, or follow the operating system. */
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
  /** Minimal surface preset: default graphite/soft-chrome or pure True Black OLED / Pure White. */
  surfaceStyle: SurfaceStyle
  setSurfaceStyle: (surfaceStyle: SurfaceStyle) => void
  /** Official kepano/obsidian-minimal color scheme (`default`, `obsidian`, `flexoki`, `nord`, `catppuccin`, `dracula`, `gruvbox`, `solarized`). */
  colorScheme: ColorScheme
  setColorScheme: (colorScheme: ColorScheme) => void
  /** Interface language, or follow the operating system (src/i18n applies it). */
  language: LanguagePreference
  setLanguage: (language: LanguagePreference) => void
  /** Interface scale (window zoom), 0.9–1.25. */
  uiScale: number
  setUiScale: (scale: number) => void
  /** App-wide density; a workspace or the Thread list may override it. */
  density: UiDensity
  setDensity: (density: UiDensity) => void
  /** Animation: follow the operating system, keep it to a minimum, or always play it. */
  motion: MotionPreference
  setMotion: (motion: MotionPreference) => void
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
      approvalNotifyMode: APPROVAL_NOTIFY_DEFAULT,
      setApprovalNotifyMode: (approvalNotifyMode) => set({ approvalNotifyMode: isNotificationTriggerMode(approvalNotifyMode) ? approvalNotifyMode : APPROVAL_NOTIFY_DEFAULT }),
      completionNotifyMode: COMPLETION_NOTIFY_DEFAULT,
      setCompletionNotifyMode: (completionNotifyMode) => set({ completionNotifyMode: isNotificationTriggerMode(completionNotifyMode) ? completionNotifyMode : COMPLETION_NOTIFY_DEFAULT }),
      finishSound: false,
      setFinishSound: (finishSound) => set({ finishSound: finishSound === true }),
      visitedWorkspacesCap: VISITED_WORKSPACES_CAP_DEFAULT,
      setVisitedWorkspacesCap: (cap) => set({ visitedWorkspacesCap: clampVisitedCap(cap) }),
      appearance: 'system',
      setAppearance: (appearance) => set({ appearance }),
      surfaceStyle: 'default',
      setSurfaceStyle: (surfaceStyle) => set({ surfaceStyle: surfaceStylePreference(surfaceStyle) }),
      colorScheme: 'default',
      setColorScheme: (colorScheme) => set({ colorScheme: colorSchemePreference(colorScheme) }),
      language: 'system',
      setLanguage: (language) => set({ language }),
      uiScale: UI_SCALE_DEFAULT,
      setUiScale: (scale) => set({ uiScale: clampUiScale(scale) }),
      density: 'compact',
      setDensity: (density) => set({ density: density === 'comfortable' ? 'comfortable' : 'compact' }),
      motion: 'system',
      setMotion: (motion) => set({ motion: motionPreference(motion) }),
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
      version: 11,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Partial<SettingsState>
        return {
          notificationsEnabled: s.notificationsEnabled ?? true,
          approvalNotifyMode: isNotificationTriggerMode(s.approvalNotifyMode) ? s.approvalNotifyMode : APPROVAL_NOTIFY_DEFAULT,
          completionNotifyMode: isNotificationTriggerMode(s.completionNotifyMode) ? s.completionNotifyMode : COMPLETION_NOTIFY_DEFAULT,
          finishSound: s.finishSound === true,
          visitedWorkspacesCap: clampVisitedCap(s.visitedWorkspacesCap ?? VISITED_WORKSPACES_CAP_DEFAULT),
          appearance: s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : 'system',
          surfaceStyle: surfaceStylePreference(s.surfaceStyle),
          colorScheme: colorSchemePreference(s.colorScheme),
          language: isLanguagePreference(s.language) ? s.language : 'system',
          uiScale: clampUiScale(s.uiScale ?? UI_SCALE_DEFAULT),
          density: s.density === 'comfortable' ? 'comfortable' : 'compact',
          motion: motionPreference(s.motion),
          keybindingOverrides: cleanOverrides(s.keybindingOverrides)
        }
      },
      merge: (persistedState, currentState) => {
        const s = (persistedState ?? {}) as Partial<SettingsState>
        return {
          ...currentState,
          ...s,
          approvalNotifyMode: isNotificationTriggerMode(s.approvalNotifyMode) ? s.approvalNotifyMode : APPROVAL_NOTIFY_DEFAULT,
          completionNotifyMode: isNotificationTriggerMode(s.completionNotifyMode) ? s.completionNotifyMode : COMPLETION_NOTIFY_DEFAULT,
          surfaceStyle: surfaceStylePreference(s.surfaceStyle),
          colorScheme: colorSchemePreference(s.colorScheme),
          keybindingOverrides: cleanOverrides(s.keybindingOverrides)
        }
      }
    }
  )
)
