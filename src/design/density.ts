import type { UiDensity, WorkspaceDensity } from '../../shared/types/workspace'

/**
 * Density is chosen app-wide (Settings > Appearance); a workspace or the Thread
 * list may override it. A surface's own choice wins; 'default' or none follows the app.
 */
export function resolveDensity(override: WorkspaceDensity | null | undefined, app: UiDensity): UiDensity {
  return override === 'compact' || override === 'comfortable' ? override : app
}
