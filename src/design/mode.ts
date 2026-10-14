/**
 * Light and dark mode. The person chooses system, light or dark; the document
 * root carries the resolved mode as `data-mode`, which the generated tokens
 * read. Monaco and the terminal subscribe to changes through `onModeChange`.
 */
export type Appearance = 'system' | 'light' | 'dark'
export type ColorMode = 'light' | 'dark'

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
