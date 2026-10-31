import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ThemeProvider } from '../../src/components/Theme/ThemeProvider'
import { resolveMode, savedAppearance } from '../../src/design/mode'
import { useSettingsStore } from '../../src/store/settings.store'
import { UI_SCALE_EVENT } from '../../shared/uiScale'

function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = { matches: dark, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  return { flip(next: boolean) { query.matches = next; for (const listener of listeners) listener() } }
}

describe('ThemeProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    act(() => useSettingsStore.getState().setAppearance('system'))
    act(() => { useSettingsStore.getState().setDensity('compact'); useSettingsStore.getState().setUiScale(1) })
    delete (window as { oxe?: unknown }).oxe
    delete document.documentElement.dataset.mode
    delete document.documentElement.dataset.density
  })

  test('applies the density and the mode the person chose', () => {
    mockSystem(false)
    act(() => useSettingsStore.getState().setAppearance('dark'))
    render(<ThemeProvider density="comfortable"><div /></ThemeProvider>)
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(document.documentElement.dataset.density).toBe('comfortable')
    act(() => useSettingsStore.getState().setAppearance('light'))
    expect(document.documentElement.dataset.mode).toBe('light')
  })

  test('follows the app-wide density unless the workspace overrides it', () => {
    mockSystem(false)
    const view = render(<ThemeProvider><div /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe('compact')
    act(() => useSettingsStore.getState().setDensity('comfortable'))
    expect(document.documentElement.dataset.density).toBe('comfortable')
    view.rerender(<ThemeProvider density="default"><div /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe('comfortable')
    view.rerender(<ThemeProvider density="compact"><div /></ThemeProvider>)
    expect(document.documentElement.dataset.density).toBe('compact')
  })

  test('sends the interface scale to the window and tells measured surfaces to refit', async () => {
    mockSystem(false)
    const setUiScale = vi.fn(async (factor: number) => factor)
    ;(window as unknown as { oxe: unknown }).oxe = { app: { setUiScale } }
    const refit = vi.fn()
    window.addEventListener(UI_SCALE_EVENT, refit)
    render(<ThemeProvider><div /></ThemeProvider>)
    await waitFor(() => expect(setUiScale).toHaveBeenLastCalledWith(1))
    act(() => useSettingsStore.getState().setUiScale(1.25))
    await waitFor(() => expect(setUiScale).toHaveBeenLastCalledWith(1.25))
    await waitFor(() => expect(refit).toHaveBeenCalledTimes(2))
    window.removeEventListener(UI_SCALE_EVENT, refit)
  })

  test('follows the operating system in system mode', () => {
    const system = mockSystem(true)
    render(<ThemeProvider><div /></ThemeProvider>)
    expect(document.documentElement.dataset.mode).toBe('dark')
    act(() => system.flip(false))
    expect(document.documentElement.dataset.mode).toBe('light')
  })

  test('resolves and reads the saved choice', () => {
    expect(resolveMode('system', 'dark')).toBe('dark')
    expect(resolveMode('light', 'dark')).toBe('light')
    window.localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: 'dark' }, version: 3 }))
    expect(savedAppearance()).toBe('dark')
    window.localStorage.setItem('oxe-settings', 'not json')
    expect(savedAppearance()).toBe('system')
    window.localStorage.removeItem('oxe-settings')
  })
})
