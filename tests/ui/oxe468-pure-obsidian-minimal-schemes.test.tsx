import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '../../src/components/Settings/AppearanceSettings'
import { buildTerminalTheme } from '../../src/components/Terminal/terminalViewHelpers'
import { ThemeProvider } from '../../src/components/Theme/ThemeProvider'
import {
  applyColorScheme,
  applyMode,
  applySurfaceStyle,
  COLOR_SCHEMES,
  colorSchemePreference,
  currentColorScheme,
  onColorSchemeChange,
  savedColorScheme,
  type ColorScheme
} from '../../src/design/mode'
import { schemeColorRoles } from '../../src/design/tokens/schemes'
import { defineMonacoTheme, followMonacoTheme, MONACO_THEME } from '../../src/lib/monacoTheme'
import { useSettingsStore } from '../../src/store/settings.store'
import type { Monaco } from '@monaco-editor/react'

const SCHEME_LABELS: Record<ColorScheme, string> = {
  default: 'Minimal',
  obsidian: 'Obsidian',
  flexoki: 'Flexoki',
  nord: 'Nord',
  catppuccin: 'Catppuccin',
  dracula: 'Dracula',
  gruvbox: 'Gruvbox',
  solarized: 'Solarized'
}

afterEach(() => {
  cleanup()
  act(() => {
    useSettingsStore.getState().setAppearance('system')
    useSettingsStore.getState().setSurfaceStyle('default')
    useSettingsStore.getState().setColorScheme('default')
  })
  window.localStorage.removeItem('oxe-settings')
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.surface
  delete document.documentElement.dataset.scheme
})

describe('OXE-468 · Pure kepano/obsidian-minimal color schemes, Settings UI & live sync', () => {
  it('renders all 8 official Minimal color schemes in Settings › Appearance and updates data-scheme live', async () => {
    render(
      <ThemeProvider>
        <AppearanceSettings global />
      </ThemeProvider>
    )

    const group = screen.getByRole('radiogroup', { name: 'Color scheme' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(COLOR_SCHEMES.length)
    expect(within(group).getByRole('radio', { name: 'Minimal' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.dataset.scheme).toBe('default')

    for (const id of COLOR_SCHEMES) {
      const radio = within(group).getByRole('radio', { name: SCHEME_LABELS[id] })
      expect(radio.querySelector(`[data-scheme="${id}"]`)).not.toBeNull()
      fireEvent.click(radio)
      expect(useSettingsStore.getState().colorScheme).toBe(id)
      expect(radio).toHaveAttribute('aria-checked', 'true')
      expect(document.documentElement.dataset.scheme).toBe(id)
      // Mode preview cards reflect the selected scheme live.
      const darkPreview = document.querySelector(`[data-preview="dark"] [data-scheme="${id}"]`)
      expect(darkPreview).not.toBeNull()
    }
  })

  it('persists colorScheme in settings.store (v10) and migrates safely from older versions', async () => {
    expect(useSettingsStore.persist.getOptions().version).toBeGreaterThanOrEqual(10)
    const migrate = useSettingsStore.persist.getOptions().migrate!
    const fromV9 = await migrate({ appearance: 'dark', surfaceStyle: 'pure' }, 9) as { colorScheme: ColorScheme; surfaceStyle: string }
    expect(fromV9.colorScheme).toBe('default')
    expect(fromV9.surfaceStyle).toBe('pure')

    const fromInvalid = await migrate({ colorScheme: 'mandacaru-legacy' }, 9) as { colorScheme: ColorScheme }
    expect(fromInvalid.colorScheme).toBe('default')

    const fromNord = await migrate({ colorScheme: 'nord' }, 9) as { colorScheme: ColorScheme }
    expect(fromNord.colorScheme).toBe('nord')

    window.localStorage.setItem('oxe-settings', JSON.stringify({ state: { colorScheme: 'flexoki' }, version: 10 }))
    expect(savedColorScheme()).toBe('flexoki')
    window.localStorage.setItem('oxe-settings', JSON.stringify({ state: { colorScheme: 'bogus' }, version: 10 }))
    expect(savedColorScheme()).toBe('default')
    expect(colorSchemePreference('solarized')).toBe('solarized')
    expect(colorSchemePreference(null)).toBe('default')
  })

  it('notifies subscribers via onColorSchemeChange and syncs Monaco and xterm.js live across all 8 schemes', async () => {
    const seen: ColorScheme[] = []
    const unsubScheme = onColorSchemeChange(scheme => seen.push(scheme))

    const defineTheme = vi.fn()
    const setTheme = vi.fn()
    const fakeMonaco = { editor: { defineTheme, setTheme } } as unknown as Monaco

    applyMode('dark')
    applySurfaceStyle('default')
    applyColorScheme('default')
    const stopMonaco = followMonacoTheme(fakeMonaco)
    expect(defineTheme).toHaveBeenCalledTimes(1)
    expect(setTheme).toHaveBeenCalledWith(MONACO_THEME)

    for (const id of COLOR_SCHEMES) {
      applyColorScheme(id)
      expect(currentColorScheme()).toBe(id)
      const roles = schemeColorRoles(id, 'dark', 'default')

      // xterm.js reflects scheme terminal surface, foreground & cursor accent
      const xterm = buildTerminalTheme(false)
      expect(xterm.background, `${id} xterm background`).toBe(roles['term-bg'])
      expect(xterm.foreground, `${id} xterm foreground`).toBe(roles['term-fg'])
      expect(xterm.cursor, `${id} xterm cursor`).toBe(roles.accent)

      // Monaco reflects scheme editor canvas, foreground & cursor accent
      defineTheme.mockClear()
      defineMonacoTheme(fakeMonaco)
      const [, themeDef] = defineTheme.mock.calls[0] as [string, { base: string; colors: Record<string, string> }]
      expect(themeDef.base).toBe('vs-dark')
      expect(themeDef.colors['editor.background'], `${id} monaco bg`).toBe(roles['surface-base'])
      expect(themeDef.colors['editor.foreground'], `${id} monaco fg`).toBe(roles['text-primary'])
      expect(themeDef.colors['editorCursor.foreground'], `${id} monaco cursor`).toBe(roles.accent)
    }

    // MutationObserver fires asynchronously after the last synchronous scheme change ('solarized').
    await waitFor(() => expect(seen).toContain('solarized'))
    await waitFor(() => expect(setTheme.mock.calls.length).toBeGreaterThan(1))

    // Switching to True Black OLED overrides background cleanly on non-default schemes too
    applyColorScheme('nord')
    applySurfaceStyle('pure')
    const nordPureTerm = buildTerminalTheme(false)
    expect(nordPureTerm.background).toBe('#000000')
    expect(nordPureTerm.cursor).toBe(schemeColorRoles('nord', 'dark', 'pure').accent)

    await waitFor(() => expect(seen).toContain('nord'))
    stopMonaco()
    unsubScheme()
  })
})
