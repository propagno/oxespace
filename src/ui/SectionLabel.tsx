import type { ElementType, ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import styles from './SectionLabel.module.css'

/**
 * A small label over a group: "Project", "Layout", "Connections" (U3, X2, D-03). Sentence case as written, never
 * uppercased by CSS, 12 px semibold in the secondary text color. It renders a heading when it names a group that
 * screen readers should be able to jump to (`as="h3"`), else a plain span.
 */
export function SectionLabel({ children, as: Tag = 'span', id, className, actions }: {
  children: ReactNode
  as?: ElementType
  id?: string
  className?: string
  /** A small control at the end of the line (Add, a count). */
  actions?: ReactNode
}): ReactElement {
  if (!actions) return <Tag id={id} className={cx(styles.label, className)}>{children}</Tag>
  return <div className={cx(styles.row, className)}><Tag id={id} className={styles.label}>{children}</Tag>{actions}</div>
}
