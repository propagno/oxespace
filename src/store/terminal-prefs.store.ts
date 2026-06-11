import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

/**
 * Terminal appearance/behavior preferences (Horizon 1 — terminal customization).
 *
 * Scope: a single GLOBAL default plus optional PER-WORKSPACE overrides. The
 * resolver merges global ← override so a workspace only stores the keys it
 * actually changes. Persisted to localStorage (OXESpace has no global settings
 * backend yet); colors are NOT here — those follow the workspace theme.
 */

export type TerminalCursorStyle = 'block' | 'bar' | 'underline'

export interface TerminalPrefs {
  fontFamily: string
  fontSize: number
  lineHeight: number
  letterSpacing: number
  cursorStyle: TerminalCursorStyle
  cursorBlink: boolean
  scrollback: number
  rtkHookEnabled: boolean
  cavemanModeEnabled: boolean
  semanticSearchEnabled: boolean
}

export const TERMINAL_PREFS_DEFAULTS: TerminalPrefs = {
  fontFamily: 'Cascadia Mono, Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 100_000,
  // RTK, Caveman and Semantic are opt-in developer features — off by default so
  // a fresh workspace does no extra token transforms or background indexing.
  // The user enables them via the toolbar chips when wanted.
  rtkHookEnabled: false,
  cavemanModeEnabled: false,
  semanticSearchEnabled: false
}

export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 32

interface TerminalPrefsState {
  global: TerminalPrefs
  /** Per-workspace partial overrides keyed by workspaceId. */
  overrides: Record<string, Partial<TerminalPrefs>>
  setGlobal: (patch: Partial<TerminalPrefs>) => void
  /** Set a single override key; pass `undefined` to fall back to global. */
  setOverride: <K extends keyof TerminalPrefs>(workspaceId: string, key: K, value: TerminalPrefs[K] | undefined) => void
  clearOverrides: (workspaceId: string) => void
}

export const useTerminalPrefsStore = create<TerminalPrefsState>()(
  persist(
    (set) => ({
      global: TERMINAL_PREFS_DEFAULTS,
      overrides: {},
      setGlobal: (patch) => set((s) => ({ global: { ...s.global, ...patch } })),
      setOverride: (workspaceId, key, value) =>
        set((s) => {
          const current = { ...(s.overrides[workspaceId] ?? {}) }
          if (value === undefined) delete current[key]
          else current[key] = value
          const overrides = { ...s.overrides }
          if (Object.keys(current).length === 0) delete overrides[workspaceId]
          else overrides[workspaceId] = current
          return { overrides }
        }),
      clearOverrides: (workspaceId) =>
        set((s) => {
          if (!s.overrides[workspaceId]) return s
          const overrides = { ...s.overrides }
          delete overrides[workspaceId]
          return { overrides }
        })
    }),
    {
      name: 'oxe-terminal-prefs',
      version: 2,
      // v2: RTK/Caveman/Semantic became opt-in (off by default). Existing users
      // have a persisted `global` from when RTK/Semantic defaulted to ON, and
      // `merge` spreads persisted over defaults — so without this migration the
      // old always-on values would stick. Reset those two flags once (in the
      // global default and in any per-workspace override) so a fresh workspace
      // starts with them off; the user re-enables per workspace via the chips.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<TerminalPrefsState>
        const global = { ...TERMINAL_PREFS_DEFAULTS, ...(p.global ?? {}) }
        global.rtkHookEnabled = false
        global.semanticSearchEnabled = false
        const overrides: Record<string, Partial<TerminalPrefs>> = {}
        for (const [ws, ov] of Object.entries(p.overrides ?? {})) {
          const next = { ...(ov as Partial<TerminalPrefs>) }
          delete next.rtkHookEnabled
          delete next.semanticSearchEnabled
          if (Object.keys(next).length > 0) overrides[ws] = next
        }
        return { ...p, global, overrides }
      },
      // Merge persisted partials over defaults so a new pref key added in a
      // future version still has a value for users with older saved state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TerminalPrefsState>
        return {
          ...current,
          global: { ...TERMINAL_PREFS_DEFAULTS, ...(p.global ?? {}) },
          overrides: p.overrides ?? {}
        }
      }
    }
  )
)

/** Merge global ← per-workspace override into the effective prefs (reactive). */
export function useResolvedTerminalPrefs(workspaceId: string): TerminalPrefs {
  return useTerminalPrefsStore(
    useShallow((s) => ({ ...s.global, ...(s.overrides[workspaceId] ?? {}) }))
  )
}
