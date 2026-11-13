import { forwardRef, type InputHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import styles from './Sidebar.module.css'
import { cx } from './cx'

/**
 * The sidebar anatomy (1.5.2, OXE-22, docs/design/brand.md › Scale): one shape for the OxeCode and OxeChat sidebars,
 * and OxeQuery's later. A header bar, a filled filter, section labels, group rows (a workspace, a project) and item
 * rows (a pane, a conversation). Rows are 28px, one line; a second line only when the item needs the person.
 * The structure of each sidebar (what is grouped under what, how things are added) stays the caller's.
 */

/** The sidebar's header bar (--bar-lg): its title, up to three quiet actions, and collapse last. */
export function SidebarHeader({ title, actions, collapse, className }: { title: ReactNode; actions?: ReactNode; collapse?: ReactNode; className?: string }): ReactElement {
  return <div data-ui="sidebar-header" className={cx(styles.header, className)}>
    <strong className={styles.title}>{title}</strong>
    <div className={styles.headerActions}>{actions}{collapse}</div>
  </div>
}

/** The filter: filled, no border, with its shortcut hint. Forwards everything to the input. */
export const SidebarFilter = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; hint?: ReactNode }>(function SidebarFilter({ icon, hint, className, ...rest }, ref) {
  return <div data-ui="sidebar-filter" className={cx(styles.filter, className)}>
    {icon ? <span className={styles.filterIcon} aria-hidden="true">{icon}</span> : null}
    <input ref={ref} type="search" className={styles.filterInput} {...rest} />
    {hint ? <kbd className={styles.filterHint}>{hint}</kbd> : null}
  </div>
})

/** A section label (11/500, sentence case). Its action shows on hover and focus. */
export function SidebarSection({ label, action, id }: { label: ReactNode; action?: ReactNode; id?: string }): ReactElement {
  return <div data-ui="sidebar-section" className={styles.section}>
    <span className={styles.sectionLabel} id={id}>{label}</span>
    {action ? <span className={styles.reveal}>{action}</span> : null}
  </div>
}

interface RowProps {
  /** The leading mark: a status signal for an item, a color dot or chevron for a group. */
  lead?: ReactNode
  /** The row's name. */
  title: ReactNode
  /** Short meta on the right (time, count, PR or CI state). */
  meta?: ReactNode
  /** Actions shown on hover and focus, before the meta. */
  actions?: ReactNode
  /** A second line, only for what needs the person ("Asks to run a migration"). */
  detail?: ReactNode
  selected?: boolean
  onSelect?: () => void
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  className?: string
  /** Accessible name when the title alone is not enough (status, workspace). */
  'aria-label'?: string
}

function rowKeys(onSelect?: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!onSelect || event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect() }
  }
}

/** A group row (a workspace, a project): 13/600 name; no card, no tint. The workspace color goes in `lead`. */
export function SidebarGroup({ lead, title, meta, actions, selected = false, onSelect, onContextMenu, className, 'aria-label': label }: Omit<RowProps, 'detail'>): ReactElement {
  return <div data-ui="sidebar-group" className={cx(styles.row, styles.group, selected && styles.selected, className)} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={label} aria-current={selected ? 'true' : undefined} onClick={onSelect} onKeyDown={rowKeys(onSelect)} onContextMenu={onContextMenu}>
    {lead ? <span className={styles.lead}>{lead}</span> : null}
    <span className={styles.rowTitle}>{title}</span>
    {actions ? <span className={cx(styles.rowActions, styles.reveal)}>{actions}</span> : null}
    {meta ? <span className={styles.meta}>{meta}</span> : null}
  </div>
}

/** An item row (a pane, a conversation), indented under its group. Selected is a fill. */
export function SidebarRow({ lead, title, meta, actions, detail, selected = false, onSelect, onContextMenu, className, 'aria-label': label }: RowProps): ReactElement {
  return <div data-ui="sidebar-row" className={cx(styles.row, styles.item, detail ? styles.twoLine : undefined, selected && styles.selected, className)} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={label} aria-current={selected ? 'true' : undefined} onClick={onSelect} onKeyDown={rowKeys(onSelect)} onContextMenu={onContextMenu}>
    {lead ? <span className={styles.lead}>{lead}</span> : null}
    <span className={styles.rowTitle}>{title}</span>
    {actions ? <span className={cx(styles.rowActions, styles.reveal)}>{actions}</span> : null}
    {meta ? <span className={styles.meta}>{meta}</span> : null}
    {detail ? <span className={styles.detail}>{detail}</span> : null}
  </div>
}

/** The footer bar (--bar-lg): quiet icon buttons only. */
export function SidebarFooter({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div data-ui="sidebar-footer" className={cx(styles.footer, className)}>{children}</div>
}
