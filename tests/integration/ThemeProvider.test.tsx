import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ThemeProvider } from '../../src/components/Theme/ThemeProvider'
import { resolveMode, savedAppearance } from '../../src/design/mode'
import { useSettingsStore } from '../../src/store/settings.store'

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
    delete document.documentElement.dataset.mode
    delete document.documentElement.dataset.density
    document.documentElement.classList.remove('dark')
  })

  test('applies the density and the mode the person chose', () => {
    mockSystem(false)
    act(() => useSettingsStore.getState().setAppearance('dark'))
    render(<ThemeProvider density="comfortable"><div /></ThemeProvider>)
    expect(document.documentElement.dataset.mode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.dataset.density).toBe('comfortable')
    act(() => useSettingsStore.getState().setAppearance('light'))
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
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
