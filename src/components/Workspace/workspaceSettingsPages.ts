import { FolderTree, ScrollText, Settings2, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'

export type WorkspacePageId = 'general' | 'projects' | 'policy'

function settingsPage(id: WorkspacePageId, icon: LucideIcon, defaultLabel: string, defaultHint = '', defaultDesc = '') {
  return {
    id,
    icon,
    get label() { return i18n.t(`workspace.settings.pages.${id}.label`, { ns: 'code', defaultValue: defaultLabel }) },
    get hint() { return i18n.t(`workspace.settings.pages.${id}.hint`, { ns: 'code', defaultValue: defaultHint }) },
    get description() { return i18n.t(`workspace.settings.pages.${id}.description`, { ns: 'code', defaultValue: defaultDesc }) }
  }
}

export const SETTINGS_PAGES = [
  settingsPage('general', Settings2, 'General', 'Project instructions and workspace preferences', 'Set default instructions, shell preferences and appearance for this workspace.'),
  settingsPage('projects', FolderTree, 'Projects', 'Project instructions', 'The instruction files agents read in this project.'),
  settingsPage('policy', ScrollText, 'Policy', 'Workspace policy rules', 'Control which tools and actions agents may run in this workspace.')
] as const
