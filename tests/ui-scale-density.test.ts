import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clampUiScale, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEPS } from '../shared/uiScale'
import { resolveDensity } from '../src/design/density'

beforeEach(() => { localStorage.clear(); vi.resetModules() })

describe('interface scale', () => {
  it('clamps to 90%–125% and rounds to whole percents', () => {
    expect(clampUiScale(1.1)).toBe(1.1)
    expect(clampUiScale(0.5)).toBe(UI_SCALE_MIN)
    expect(clampUiScale(3)).toBe(UI_SCALE_MAX)
    expect(clampUiScale(1.104)).toBe(1.1)
    for (const bad of [Number.NaN, Infinity, '1.2', null, undefined, {}]) expect(clampUiScale(bad)).toBe(1)
    expect(UI_SCALE_STEPS.every(step => clampUiScale(step) === step)).toBe(true)
  })
})

describe('density', () => {
  it('lets a workspace or the Thread list override the app-wide density', () => {
    expect(resolveDensity(undefined, 'comfortable')).toBe('comfortable')
    expect(resolveDensity(null, 'compact')).toBe('compact')
    expect(resolveDensity('default', 'comfortable')).toBe('comfortable')
    expect(resolveDensity('compact', 'comfortable')).toBe('compact')
    expect(resolveDensity('comfortable', 'compact')).toBe('comfortable')
  })

  it('upgrades saved settings with a 100% scale and compact density, and clamps what it is given', async () => {
    localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: 'dark', notificationsEnabled: false, visitedWorkspacesCap: 5 }, version: 3 }))
    const { useSettingsStore } = await import('../src/store/settings.store')
    expect(useSettingsStore.getState()).toMatchObject({ appearance: 'dark', notificationsEnabled: false, uiScale: 1, density: 'compact' })
    useSettingsStore.getState().setUiScale(2)
    useSettingsStore.getState().setDensity('comfortable')
    expect(JSON.parse(localStorage.getItem('oxe-settings')!).state).toMatchObject({ uiScale: 1.25, density: 'comfortable' })
  })

  it('keeps the Thread list override, including following the app after a reset', async () => {
    localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width: 280, expanded: {}, threadDensity: null }, version: 0 }))
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    expect(useNavigationPrefs.getState().threadDensity).toBeNull()
  })

  it('ships the Thread list as comfortable when nothing is saved', async () => {
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    expect(useNavigationPrefs.getState().threadDensity).toBe('comfortable')
  })
})
