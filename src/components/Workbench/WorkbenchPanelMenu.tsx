import type { ReactElement, ReactNode } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { shortcutLabel } from '../../keyboard/keybindings'
import { Button, IconButton, Menu, type MenuEntry } from '../../ui'
import { WORKBENCH_PANELS, panelTitle, type WorkbenchPanelId } from './panelCatalog'

export interface WorkbenchPanelItem {
  id: WorkbenchPanelId
  active: boolean
  onToggle: () => void
  disabled?: boolean
  /** The name in the interface language, when the caller translates it; the catalog's English name otherwise. */
  label?: string
  title?: string
  /** A short count drawn on the button (the label already says it in full, so it is hidden from assistive technology); none when absent. */
  badge?: string
}

/** Menu entries for panels: checked when open, so several can be stacked in Code. Without a workspace, a line says why it is empty. */
export function panelMenuEntries(items: WorkbenchPanelItem[]): MenuEntry[] {
  if (!items.length) return [{ type: 'label', label: i18n.t('panels.needsWorkspace', { ns: 'code' }) }]
  return [
    { type: 'label', label: i18n.t('panels.menu', { ns: 'code' }) },
    ...items.map(item => {
      const meta = WORKBENCH_PANELS[item.id]
      const Icon = meta.icon
      const shortcut = meta.keybinding ? shortcutLabel(meta.keybinding) : undefined
      return {
        type: 'check' as const,
        label: meta.label,
        icon: <Icon size={14} aria-hidden="true" />,
        shortcut: shortcut || undefined,
        checked: item.active,
        disabled: item.disabled,
        onSelect: item.onToggle
      }
    })
  ]
}

/**
 * A bar button that opens or closes one panel, with the shared label and shortcut. A src/ui primitive (BRD-03): an
 * IconButton when the bar shows only icons (`iconOnly`), a ghost Button with the label otherwise.
 */
export function WorkbenchPanelToggle({ item, className, iconOnly = false }: { item: WorkbenchPanelItem; className: string; iconOnly?: boolean }): ReactElement {
  useTranslation('code')
  const { icon: Icon } = WORKBENCH_PANELS[item.id], label = item.label ?? WORKBENCH_PANELS[item.id].label
  const title = item.title ?? panelTitle(item.id)
  const badge = item.badge ? <span className="workspace-topbar-alert" aria-hidden="true" data-testid={`panel-badge-${item.id}`}>{item.badge}</span> : null
  if (iconOnly) {
    return <IconButton size="md" className={className} label={label} title={title} aria-pressed={item.active} disabled={item.disabled} onClick={item.onToggle}
      icon={<><Icon size={14} aria-hidden="true" />{badge}</>} />
  }
  return <Button variant="ghost" size="md" className={className} aria-label={label} title={title} aria-pressed={item.active} disabled={item.disabled} onClick={item.onToggle}
    icon={<Icon size={14} aria-hidden="true" />}><span>{label}</span>{badge}</Button>
}

/** The compact Panels menu: the panels that do not have their own button in the bar. */
export function WorkbenchPanelMenu({ items, trigger, testId }: { items: WorkbenchPanelItem[]; trigger?: ReactNode; testId?: string }): ReactElement {
  const { t } = useTranslation('code')
  return <Menu label={t('panels.menu')} align="end" testId={testId} items={panelMenuEntries(items)}
    trigger={trigger ?? <IconButton label={t('panels.more')} size="sm" icon={<PanelsTopLeft size={14} />} />} />
}
