import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import styles from './PaneHeader.module.css'
import { cx } from './cx'

type PaneHeaderProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  status?: ReactNode
  title: ReactNode
  provider?: ReactNode
  /** The branch, in mono (a name or the caller's own chip); leave it out when it is not known. */
  branch?: ReactNode
  meta?: ReactNode
  /** The pane's actions; written as children, they go to the same place. */
  actions?: ReactNode
  focused?: boolean
  [data: `data-${string}`]: string | undefined
}

/**
 * A terminal pane's header (1.5.2, --bar-md): its state, name, provider and branch, then time and actions. The branch
 * shows only when it is known, so nothing says "Branch unavailable"; actions appear on hover and focus. The focused
 * pane takes an accent tint, set by the caller with `focused` (data-focused="true").
 */
export function PaneHeader({ status, title, provider, branch, meta, actions, focused = false, className, children, ...rest }: PaneHeaderProps): ReactElement {
  const trailing = actions ?? children
  return <header {...rest} data-ui="pane-header" data-focused={focused ? 'true' : undefined} className={cx(styles.header, focused && styles.focused, className)}>
    {status ? <span className={styles.status}>{status}</span> : null}
    <span data-ui="pane-title" className={styles.title}>{title}</span>
    {provider ? <span className={styles.provider}>{provider}</span> : null}
    {branch ? <span className={styles.branch}>{branch}</span> : null}
    <span className={styles.spacer} />
    {meta ? <span className={styles.meta}>{meta}</span> : null}
    {trailing ? <span className={styles.actions}>{trailing}</span> : null}
  </header>
}
