import { Brain, GitBranch, Palette, SquareTerminal, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'

// The pages' names, apart from the modal itself: the Settings frame (in the boot bundle) lists them while the pages
// load as one lazy chunk.
const tc = i18n.getFixedT(null, 'code')

/** One page of the workspace settings; its words are read in the interface language each time. */
function settingsPage<Id extends 'appearance' | 'terminal' | 'memory' | 'delegation'>(id: Id, icon: LucideIcon) {
  return { id, icon, get label() { return tc(`workspace.settings.pages.${id}.label`) }, get hint() { return tc(`workspace.settings.pages.${id}.hint`) }, get description() { return tc(`workspace.settings.pages.${id}.description`) } }
}

export const SETTINGS_PAGES = [
  settingsPage('appearance', Palette),
  settingsPage('terminal', SquareTerminal),
  settingsPage('memory', Brain),
  settingsPage('delegation', GitBranch)
] as const
