import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { setMainLanguage } from '../i18n'
import { clampUiScale } from '../../../shared/uiScale'

export type AppearanceMode = 'system' | 'light' | 'dark'

/** Window background and caption-button colors per resolved mode (surface-canvas and text-secondary). */
const WINDOW_COLORS = {
  light: { background: '#f6f8f7', symbols: '#404742' },
  dark: { background: '#0d100e', symbols: '#c4cdc7' }
} as const

/** The colors a new window starts with, before the renderer reports the person's choice. */
export function initialWindowColors(): (typeof WINDOW_COLORS)['light' | 'dark'] {
  return WINDOW_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
}

function apply(window: BrowserWindow): void {
  const colors = WINDOW_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
  window.setBackgroundColor(colors.background)
  // Only frameless windows with a caption overlay (Windows, Linux) have symbols to recolor.
  if (process.platform !== 'darwin') {
    try { window.setTitleBarOverlay({ color: '#00000000', symbolColor: colors.symbols, height: 36 }) } catch { /* no overlay on this window */ }
  }
}

const scaleFile = (): string => join(app.getPath('userData'), 'ui-scale.json')

/** The interface scale saved last time; new windows start at it (webPreferences.zoomFactor), so there is no 100% flash at boot. */
export function savedUiScale(): number {
  try { return clampUiScale(JSON.parse(readFileSync(scaleFile(), 'utf8'))?.factor) } catch { return 1 }
}

/** Applies a scale to the window that asked and saves it for the next start. Resolves to the factor in effect. */
export function applyUiScale(contents: Electron.WebContents, factor: unknown): number {
  const value = clampUiScale(factor)
  contents.setZoomFactor(value)
  if (value !== savedUiScale()) {
    try { writeFileSync(scaleFile(), JSON.stringify({ factor: value })) } catch { /* the scale still applies to this session */ }
  }
  return value
}

/**
 * The renderer owns the person's choices (system, light or dark; the interface
 * language). The main process mirrors them into Electron's native theme and its
 * own translator, so native menus, dialogs and the caption buttons match.
 */
export function registerAppearanceIpc(): void {
  ipcMain.handle(IPC_CHANNELS.app.setAppearance, (_event, mode: unknown) => {
    const value: AppearanceMode = mode === 'light' || mode === 'dark' ? mode : 'system'
    nativeTheme.themeSource = value
    for (const window of BrowserWindow.getAllWindows()) apply(window)
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })
  ipcMain.handle(IPC_CHANNELS.app.setLanguage, (_event, language: unknown) => { setMainLanguage(language) })
  ipcMain.handle(IPC_CHANNELS.app.setUiScale, (event, factor: unknown) => applyUiScale(event.sender, factor))
  nativeTheme.on('updated', () => { for (const window of BrowserWindow.getAllWindows()) apply(window) })
}
