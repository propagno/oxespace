import type { WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')
/** Terminal theme names are product names, the same in every language. */
const theme = (id: WorkspaceThemeId, name: string): { id: WorkspaceThemeId; label: string } => ({ id, label: name })

export const WORKSPACE_THEMES: Array<{ id: WorkspaceThemeId; label: string }> = [
  theme('midnight', 'Workbench'),
  theme('nord', 'Nord'),
  theme('dracula', 'Dracula'),
  theme('ocean', 'Ocean'),
  theme('monokai', 'Monokai'),
  theme('amber', 'Amber'),
  theme('rose-pine', 'Rose Pine'),
  theme('gruvbox', 'Gruvbox'),
  theme('one-dark', 'One Dark'),
  theme('synthwave84', "Synthwave '84"),
  theme('github-dark', 'GitHub Dark')
]

/** 'default' follows Settings › Appearance; the others override it for one workspace. Labels are read in the interface language. */
export const WORKSPACE_DENSITIES: Array<{ id: WorkspaceDensity; readonly label: string }> = (['default', 'compact', 'comfortable'] as const)
  .map(id => ({ id, get label() { return tc(`workspace.density.${id}`) } }))

export const LAYOUT_PRESETS: WorkspaceLayoutPreset[] = [1, 2, 4, 6, 8, 10, 12, 14, 16]

