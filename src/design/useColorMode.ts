import { useSyncExternalStore } from 'react'
import { currentMode, currentSurfaceStyle, onModeChange, onSurfaceStyleChange, type ColorMode, type SurfaceStyle } from './mode'

/** The resolved light or dark mode; re-renders when it changes. */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(onModeChange, currentMode, () => 'light')
}

/** The active surface preset (`default` or `pure`); re-renders when it changes. */
export function useSurfaceStyle(): SurfaceStyle {
  return useSyncExternalStore(onSurfaceStyleChange, currentSurfaceStyle, () => 'default')
}
