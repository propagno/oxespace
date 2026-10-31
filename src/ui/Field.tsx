import { forwardRef, useId, type InputHTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from './cx'
import styles from './Field.module.css'

interface FieldChrome {
  label?: ReactNode
  hint?: ReactNode
  /** Marks the control invalid and is read with it. */
  error?: ReactNode
}

/** Label, hint and error around one control; ids are wired for screen readers. */
function Field({ id, label, hint, error, children }: FieldChrome & { id: string; children: ReactNode }): ReactElement {
  return <div className={styles.field}>
    {label && <label className={styles.label} htmlFor={id}>{label}</label>}
    {children}
    {error ? <span id={`${id}-error`} className={styles.error} role="alert">{error}</span> : hint ? <span id={`${id}-hint`} className={styles.hint}>{hint}</span> : null}
  </div>
}

const described = (id: string, chrome: FieldChrome) => chrome.error ? `${id}-error` : chrome.hint ? `${id}-hint` : undefined

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, FieldChrome {
  /** Monospace input, for paths, commands and identifiers. */
  mono?: boolean
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, mono, className, id, ...rest }, ref) {
  const auto = useId(), inputId = id ?? auto
  const input = <input ref={ref} id={inputId} className={cx(styles.input, mono && styles.mono, className)} aria-invalid={error ? true : undefined} aria-describedby={described(inputId, { hint, error })} {...rest} />
  return label || hint || error ? <Field id={inputId} label={label} hint={hint} error={error}>{input}</Field> : input
})

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChrome {
  mono?: boolean
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, hint, error, mono, className, id, ...rest }, ref) {
  const auto = useId(), inputId = id ?? auto
  const area = <textarea ref={ref} id={inputId} className={cx(styles.textarea, mono && styles.mono, className)} aria-invalid={error ? true : undefined} aria-describedby={described(inputId, { hint, error })} {...rest} />
  return label || hint || error ? <Field id={inputId} label={label} hint={hint} error={error}>{area}</Field> : area
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldChrome {
  options?: Array<{ value: string; label: string; disabled?: boolean }>
}

/** A native select: the platform's own list, keyboard and screen-reader behavior. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, options, className, id, children, ...rest }, ref) {
  const auto = useId(), inputId = id ?? auto
  const select = <select ref={ref} id={inputId} className={cx(styles.select, className)} aria-invalid={error ? true : undefined} aria-describedby={described(inputId, { hint, error })} {...rest}>
    {options?.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    {children}
  </select>
  return label || hint || error ? <Field id={inputId} label={label} hint={hint} error={error}>{select}</Field> : select
})

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  return <label className={cx(styles.check, className)}><input ref={ref} type="checkbox" {...rest} />{label}</label>
})

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label; when absent, `ariaLabel` names the switch. */
  label?: ReactNode
  description?: ReactNode
  ariaLabel?: string
  disabled?: boolean
}

/** On/off setting that applies immediately. A row with label and description when `label` is set. */
export function Switch({ checked, onChange, label, description, ariaLabel, disabled }: SwitchProps): ReactElement {
  const id = useId()
  const control = <button type="button" role="switch" aria-checked={checked} aria-label={label ? undefined : ariaLabel} aria-labelledby={label ? `${id}-label` : undefined}
    aria-describedby={description ? `${id}-description` : undefined} className={styles.switch} disabled={disabled} onClick={() => onChange(!checked)} />
  if (!label) return control
  return <div className={styles.switchRow}>
    <span className={styles.switchText}><span id={`${id}-label`} className={styles.label}>{label}</span>{description && <span id={`${id}-description`} className={styles.hint}>{description}</span>}</span>
    {control}
  </div>
}

export interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode }>
  label: string
}

/** A few mutually exclusive choices shown side by side; arrow keys move between them. */
export function SegmentedControl<T extends string>({ value, onChange, options, label }: SegmentedControlProps<T>): ReactElement {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = options[(index + step + options.length) % options.length]
    onChange(next.value)
    const group = event.currentTarget.parentElement
    requestAnimationFrame(() => (group?.querySelector(`[data-value="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus())
  }
  return <div role="radiogroup" aria-label={label} className={styles.segmented}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio" data-value={option.value} aria-checked={option.value === value} tabIndex={option.value === value ? 0 : -1}
      className={styles.segment} onClick={() => onChange(option.value)} onKeyDown={event => move(event, index)}>{option.icon}{option.label}</button>)}
  </div>
}

/** A keyboard key, as in a shortcut hint. */
export function Kbd({ children }: { children: ReactNode }): ReactElement {
  return <kbd className={styles.kbd}>{children}</kbd>
}

/**
 * The error under a control the primitives do not draw (a code editor, a textarea inside a custom layout). Point the
 * control at it with aria-describedby={id} and aria-invalid; it is announced when it appears.
 */
export function FieldError({ id, children, className }: { id?: string; children: ReactNode; className?: string }): ReactElement {
  return <span id={id} className={cx(styles.error, className)} role="alert">{children}</span>
}
