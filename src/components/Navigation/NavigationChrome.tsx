import type { ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, DatabaseZap, MessagesSquare, Settings2, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import './NavigationChrome.css'
import { cx } from '../../ui'
import styles from './NavigationRail.module.css'
import { describeAttention, useAttentionSummary, type AttentionCounts } from '../../hooks/useAttentionSummary'

export interface RailAction {
  id: string
  label: string
  /** Accessible name when it differs from the visible tooltip. */
  ariaLabel?: string
  icon: LucideIcon
  onClick?: () => void
  testId?: string
  disabled?: boolean
}

/**
 * Icon rail shared by the Code and Thread sidebars. It owns the controls that
 * used to be split between the header, quick-nav and footer so each destination
 * exists exactly once (names and test ids are unchanged).
 */
export type NavigationMode = 'code' | 'thread' | 'data'

export function NavigationRail({ mode, collapsed, onModeChange, onSelectMode, primary, context, onToggle, children }: {
  mode: NavigationMode; collapsed: boolean; onModeChange?: () => void
  /** When present it handles every mode button; `onModeChange` keeps the older two-way Code/Thread switch. */
  onSelectMode?: (mode: NavigationMode) => void
  primary: RailAction[]; context: RailAction; onToggle: () => void; children?: ReactNode
}) {
  const openSettings = useUIStore(state => state.toggleSettings)
  const ContextIcon = context.icon
  const attention = useAttentionSummary()
  const select = (target: NavigationMode): void => {
    if (target === mode) return
    if (onSelectMode) onSelectMode(target)
    else if (target !== 'data') onModeChange?.()
  }
  return <div className={cx('nav-rail', styles.rail)} data-collapsed={collapsed}>
    <nav className={styles.group} aria-label="Application view">
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label="Code" title="Code" aria-pressed={mode === 'code'} onClick={() => select('code')}><SquareTerminal size={17} aria-hidden="true" />{(attention.code.needsYou + attention.code.failed) > 0 && <AttentionBadge counts={attention.code} />}</button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label="Thread" title="Thread" aria-pressed={mode === 'thread'} onClick={() => select('thread')}><MessagesSquare size={17} aria-hidden="true" />{(attention.thread.needsYou + attention.thread.failed) > 0 && <AttentionBadge counts={attention.thread} />}</button>
      {(onSelectMode || mode === 'data') && <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label="OxeQuery" title="OxeQuery: containers and databases" aria-pressed={mode === 'data'} onClick={() => select('data')}><DatabaseZap size={17} aria-hidden="true" /></button>}
    </nav>
    <span className={styles.separator} aria-hidden="true" />
    <nav className={styles.group} aria-label="Primary navigation">
      {primary.map(({ id, label, ariaLabel, icon: Icon, onClick, testId, disabled }) =>
        <button key={id} type="button" className={cx('nav-rail-btn', styles.button)} aria-label={ariaLabel ?? label} title={label} data-testid={testId} disabled={disabled} onClick={onClick}><Icon size={17} aria-hidden="true" /></button>)}
    </nav>
    {children}
    <span className={styles.spacer} />
    <footer className={cx('nav-rail-footer', styles.group)}>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={context.ariaLabel ?? context.label} title={context.label} data-testid={context.testId} onClick={context.onClick}><ContextIcon size={17} aria-hidden="true" /></button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label="Open settings" title="Settings" onClick={openSettings}><Settings2 size={17} aria-hidden="true" /></button>
      <button type="button" className={cx('nav-rail-btn', styles.button)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>{collapsed ? <ChevronsRight size={17} aria-hidden="true" /> : <ChevronsLeft size={17} aria-hidden="true" />}</button>
    </footer>
  </div>
}

function AttentionBadge({ counts }: { counts: AttentionCounts }) {
  const total = counts.needsYou + counts.failed
  return <span className={cx(styles.badge, counts.needsYou === 0 && styles.badgeFailed)} role="status" aria-label={describeAttention(counts)} data-testid="attention-badge">{total > 9 ? '9+' : total}</span>
}
