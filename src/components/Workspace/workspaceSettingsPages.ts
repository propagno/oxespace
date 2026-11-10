import { FolderTree, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

export type WorkspacePageId = 'general' | 'projects' | 'policy'

function settingsPage(id: WorkspacePageId, icon: LucideIcon, defaultLabel: string, defaultHint = '', defaultDesc = '') {
  return {
    id,
    icon,
    get label() { return tc(`workspace.settings.pages.${id}.label`, { defaultValue: defaultLabel }) },
    get hint() { return tc(`workspace.settings.pages.${id}.hint`, { defaultValue: defaultHint }) },
    get description() { return tc(`workspace.settings.pages.${id}.description`, { defaultValue: defaultDesc }) }
  }
}

export const SETTINGS_PAGES = [
  settingsPage('general', Settings2, 'General', 'Project instructions and workspace preferences'),
  settingsPage('projects', FolderTree, 'Projects', 'Worktrees and branches'),
  settingsPage('policy', ShieldCheck, 'Policy', 'Workspace policy rules')
] as const
