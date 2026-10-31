import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Moon, Settings2, Sun, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import { useSettingsStore } from '../../store/settings.store'
import { useColorMode } from '../../design/useColorMode'
import './NavigationChrome.css'
import { cx, Menu, type MenuEntry } from '../../ui'
import styles from './NavigationRail.module.css'

export interface RailAction {
  id: string
  label: string
  /** Accessible name when it differs from the visible tooltip. */
  ariaLabel?: string
  icon: LucideIcon
  onClick?: () => void
  testId?: string
  disabled?: boolean
  /** Opens a menu instead of running onClick. */
  menu?: MenuEntry[]
}

export type NavigationMode = import('../../keyboard/keybindings').AppView

/** One sidebar action as an icon button; the same names and test ids wherever it is drawn. */
function ActionButton({ action, size = 16, returnFocus }: { action: RailAction; size?: number; returnFocus?: boolean }) {
  const Icon = action.icon
  const button = <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={action.ariaLabel ?? action.label} title={action.label}
    data-testid={action.testId} data-dialog-return={returnFocus ? '' : undefined} disabled={action.disabled} onClick={action.menu ? undefined : action.onClick}>
    <Icon size={size} aria-hidden="true" /></button>
  return action.menu ? <Menu label={action.label} items={action.menu} trigger={button} /> : button
}

/** The sidebar's own actions (new workspace, add project, new connection…), at the right of its title. */
export function SidebarActions({ actions }: { actions: RailAction[] }) {
  const { t } = useTranslation()
  return <nav className={cx('sidebar-actions', styles.actions)} aria-label={t('nav.primary')}>
    {actions.map((action, index) => <ActionButton key={action.id} action={action} size={15} returnFocus={index === 0} />)}
  </nav>
}

function ThemeButton() {
  const mode = useColorMode()
  const setAppearance = useSettingsStore(state => state.setAppearance)
  const { t } = useTranslation()
  const next = mode === 'dark' ? 'light' : 'dark'
  const label = next === 'light' ? t('nav.switchToLight') : t('nav.switchToDark')
  return <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={label} title={label} onClick={() => setAppearance(next)}>
    {mode === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}</button>
}

/**
 * The bottom of an expanded sidebar: the mode's context action (accounts, panels, refresh), light or dark,
 * settings, and collapse.
 */
export function SidebarFooter({ context, onToggle, children }: { context: RailAction; onToggle: () => void; children?: ReactNode }) {
  const { t } = useTranslation()
  const openSettings = useUIStore(state => state.toggleSettings)
  return <footer className={cx('nav-rail-footer', styles.footer)}>
    <ActionButton action={context} size={15} />
    {children}
    <span className={styles.spacer} />
    <ThemeButton />
    <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.openSettings')} title={t('nav.settings')} onClick={openSettings}><Settings2 size={15} aria-hidden="true" /></button>
    <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.collapseSidebar')} title={t('nav.collapseSidebar')} onClick={onToggle}><ChevronsLeft size={15} aria-hidden="true" /></button>
  </footer>
}

/**
 * A collapsed sidebar: a narrow column with the same actions, so nothing is out of reach while the sidebar is
 * small. Expanded sidebars draw SidebarActions and SidebarFooter instead.
 */
export function NavigationRail({ mode, primary, context, onToggle, children }: {
  mode: NavigationMode; primary: RailAction[]; context: RailAction; onToggle: () => void; children?: ReactNode
}) {
  const { t } = useTranslation()
  const openSettings = useUIStore(state => state.toggleSettings)
  return <div className={cx('nav-rail', styles.rail)} data-collapsed data-mode={mode}>
    <nav className={styles.group} aria-label={t('nav.primary')}>
      {primary.map((action, index) => <ActionButton key={action.id} action={action} returnFocus={index === 0} />)}
    </nav>
    {children}
    <span className={styles.spacer} />
    <footer className={cx('nav-rail-footer', styles.group)}>
      <ActionButton action={context} />
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.openSettings')} title={t('nav.settings')} onClick={openSettings}><Settings2 size={16} aria-hidden="true" /></button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.expandSidebar')} title={t('nav.expandSidebar')} onClick={onToggle}><ChevronsRight size={16} aria-hidden="true" /></button>
    </footer>
  </div>
}
