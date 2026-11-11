// Frozen acceptance test for the 1.5.0 F2 gap G2, renderer side (OXE program, phase F2, task FE-G2). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-gaps-FRONTEND.json (FE-G2).
// A 1.4 person may have changed shortcuts for commands 1.5.0 removed (Teams, OxePod, OxePost). Those overrides are
// dropped when Settings load, cause no error and no conflict, and the Keyboard page still renders without them.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const REMOVED = { 'team.open': ['Mod+Shift+T'], 'view.pods': ['Mod+4'], 'view.post': ['Mod+5'], 'oxepod.filter': ['/'], 'oxepost.send': ['Mod+Enter'] }

async function loadSettings(overrides: Record<string, string[]>) {
  localStorage.setItem('oxe-settings', JSON.stringify({ state: { keybindingOverrides: overrides }, version: 7 }))
  const { useSettingsStore } = await import('../../../src/store/settings.store')
  await useSettingsStore.persist.rehydrate()
  return useSettingsStore
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('G2 · keybinding overrides for removed commands are ignored', () => {
  test('overrides that name removed commands are dropped when settings load, and the others stay', async () => {
    const store = await loadSettings({ ...REMOVED, 'view.code': ['Mod+9'] })
    expect(store.getState().keybindingOverrides).toEqual({ 'view.code': ['Mod+9'] })
    const { chordsFor } = await import('../../../src/keyboard/keybindings')
    expect(chordsFor('view.code')).toEqual(['Mod+9'])
  })

  test("a removed command's old chord neither conflicts nor fires", async () => {
    const store = await loadSettings({ ...REMOVED, 'view.code': ['Mod+Shift+T'] })
    expect(store.getState().keybindingOverrides).toEqual({ 'view.code': ['Mod+Shift+T'] })
    const { conflictsFor, dispatchKeybinding, KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(conflictsFor('view.code').map(binding => binding.id as string).filter(id => id in REMOVED)).toEqual([])
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const known = new Set(KEYBINDINGS.map(binding => binding.id as string))
    expect(Object.keys(REMOVED).filter(id => known.has(id))).toEqual([])
    expect(() => dispatchKeybinding(new KeyboardEvent('keydown', { key: '4', ctrlKey: true }))).not.toThrow()
    expect(errors).not.toHaveBeenCalled()
  })

  test('the Keyboard page renders with leftover overrides and counts nothing as customized', async () => {
    await loadSettings(REMOVED)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { KeyboardSettings } = await import('../../../src/components/Settings/KeyboardSettings')
    render(<KeyboardSettings />)
    expect(await screen.findByRole('button', { name: 'Reset all shortcuts' })).toBeDisabled()
    expect(document.body.textContent).not.toMatch(/OxePod|OxePost|Project team/)
    expect(errors).not.toHaveBeenCalled()
  })
})
