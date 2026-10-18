import { useEffect, type ReactElement, type ReactNode } from 'react'
import type { WorkspaceDensity, WorkspaceThemeId } from '../../../shared/types/workspace'
import { applyMode, resolveMode } from '../../design/mode'
import { useSettingsStore } from '../../store/settings.store'

interface ThemeProviderProps {
  /** Kept for saved workspaces; color themes were replaced by light and dark mode. */
  themeId?: WorkspaceThemeId
  density?: WorkspaceDensity
  children: ReactNode
}

/**
 * Applies the person's light/dark choice (or the operating system's) and the
 * workspace density to the document root, and mirrors the mode into the
 * native window so caption buttons and menus match.
 */
export function ThemeProvider({ children, density = 'compact' }: ThemeProviderProps): ReactElement {
  const appearance = useSettingsStore(state => state.appearance)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    const update = () => applyMode(resolveMode(appearance, query?.matches ? 'dark' : 'light'))
    update()
    void window.oxe?.app?.setAppearance?.(appearance).catch(() => {})
    query?.addEventListener('change', update)
    return () => query?.removeEventListener('change', update)
  }, [appearance])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = density
    return () => { delete root.dataset.density }
  }, [density])

  return <>{children}</>
}
