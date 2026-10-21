import { useRef, type ReactElement } from 'react'
import { cx } from './cx'
import styles from './Splitter.module.css'

export interface SplitterProps {
  /** `vertical` separates columns and is dragged sideways; `horizontal` separates rows and is dragged up and down. */
  orientation: 'vertical' | 'horizontal'
  label: string
  /** Size, in pixels, of the panel the splitter resizes. */
  value: number
  min: number
  max: number
  /** Restored by a double click. */
  defaultValue: number
  onChange(size: number): void
  /** The resized panel comes after the splitter, so dragging toward it makes it smaller. */
  after?: boolean
  step?: number
  className?: string
}

/**
 * A draggable divider between two panels: pointer drag, arrow keys, Home/End
 * for the limits and a double click to restore the default size.
 */
export function Splitter({ orientation, label, value, min, max, defaultValue, onChange, after = false, step = 16, className }: SplitterProps): ReactElement {
  const drag = useRef<{ start: number; size: number } | null>(null)
  const clamp = (size: number): number => Math.round(Math.max(min, Math.min(max, size)))
  const axis = (event: { clientX: number; clientY: number }): number => orientation === 'vertical' ? event.clientX : event.clientY
  const direction = after ? -1 : 1
  const smaller = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', larger = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clamp(value)}
    className={cx(styles.splitter, className)} data-orientation={orientation}
    onPointerDown={event => { drag.current = { start: axis(event), size: value }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
    onPointerMove={event => { if (drag.current) onChange(clamp(drag.current.size + (axis(event) - drag.current.start) * direction)) }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
    onDoubleClick={() => onChange(clamp(defaultValue))}
    onKeyDown={event => {
      const change = event.key === smaller ? -step : event.key === larger ? step : 0
      if (change) { event.preventDefault(); onChange(clamp(value + change * direction)) }
      if (event.key === 'Home') { event.preventDefault(); onChange(min) }
      if (event.key === 'End') { event.preventDefault(); onChange(max) }
    }} />
}
