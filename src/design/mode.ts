/**
 * Light and dark mode, the Obsidian Minimal surface style (`default` vs `pure`
 * True Black OLED / Pure White), and the active Minimal color scheme
 * (`default`, `obsidian`, `flexoki`, `nord`, `catppuccin`, `dracula`,
 * `gruvbox`, `solarized`). The document root carries `data-mode`,
 * `data-surface`, and `data-scheme`, which the generated tokens read. Monaco
 * and the terminal subscribe to changes through `onModeChange`,
 * `onSurfaceStyleChange`, and `onColorSchemeChange`.
 */
import { COLOR_SCHEMES, type ColorScheme } from './tokens/schemeIds'
import type { SurfaceStyle } from './tokens/semantic'

export { COLOR_SCHEMES }
export type Appearance = 'system' | 'light' | 'dark'
export type ColorMode = 'light' | 'dark'
export type { ColorScheme, SurfaceStyle }

const SETTINGS_KEY = 'oxe-settings'
const COLOR_SCHEME_SET = new Set<string>(COLOR_SCHEMES)

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

export function colorSchemePreference(value: unknown): ColorScheme {
  return typeof value === 'string' && COLOR_SCHEME_SET.has(value) ? (value as ColorScheme) : 'default'
}

export function currentColorScheme(): ColorScheme {
  return colorSchemePreference(document.documentElement.dataset.scheme)
}

export function applyColorScheme(scheme: ColorScheme): void {
  const root = document.documentElement
  const next = colorSchemePreference(scheme)
  if (root.dataset.scheme === next) return
  root.dataset.scheme = next
}

/** The saved Minimal color scheme, read synchronously before the first paint so the app never flashes. */
export function savedColorScheme(): ColorScheme {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    const value = raw ? (JSON.parse(raw) as { state?: { colorScheme?: unknown } }).state?.colorScheme : undefined
    return colorSchemePreference(value)
  } catch { return 'default' }
}

/** Calls `listener` whenever `data-scheme` changes; returns the unsubscribe function. */
export function onColorSchemeChange(listener: (scheme: ColorScheme) => void): () => void {
  const observer = new MutationObserver(() => listener(currentColorScheme()))
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme'] })
  return () => observer.disconnect()
}
