import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettings } from '../src/components/Settings/AppearanceSettings'
import { ThemeProvider } from '../src/components/Theme/ThemeProvider'
import { motionPreference, resolveMotion, savedMotion } from '../src/design/motion'
import { tokensCss } from '../src/design/tokens/css'
import { useSettingsStore } from '../src/store/settings.store'

function mockReducedMotion(reduce: boolean) {
  const listeners = new Set<() => void>()
  const query = { matches: reduce, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  vi.stubGlobal('matchMedia', vi.fn((media: string) => media.includes('reduced-motion') ? query : { matches: false, addEventListener() {}, removeEventListener() {} }))
  return { flip(next: boolean) { query.matches = next; for (const listener of listeners) listener() } }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  act(() => useSettingsStore.getState().setMotion('system'))
  delete document.documentElement.dataset.motion
})

describe('motion', () => {
  it('resolves System from the operating system and lets Reduced and Full override it', () => {
    expect(resolveMotion('system', true)).toBe('reduce')
    expect(resolveMotion('system', false)).toBe('full')
    expect(resolveMotion('reduce', false)).toBe('reduce')
    expect(resolveMotion('full', true)).toBe('full')
    expect(motionPreference('fast')).toBe('system')
  })

  it('reads the saved choice before the first paint', () => {
    localStorage.setItem('oxe-settings', JSON.stringify({ state: { motion: 'reduce' }, version: 6 }))
    expect(savedMotion()).toBe('reduce')
    localStorage.setItem('oxe-settings', '{broken')
    expect(savedMotion()).toBe('system')
  })

  it('puts the resolved motion on the root and follows the operating system live in System', () => {
    const system = mockReducedMotion(false)
    render(<ThemeProvider><div /></ThemeProvider>)
    expect(document.documentElement.dataset.motion).toBe('full')
    act(() => system.flip(true))
    expect(document.documentElement.dataset.motion).toBe('reduce')
    act(() => useSettingsStore.getState().setMotion('full'))
    expect(document.documentElement.dataset.motion).toBe('full')
    act(() => useSettingsStore.getState().setMotion('reduce'))
    act(() => system.flip(false))
    expect(document.documentElement.dataset.motion).toBe('reduce')
  })

  it('offers System, Reduced and Full in Settings › Appearance', () => {
    mockReducedMotion(false)
    render(<AppearanceSettings global />)
    fireEvent.click(screen.getByRole('radio', { name: 'Reduced' }))
    expect(useSettingsStore.getState().motion).toBe('reduce')
    expect(screen.getByText(/busy indicators turn slowly/)).toBeVisible()
  })

  it('makes transitions instant and the one spin slow when motion is reduced', () => {
    const css = tokensCss()
    expect(css).toContain(":root[data-motion='reduce'] {\n  --duration-fast: 0ms;\n  --duration-base: 0ms;\n  --duration-slow: 0ms;\n  --duration-spin: 2.4s;\n}")
    expect(css).toContain(':root:not([data-motion])')
    // The global reset still leaves spinners turning (see its :not([class*="spin"]) exclusion).
    const base = readFileSync(join(__dirname, '..', 'src', 'styles', 'base.css'), 'utf8')
    expect(base).toContain(":root[data-motion='reduce'] body *:not([class*=\"spin\"])")
  })
})
