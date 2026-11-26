import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsLeft, ChevronsRight, Moon, Settings2, Sun, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import { useSettingsStore } from '../../store/settings.store'
import { useColorMode } from '../../design/useColorMode'
import './NavigationChrome.css'
import { cx, IconButton, Menu, SidebarFooter as UiSidebarFooter, type MenuEntry } from '../../ui'
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
  return <footer className={cx('nav-rail-footer', styles.footer)} data-sidebar-footer="">
    <ActionButton action={context} size={15} />
    {children}
    <span className={styles.spacer} />
    <ThemeButton />
    <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.openSettings')} title={t('nav.settings')} onClick={openSettings}><Settings2 size={15} aria-hidden="true" /></button>
    <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.collapseSidebar')} title={t('nav.collapseSidebar')} onClick={onToggle}><ChevronsLeft size={15} aria-hidden="true" /></button>
  </footer>
}

/** One sidebar action as a src/ui IconButton (BRD-01): the same names, titles and test ids as ActionButton. */
function ActionIconButton({ action, returnFocus, size = 'sm', iconSize = 14 }: { action: RailAction; returnFocus?: boolean; size?: 'sm' | 'md'; iconSize?: number }) {
  const Icon = action.icon
  const button = <IconButton size={size} label={action.ariaLabel ?? action.label} title={action.label} icon={<Icon size={iconSize} aria-hidden="true" />}
    data-testid={action.testId} data-dialog-return={returnFocus ? '' : undefined} disabled={action.disabled} onClick={action.menu ? undefined : action.onClick} />
  return action.menu ? <Menu label={action.label} items={action.menu} trigger={button} /> : button
}

/** The actions of a src/ui SidebarHeader (new workspace, delegated work, search…), as IconButtons. */
export function SidebarHeaderActions({ actions }: { actions: RailAction[] }) {
  const { t } = useTranslation()
  // The header's actions are the sidebar's primary navigation landmark, as SidebarActions was before BRD-01.
  return <nav className="sidebar-header-nav" aria-label={t('nav.primary')}>{actions.map((action, index) => <ActionIconButton key={action.id} action={action} returnFocus={index === 0} />)}</nav>
}

/**
 * The bottom of an expanded sidebar on the src/ui anatomy (BRD-01, OXE-433): a SidebarFooter of md IconButtons
 * with 17px icons (context action, light or dark, settings, and collapse when provided).
 */
export function SidebarFooterBar({ context, onToggle, className }: { context?: RailAction; onToggle?: () => void; className?: string }) {
  const { t } = useTranslation()
  const openSettings = useUIStore(state => state.toggleSettings)
  const mode = useColorMode()
  const setAppearance = useSettingsStore(state => state.setAppearance)
  const next = mode === 'dark' ? 'light' : 'dark'
  const themeLabel = next === 'light' ? t('nav.switchToLight') : t('nav.switchToDark')
  const footerClass = className?.split(/\s+/).includes('nav-rail-footer') ? className : cx('nav-rail-footer', className)
  return <UiSidebarFooter className={footerClass}>
    {context ? <ActionIconButton action={context} size="md" iconSize={17} /> : null}
    <span className={styles.spacer} />
    <IconButton size="md" label={themeLabel} title={themeLabel} icon={mode === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />} onClick={() => setAppearance(next)} />
    <IconButton size="md" label={t('nav.openSettings')} title={t('nav.settings')} icon={<Settings2 size={17} aria-hidden="true" />} onClick={openSettings} />
    {onToggle ? <IconButton size="md" label={t('nav.collapseSidebar')} title={t('nav.collapseSidebar')} icon={<ChevronsLeft size={17} aria-hidden="true" />} onClick={onToggle} /> : null}
  </UiSidebarFooter>
}

/** One thing the sidebar lists (a conversation, a connection, a container), as the collapsed rail shows it. */
export interface RailItem {
  id: string
  label: string
  /** What the button shows; the label's first letter when absent. */
  mark?: ReactNode
  current?: boolean
  onSelect: () => void
}

/**
 * The sidebar's items in the collapsed rail (T61): collapsing hid the list itself in OxeChat, OxeQuery and OxePod,
 * while OxeCode's rail kept its workspaces. Each item is a button named by its label, the current one marked.
 */
export function RailItems({ label, items }: { label: string; items: RailItem[] }) {
  if (!items.length) return null
  return <nav className={cx(styles.group, styles.items)} aria-label={label} data-rail-items="">
    <span className={styles.separator} aria-hidden="true" />
    {items.map(item => <button key={item.id} type="button" className={cx('nav-rail-btn', styles.button, styles.item)} aria-label={item.label} title={item.label}
      aria-current={item.current ? 'page' : undefined} onClick={item.onSelect}>
      {item.mark ?? <span className={styles.initial} aria-hidden="true">{[...item.label.trim()][0]?.toUpperCase() ?? '·'}</span>}
    </button>)}
  </nav>
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
      <ThemeButton />
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.openSettings')} title={t('nav.settings')} onClick={openSettings}><Settings2 size={16} aria-hidden="true" /></button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={t('nav.expandSidebar')} title={t('nav.expandSidebar')} onClick={onToggle}><ChevronsRight size={16} aria-hidden="true" /></button>
    </footer>
  </div>
}
