import { useEffect, type ReactElement, type ReactNode } from 'react'
import type { WorkspaceDensity, WorkspaceThemeId } from '../../../shared/types/workspace'

interface ThemeProviderProps {
  themeId?: WorkspaceThemeId
  density?: WorkspaceDensity
  children: ReactNode
}

export function ThemeProvider({ children, density = 'compact', themeId = 'midnight' }: ThemeProviderProps): ReactElement {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = themeId
    root.dataset.density = density
    return () => {
      delete root.dataset.theme
      delete root.dataset.density
    }
  }, [density, themeId])

  return <>{children}</>
}
