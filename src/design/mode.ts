/**
 * Light and dark mode, plus the Obsidian Minimal surface style (`default` vs
 * `pure` True Black OLED / Pure White). The document root carries `data-mode`
 * and `data-surface`, which the generated tokens read. Monaco and the terminal
 * subscribe to changes through `onModeChange` and `onSurfaceStyleChange`.
 */
import type { SurfaceStyle } from './tokens/semantic'

export type Appearance = 'system' | 'light' | 'dark'
export type ColorMode = 'light' | 'dark'
export type { SurfaceStyle }

const SETTINGS_KEY = 'oxe-settings'

export function systemMode(): ColorMode {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveMode(appearance: Appearance, system: ColorMode = systemMode()): ColorMode {
  return appearance === 'system' ? system : appearance
}

export function currentMode(): ColorMode {
  return document.documentElement.dataset.mode === 'dark' ? 'dark' : 'light'
}

export function applyMode(mode: ColorMode): void {
  const root = document.documentElement
  if (root.dataset.mode === mode) return
  root.dataset.mode = mode
}

/** The saved choice, read synchronously before the first paint so the app never flashes the wrong mode. */
export function savedAppearance(): Appearance {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const value = raw ? (JSON.parse(raw) as { state?: { appearance?: unknown } }).state?.appearance : undefined
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch { return 'system' }
}

/** Calls `listener` whenever the resolved mode changes; returns the unsubscribe function. */
export function onModeChange(listener: (mode: ColorMode) => void): () => void {
  const observer = new MutationObserver(() => listener(currentMode()))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
  return () => observer.disconnect()
}

export function surfaceStylePreference(value: unknown): SurfaceStyle {
  return value === 'pure' ? 'pure' : 'default'
}

export function currentSurfaceStyle(): SurfaceStyle {
  return document.documentElement.dataset.surface === 'pure' ? 'pure' : 'default'
}

export function applySurfaceStyle(surface: SurfaceStyle): void {
  const root = document.documentElement
  if (root.dataset.surface === surface) return
  root.dataset.surface = surface
}

/** The saved surface preset, read synchronously before the first paint so the app never flashes. */
export function savedSurfaceStyle(): SurfaceStyle {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const value = raw ? (JSON.parse(raw) as { state?: { surfaceStyle?: unknown } }).state?.surfaceStyle : undefined
    return surfaceStylePreference(value)
  } catch { return 'default' }
}

/** Calls `listener` whenever `data-surface` changes; returns the unsubscribe function. */
export function onSurfaceStyleChange(listener: (surface: SurfaceStyle) => void): () => void {
  const observer = new MutationObserver(() => listener(currentSurfaceStyle()))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-surface'] })
  return () => observer.disconnect()
}
