import { useSyncExternalStore } from 'react'
import { currentMode, onModeChange, type ColorMode } from './mode'

/** The resolved light or dark mode; re-renders when it changes. */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(onModeChange, currentMode, () => 'light')
}
