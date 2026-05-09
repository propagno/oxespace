import type { WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'

export const WORKSPACE_THEMES: Array<{ id: WorkspaceThemeId; label: string }> = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'monokai', label: 'Monokai' },
  { id: 'amber', label: 'Amber' }
]

export const WORKSPACE_DENSITIES: Array<{ id: WorkspaceDensity; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' }
]

export const LAYOUT_PRESETS: WorkspaceLayoutPreset[] = [1, 2, 4, 6, 8, 10, 12, 14, 16]

export const WORKSPACE_TEMPLATES: Array<{
  id: string
  label: string
  description: string
  themeId: WorkspaceThemeId
  uiDensity: WorkspaceDensity
  layoutPreset: WorkspaceLayoutPreset
}> = [
  { id: 'focused', label: 'Focused', description: 'Single agent focus', themeId: 'midnight', uiDensity: 'compact', layoutPreset: 1 },
  { id: 'pairing', label: 'Pairing', description: 'Two agents side by side', themeId: 'nord', uiDensity: 'compact', layoutPreset: 2 },
  { id: 'review', label: 'Review', description: 'Review and verify grid', themeId: 'dracula', uiDensity: 'comfortable', layoutPreset: 4 },
  { id: 'automation', label: 'Automation', description: 'Large automation surface', themeId: 'monokai', uiDensity: 'compact', layoutPreset: 8 }
]
