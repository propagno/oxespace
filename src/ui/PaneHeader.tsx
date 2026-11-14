import type { ReactElement, ReactNode } from 'react'
import styles from './PaneHeader.module.css'
import { cx } from './cx'

/**
 * A terminal pane's header (1.5.2, --bar-md): its state, name, provider and branch, then time and actions. The branch
 * shows only when it is known, so nothing says "Branch unavailable"; actions appear on hover and focus. The focused
 * pane takes an accent tint, set by the caller with `focused`.
 */
export function PaneHeader({ status, title, provider, branch, meta, actions, focused = false, className }: {
  status?: ReactNode
  title: ReactNode
  provider?: ReactNode
  /** The branch, in mono; leave it out when it is not known. */
  branch?: string | null
  meta?: ReactNode
  actions?: ReactNode
  focused?: boolean
  className?: string
}): ReactElement {
  return <header data-ui="pane-header" className={cx(styles.header, focused && styles.focused, className)}>
    {status ? <span className={styles.status}>{status}</span> : null}
    <span className={styles.title}>{title}</span>
    {provider ? <span className={styles.provider}>{provider}</span> : null}
    {branch ? <span className={styles.branch}>{branch}</span> : null}
    <span className={styles.spacer} />
    {meta ? <span className={styles.meta}>{meta}</span> : null}
    {actions ? <span className={styles.actions}>{actions}</span> : null}
  </header>
}
