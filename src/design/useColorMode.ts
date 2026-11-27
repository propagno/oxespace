import { useSyncExternalStore } from 'react'
import {
  currentColorScheme,
  currentMode,
  currentSurfaceStyle,
  onColorSchemeChange,
  onModeChange,
  onSurfaceStyleChange,
  type ColorMode,
  type ColorScheme,
  type SurfaceStyle
} from './mode'

/** The resolved light or dark mode; re-renders when it changes. */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(onModeChange, currentMode, () => 'light')
}

/** The active surface preset (`default` or `pure`); re-renders when it changes. */
export function useSurfaceStyle(): SurfaceStyle {
  return useSyncExternalStore(onSurfaceStyleChange, currentSurfaceStyle, () => 'default')
}

/** The active Obsidian Minimal color scheme; re-renders when it changes. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(onColorSchemeChange, currentColorScheme, () => 'default')
}
