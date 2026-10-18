import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import { useModalSurface } from './useModalSurface'
import styles from './ToolPanel.module.css'

export interface ToolPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'role' | 'onMouseDown'> {
  /** Accessible name of the panel. */
  label: string
  onClose: () => void
  /** Escape handler when it should do something before closing (leave a mode, clear a search). Defaults to onClose. */
  onEscape?: () => void
  className?: string
  children: ReactNode
}

/**
 * A full-height tool panel over the workspace (Connections, Skills, Scripts, Linear, Semantic, Web Preview).
 * One scrim, one layer and one focus behavior for all of them; the panel brings its own layout through `className`.
 * Dialogs opened from inside a panel sit above it.
 */
export function ToolPanel({ label, onClose, onEscape, className, children, ...rest }: ToolPanelProps): ReactElement {
  const surface = useModalSurface<HTMLElement>(onEscape ?? onClose)
  return <div className={styles.scrim} role="presentation" onMouseDown={onClose}>
    <section className={cx(styles.panel, className)} role="dialog" aria-modal="true" aria-label={label} {...surface} {...rest} onMouseDown={event => event.stopPropagation()}>
      {children}
    </section>
  </div>
}
