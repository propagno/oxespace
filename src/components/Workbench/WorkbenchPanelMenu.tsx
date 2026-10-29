import type { ReactElement, ReactNode } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { IconButton, Menu, type MenuEntry } from '../../ui'
import { WORKBENCH_PANELS, panelTitle, type WorkbenchPanelId } from './panelCatalog'

export interface WorkbenchPanelItem {
  id: WorkbenchPanelId
  active: boolean
  onToggle: () => void
  disabled?: boolean
}

/** Menu entries for panels: checked when open, so several can be stacked in Code. */
export function panelMenuEntries(items: WorkbenchPanelItem[]): MenuEntry[] {
  return [{ type: 'label', label: i18n.t('panels.menu', { ns: 'code' }) }, ...items.map(item => ({ type: 'check' as const, label: WORKBENCH_PANELS[item.id].label, checked: item.active, disabled: item.disabled, onSelect: item.onToggle }))]
}

/** A bar button that opens or closes one panel, with the shared label and shortcut. */
export function WorkbenchPanelToggle({ item, className }: { item: WorkbenchPanelItem; className: string }): ReactElement {
  useTranslation('code')
  const { label, icon: Icon } = WORKBENCH_PANELS[item.id]
  return <button type="button" className={className} aria-label={label} title={panelTitle(item.id)} aria-pressed={item.active} disabled={item.disabled} onClick={item.onToggle}>
    <Icon size={14} aria-hidden="true" /><span>{label}</span>
  </button>
}

/** The compact Panels menu: the panels that do not have their own button in the bar. */
export function WorkbenchPanelMenu({ items, trigger, testId }: { items: WorkbenchPanelItem[]; trigger?: ReactNode; testId?: string }): ReactElement {
  const { t } = useTranslation('code')
  return <Menu label={t('panels.menu')} align="end" testId={testId} items={panelMenuEntries(items)}
    trigger={trigger ?? <IconButton label={t('panels.more')} size="sm" icon={<PanelsTopLeft size={14} />} />} />
}
