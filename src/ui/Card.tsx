import type { ButtonHTMLAttributes, HTMLAttributes, MouseEventHandler, ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import styles from './Card.module.css'

export type CardSurface = 'raised' | 'sunken' | 'base'
export type CardPadding = 'sm' | 'md' | 'lg'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  surface?: CardSurface
  padding?: CardPadding
  /** Renders as a native <button> with hover/focus states when true. */
  interactive?: boolean
  disabled?: boolean
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type']
  onClick?: MouseEventHandler<HTMLElement>
  children: ReactNode
  className?: string
}

/**
 * A surface container built exclusively from Mandacaru surface, border, radius, and spacing tokens.
 */
export function Card({
  surface = 'raised',
  padding = 'md',
  interactive = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
  className,
  ...rest
}: CardProps): ReactElement {
  const commonClass = cx(styles.card, interactive && styles.interactive, className)

  if (interactive) {
    return (
      <button
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        type={type}
        disabled={disabled}
        data-ui="card"
        data-surface={surface}
        data-padding={padding}
        data-interactive="true"
        onClick={onClick as MouseEventHandler<HTMLButtonElement> | undefined}
        className={commonClass}
      >
        {children}
      </button>
    )
  }

  return (
    <div
      {...(rest as HTMLAttributes<HTMLDivElement>)}
      data-ui="card"
      data-surface={surface}
      data-padding={padding}
      onClick={onClick as MouseEventHandler<HTMLDivElement> | undefined}
      className={commonClass}
    >
      {children}
    </div>
  )
}
