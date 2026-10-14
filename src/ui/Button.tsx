import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Tooltip } from './Overlay'
import { cx } from './cx'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and blocks clicks while an action runs. */
  loading?: boolean
  icon?: ReactNode
  /** A square, icon-only button; the caller supplies the accessible name. */
  square?: boolean
}

/** The one button. Primary is for the single main action of a view; most buttons are secondary or ghost. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading = false, icon, square = false, className, children, disabled, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={cx(styles.button, styles[variant], size !== 'md' && styles[size], square && styles.icon, className)}
    disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
    {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
    {children}
  </button>
})

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  /** Required: icon-only buttons are named for screen readers and get it as a tooltip title. */
  label: string
  icon: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, variant = 'ghost', className, title, ...rest }, ref) {
  const button = <Button ref={ref} variant={variant} aria-label={label} title={title} className={cx(styles.icon, className)} icon={icon} {...rest} />
  return title === undefined && !rest.disabled ? <Tooltip content={label}>{button}</Tooltip> : button
})

/** Buttons joined edge to edge, such as a split action. */
export function ButtonGroup({ children, label }: { children: ReactNode; label: string }) {
  return <div role="group" aria-label={label} className={styles.group}>{children}</div>
}
