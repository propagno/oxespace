// Frozen acceptance test for 1.5.0 A7 after the removals (DESIGN U3.4, OXE program, phase F3, task FE-A7). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f3-design.md (U3.4).
// Contract: src/components/Settings/SettingsCenter.tsx exports APPLICATION_SETTINGS_PAGES (the application pages in order,
// each { id, label, hint }) and searchSettingsPages(query) (what the Settings search shows, both scopes). The workspace
// pages are SETTINGS_PAGES (src/components/Workspace/workspaceSettingsPages.ts).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

type Page = { id: string; label: string; hint?: string }

// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(() => { cleanup(); localStorage.clear() })

describe('U3.4 · Settings after the removals', () => {
  test("the application pages are listed in DESIGN's order", async () => {
    const { APPLICATION_SETTINGS_PAGES } = await import('../../../src/components/Settings/SettingsCenter') as unknown as { APPLICATION_SETTINGS_PAGES: readonly Page[] }
    expect(APPLICATION_SETTINGS_PAGES.map(page => page.label)).toEqual([
      'General', 'Appearance', 'Agents', 'Approvals and safety', 'Notifications', 'Keyboard', 'Terminal', 'MCP servers and skills',
      'Phone and devices', 'Data and privacy', 'Agent activity', 'Diagnostics', 'About'
    ])
  })

  test('the workspace pages are General, Projects and Policy, with no Memory page', async () => {
    const { SETTINGS_PAGES } = await import('../../../src/components/Workspace/workspaceSettingsPages')
    expect((SETTINGS_PAGES as readonly Page[]).map(page => page.label)).toEqual(['General', 'Projects', 'Policy'])
  })

  test('the Settings search finds export, activity and skills', async () => {
    const { searchSettingsPages } = await import('../../../src/components/Settings/SettingsCenter') as unknown as { searchSettingsPages: (query: string) => Page[] }
    expect(searchSettingsPages('export').map(page => page.label)).toContain('Data and privacy')
    expect(searchSettingsPages('activity').map(page => page.label)).toContain('Agent activity')
    expect(searchSettingsPages('skills').map(page => page.label)).toContain('MCP servers and skills')
    expect(searchSettingsPages('automations')).toEqual([])
    expect(searchSettingsPages('memory').map(page => page.label)).not.toContain('Memory')
  })

  test('Reset all shortcuts shows an undo toast, and Undo brings the custom chords back', async () => {
    const { useSettingsStore } = await import('../../../src/store/settings.store')
    act(() => useSettingsStore.getState().setKeybindingOverride('view.code', ['Mod+9']))
    const { KeyboardSettings } = await import('../../../src/components/Settings/KeyboardSettings')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><KeyboardSettings /><Toaster /></>)
    await userEvent.click(await screen.findByRole('button', { name: 'Reset all shortcuts' }))
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({})
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(useSettingsStore.getState().keybindingOverrides).toEqual({ 'view.code': ['Mod+9'] }))
  })

  test('the Keyboard page lists no removed shortcut', async () => {
    const { KeyboardSettings } = await import('../../../src/components/Settings/KeyboardSettings')
    render(<KeyboardSettings />)
    await screen.findByRole('button', { name: 'Reset all shortcuts' })
    expect(document.body.textContent).not.toMatch(/OxePod|OxePost|Project team|Open the project team/)
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.map(binding => binding.id as string).filter(id => /^(team\.|view\.pods$|view\.post$|oxepod\.|oxepost\.)/.test(id))).toEqual([])
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+Shift+T')).map(binding => binding.id)).toEqual([])
  })

  // U3.4b: every row that widens what agents can do applies at once, shows the undo toast, and Undo restores the value
  // before it. The rows are the registry the Settings pages build them from (#649's risk list R1–R10; R5 is OxeQuery's
  // connection dialog and has its own test). Each entry's widen() goes through the same applyWithUndo the row's control
  // calls, and read() returns the value the row shows.
  const RISKY = ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R8', 'R9', 'R10'] as const
  test.each(RISKY)('risky row %s shows the undo toast, and Undo restores the value before it', async id => {
    // Every call to main resolves; what the row shows is its own applied state.
    const deep = (): unknown => new Proxy(async () => undefined, { get: (_target, key) => key === 'then' ? undefined : deep() })
    Object.assign(window, { oxe: deep() })
    const { RISKY_SETTING_ROWS } = await load<{ RISKY_SETTING_ROWS: ReadonlyArray<{ id: string; label: string; read(): unknown | Promise<unknown>; widen(): Promise<void> }> }>('src/components/Settings/riskyRows')
    const row = RISKY_SETTING_ROWS.find(entry => entry.id === id)
    expect(row, `${id} is in the registry`).toBeTruthy()
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<Toaster />)
    const before = await row!.read()
    await act(async () => { await row!.widen() })
    expect(await row!.read()).not.toEqual(before)
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect(await row!.read()).toEqual(before))
  })
})
