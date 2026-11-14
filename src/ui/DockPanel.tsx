import type { ReactElement, ReactNode } from 'react'
import styles from './DockPanel.module.css'
import { cx } from './cx'

/**
 * One anatomy for every docked panel beside the workspace (1.5.2; OxeCode's Changes, Browser, Commit and pull
 * request, Files, Find in files, Worktrees, HTTP calls, Android device, Containers): a header bar (icon, title,
 * count, actions, close, always in that order), an optional toolbar, the body, an optional footer.
 * Not a modal: ToolPanel is the overlay one.
 */
export function DockPanel({ icon, title, count, actions, close, toolbar, footer, label, className, children }: {
  icon?: ReactNode
  title: ReactNode
  /** What the panel holds, said short ("3 files", "12 calls"). */
  count?: ReactNode
  actions?: ReactNode
  /** The close button (an IconButton), always last. */
  close?: ReactNode
  toolbar?: ReactNode
  footer?: ReactNode
  /** Accessible name of the region when the title is not plain text. */
  label?: string
  className?: string
  children: ReactNode
}): ReactElement {
  return <section data-ui="dock-panel" className={cx(styles.panel, className)} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
    <header className={styles.header}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      <h2 className={styles.title}>{title}</h2>
      {count ? <span className={styles.count}>{count}</span> : null}
      <span className={styles.spacer} />
      {actions ? <span className={styles.actions}>{actions}</span> : null}
      {close}
    </header>
    {toolbar ? <div className={styles.toolbar}>{toolbar}</div> : null}
    <div className={styles.body}>{children}</div>
    {footer ? <footer className={styles.footer}>{footer}</footer> : null}
  </section>
}
