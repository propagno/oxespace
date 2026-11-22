import { forwardRef, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactElement } from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from './Button'
import { cx } from './cx'
import styles from './SearchInput.module.css'

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'size' | 'aria-label'> {
  value: string
  onChange: (value: string) => void
  /** Required accessible name for the search input. */
  'aria-label': string
  clearLabel?: string
  onClear?: () => void
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Search field with leading magnifying glass, accessible clear button when non-empty,
 * and Escape-to-clear behavior that keeps keyboard focus in the input.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    'aria-label': ariaLabel,
    clearLabel = 'Clear search',
    onClear,
    size = 'md',
    disabled = false,
    className,
    onKeyDown,
    ...rest
  },
  ref
): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const attach = (element: HTMLInputElement | null): void => {
    inputRef.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }

  const hasValue = value.length > 0

  const handleClear = (): void => {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event)
    if (!event.defaultPrevented && event.key === 'Escape' && hasValue && !disabled) {
      event.preventDefault()
      event.stopPropagation()
      handleClear()
    }
  }

  return (
    <div
      data-ui="search-input"
      data-size={size}
      data-disabled={disabled ? 'true' : undefined}
      className={cx(styles.root, className)}
    >
      <Search size={14} aria-hidden="true" className={styles.icon} />
      <input
        {...rest}
        ref={attach}
        type="search"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        className={styles.input}
        onChange={event => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {hasValue && !disabled ? (
        <IconButton
          size="sm"
          variant="ghost"
          label={clearLabel}
          icon={<X size={12} aria-hidden="true" />}
          onClick={handleClear}
          className={styles.clear}
        />
      ) : null}
    </div>
  )
})
