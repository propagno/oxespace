import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The persisted store lives in localStorage under this key (zustand persist).
const KEY = 'oxe-terminal-prefs'

describe('terminal-prefs opt-in migration (v1 → v2)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules() // fresh store instance per test so persist re-hydrates
  })
  afterEach(() => localStorage.clear())

  test('resets RTK + Semantic to off for a user who had them on (the reported bug)', async () => {
    // Simulate the user's saved state from when RTK/Semantic defaulted to ON.
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      state: {
        global: { fontSize: 16, rtkHookEnabled: true, cavemanModeEnabled: false, semanticSearchEnabled: true },
        overrides: {
          'ws-on': { semanticSearchEnabled: true, rtkHookEnabled: true, fontSize: 18 },
          'ws-rtk-only': { rtkHookEnabled: true }
        }
      }
    }))

    const { useTerminalPrefsStore } = await import('../../src/store/terminal-prefs.store')
    const s = useTerminalPrefsStore.getState()

    // Global: the two opt-in flags are forced off…
    expect(s.global.rtkHookEnabled).toBe(false)
    expect(s.global.semanticSearchEnabled).toBe(false)
    expect(s.global.cavemanModeEnabled).toBe(false)
    // …but unrelated saved prefs are preserved.
    expect(s.global.fontSize).toBe(16)

    // Per-workspace overrides: the opt-in keys are stripped, others kept.
    expect(s.overrides['ws-on']).toEqual({ fontSize: 18 })
    expect(s.overrides['ws-rtk-only']).toBeUndefined() // only had rtk → dropped
  })

  test('fresh install (no persisted state) starts with all three off', async () => {
    const { useTerminalPrefsStore } = await import('../../src/store/terminal-prefs.store')
    const s = useTerminalPrefsStore.getState()
    expect(s.global.rtkHookEnabled).toBe(false)
    expect(s.global.cavemanModeEnabled).toBe(false)
    expect(s.global.semanticSearchEnabled).toBe(false)
  })

  test('a workspace with no override resolves to the off global default', async () => {
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      state: { global: { rtkHookEnabled: true, semanticSearchEnabled: true }, overrides: {} }
    }))
    const { useTerminalPrefsStore } = await import('../../src/store/terminal-prefs.store')
    const s = useTerminalPrefsStore.getState()
    const resolved = { ...s.global, ...(s.overrides['brand-new-ws'] ?? {}) }
    expect(resolved.rtkHookEnabled).toBe(false)
    expect(resolved.semanticSearchEnabled).toBe(false)
  })
})
