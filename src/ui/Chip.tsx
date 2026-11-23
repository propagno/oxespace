import type { ReactElement, ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { cx } from './cx'
import styles from './Chip.module.css'

export type ChipVariant = 'neutral' | 'accent' | 'attention' | 'danger'
export type ChipSize = 'sm' | 'md'

export interface ChipProps {
  children: ReactNode
  variant?: ChipVariant
  size?: ChipSize
  /** Toggle state; sets aria-pressed on interactive chips. */
  pressed?: boolean
  icon?: ReactNode
  onClick?: () => void
  onRemove?: () => void
  removeLabel?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  title?: string
}

/**
 * A compact interactive filter, tag, or toggleable option.
 * Uses native <button> for click/toggle and an accessible IconButton (>= 24px) for removal.
 */
export function Chip({
  children,
  variant = 'neutral',
  size = 'md',
  pressed,
  icon,
  onClick,
  onRemove,
  removeLabel,
  disabled = false,
  className,
  'aria-label': ariaLabel,
  title
}: ChipProps): ReactElement {
  const interactive = onClick !== undefined || pressed !== undefined
  const resolvedRemoveLabel = removeLabel ?? (typeof children === 'string' ? `Remove ${children}` : 'Remove')

  if (onRemove) {
    return (
      <span
        data-ui="chip"
        data-variant={variant}
        data-size={size}
        data-pressed={pressed ? 'true' : undefined}
        data-removable="true"
        className={cx(styles.chip, styles.removable, className)}
        title={title}
      >
        {interactive ? (
          <button
            type="button"
            className={styles.trigger}
            aria-pressed={pressed}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={onClick}
          >
            {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
            <span className={styles.label}>{children}</span>
          </button>
        ) : (
          <span className={styles.content} aria-label={ariaLabel}>
            {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
            <span className={styles.label}>{children}</span>
          </span>
        )}
        <IconButton
          size="sm"
          variant="ghost"
          label={resolvedRemoveLabel}
          icon={<X size={12} aria-hidden="true" />}
          disabled={disabled}
          onClick={onRemove}
          className={styles.remove}
        />
      </span>
    )
  }

  if (interactive) {
    return (
      <button
        type="button"
        data-ui="chip"
        data-variant={variant}
        data-size={size}
        data-pressed={pressed ? 'true' : undefined}
        aria-pressed={pressed}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={onClick}
        className={cx(styles.chip, styles.interactive, className)}
      >
        {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
        <span className={styles.label}>{children}</span>
      </button>
    )
  }

  return (
    <span
      data-ui="chip"
      data-variant={variant}
      data-size={size}
      aria-label={ariaLabel}
      title={title}
      className={cx(styles.chip, className)}
    >
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </span>
  )
}
