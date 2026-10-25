import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, Settings2, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
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

/**
 * Icon rail shared by the Code and Thread sidebars. It owns the controls that
 * used to be split between the header, quick-nav and footer so each destination
 * exists exactly once (names and test ids are unchanged).
 */
export type NavigationMode = 'code' | 'thread' | 'data'

/** The mode buttons moved to the title bar (ModeSwitch); `mode` only marks which sidebar this rail belongs to. */
export function NavigationRail({ mode, collapsed, primary, context, onToggle, children }: {
  mode: NavigationMode; collapsed: boolean
  primary: RailAction[]; context: RailAction; onToggle: () => void; children?: ReactNode
}) {
  const openSettings = useUIStore(state => state.toggleSettings)
  const ContextIcon = context.icon
  return <div className={cx('nav-rail', styles.rail)} data-collapsed={collapsed} data-mode={mode}>
    <nav className={styles.group} aria-label="Primary navigation">
      {primary.map(({ id, label, ariaLabel, icon: Icon, onClick, testId, disabled }, index) =>
        <button key={id} type="button" className={cx('nav-rail-btn', styles.button)} aria-label={ariaLabel ?? label} title={label} data-testid={testId} data-dialog-return={index === 0 ? '' : undefined} disabled={disabled} onClick={onClick}><Icon size={16} aria-hidden="true" /></button>)}
    </nav>
    {children}
    <span className={styles.spacer} />
    <footer className={cx('nav-rail-footer', styles.group)}>
      {context.menu ? <Menu label={context.label} items={context.menu} trigger={<button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={context.ariaLabel ?? context.label} title={context.label} data-testid={context.testId} disabled={context.disabled} onClick={context.menu ? undefined : context.onClick}><ContextIcon size={16} aria-hidden="true" /></button>} /> : <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={context.ariaLabel ?? context.label} title={context.label} data-testid={context.testId} disabled={context.disabled} onClick={context.menu ? undefined : context.onClick}><ContextIcon size={16} aria-hidden="true" /></button>}
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label="Open settings" title="Settings" onClick={openSettings}><Settings2 size={16} aria-hidden="true" /></button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>{collapsed ? <ChevronsRight size={16} aria-hidden="true" /> : <ChevronsLeft size={16} aria-hidden="true" />}</button>
    </footer>
  </div>
}

