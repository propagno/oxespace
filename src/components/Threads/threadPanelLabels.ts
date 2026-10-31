import { i18n } from '../../i18n'
import { withShortcut } from '../../keyboard/keybindings'
import { WORKBENCH_PANELS, type WorkbenchPanelId } from '../Workbench/panelCatalog'

/** A shared panel's name in the interface language (src/components/Workbench/panelCatalog.ts keeps the English one). */
export function threadPanelLabel(id: WorkbenchPanelId): string {
  return i18n.t(`thread:panels.${id}`)
}

/** The panel's name with its shortcut, for a tooltip. */
export function threadPanelTitle(id: WorkbenchPanelId): string {
  return withShortcut(threadPanelLabel(id), WORKBENCH_PANELS[id].keybinding)
}
