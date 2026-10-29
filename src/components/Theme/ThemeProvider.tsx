import { useEffect, useLayoutEffect, type ReactElement, type ReactNode } from 'react'
import type { WorkspaceDensity, WorkspaceThemeId } from '../../../shared/types/workspace'
import { UI_SCALE_EVENT } from '../../../shared/uiScale'
import { resolveDensity } from '../../design/density'
import { applyMode, resolveMode } from '../../design/mode'
import { applyMotion, REDUCED_MOTION_QUERY, resolveMotion } from '../../design/motion'
import { useSettingsStore } from '../../store/settings.store'

interface ThemeProviderProps {
  /** Kept for saved workspaces; color themes were replaced by light and dark mode. */
  themeId?: WorkspaceThemeId
  /** The active workspace's density; 'default' or nothing follows the app-wide choice. */
  density?: WorkspaceDensity
  children: ReactNode
}

/**
 * Applies the person's light/dark choice (or the operating system's), the
 * motion, density and interface scale to the document root, and mirrors the mode
 * and the scale into the native window so caption buttons, menus and zoom match.
 */
export function ThemeProvider({ children, density }: ThemeProviderProps): ReactElement {
  const appearance = useSettingsStore(state => state.appearance)
  const appDensity = useSettingsStore(state => state.density)
  const uiScale = useSettingsStore(state => state.uiScale)
  const motion = useSettingsStore(state => state.motion)
  const resolvedDensity = resolveDensity(density, appDensity)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    const update = () => applyMode(resolveMode(appearance, query?.matches ? 'dark' : 'light'))
    update()
    void window.oxe?.app?.setAppearance?.(appearance).catch(() => {})
    query?.addEventListener('change', update)
    return () => query?.removeEventListener('change', update)
  }, [appearance])

  useEffect(() => {
    // System follows prefers-reduced-motion live; Reduced and Full ignore it.
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY)
    const update = () => applyMotion(resolveMotion(motion, query?.matches === true))
    update()
    query?.addEventListener('change', update)
    return () => query?.removeEventListener('change', update)
  }, [motion])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.density = resolvedDensity
    return () => { delete root.dataset.density }
  }, [resolvedDensity])

  useEffect(() => {
    const setUiScale = window.oxe?.app?.setUiScale
    if (!setUiScale) return
    let live = true
    // Measured surfaces (the terminal's cell grid) refit once the new zoom is in effect.
    void setUiScale(uiScale).then(() => { if (live) window.dispatchEvent(new Event(UI_SCALE_EVENT)) }).catch(() => {})
    return () => { live = false }
  }, [uiScale])

  return <>{children}</>
}
