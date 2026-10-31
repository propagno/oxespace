import { useRef, useState, type ReactElement } from 'react'
import { i18n } from '../i18n'
import { cx } from './cx'
import { AnchoredMenu } from './Overlay'
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
  /** Sits on the right edge of the panel it resizes (a sidebar), over its border, instead of between two panels. */
  edge?: boolean
}

/** How far the pointer may move between press and release and still count as a click, not a drag. */
const CLICK_SLOP = 3

/**
 * A draggable divider between two panels: pointer drag, arrow keys, Home/End for the limits and a double click to
 * restore the default size. Dragging is never the only way (WCAG 2.5.7): a click without dragging, or Enter, opens
 * Smaller, Larger and Restore, each a single click.
 */
export function Splitter({ orientation, label, value, min, max, defaultValue, onChange, after = false, step = 16, className, edge = false }: SplitterProps): ReactElement {
  const drag = useRef<{ start: number; size: number; moved: boolean } | null>(null)
  const separator = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const clamp = (size: number): number => Math.round(Math.max(min, Math.min(max, size)))
  const axis = (event: { clientX: number; clientY: number }): number => orientation === 'vertical' ? event.clientX : event.clientY
  const direction = after ? -1 : 1
  const smaller = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', larger = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
  // The panel's own size, whichever side of the splitter it is on.
  const resize = (change: number): void => onChange(clamp(value + change))
  return <div ref={separator} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clamp(value)}
      aria-keyshortcuts="Enter" className={cx(styles.splitter, edge && styles.edge, className)} data-orientation={orientation}
      onPointerDown={event => { drag.current = { start: axis(event), size: value, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
      onPointerMove={event => {
        if (!drag.current) return
        const delta = axis(event) - drag.current.start
        if (Math.abs(delta) > CLICK_SLOP) drag.current.moved = true
        if (drag.current.moved) onChange(clamp(drag.current.size + delta * direction))
      }}
      onPointerUp={() => { const click = drag.current?.moved === false; drag.current = null; if (click) setMenu(true) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onDoubleClick={() => { setMenu(false); onChange(clamp(defaultValue)) }}
      onKeyDown={event => {
        const change = event.key === smaller ? -step : event.key === larger ? step : 0
        if (change) { event.preventDefault(); onChange(clamp(value + change * direction)) }
        if (event.key === 'Home') { event.preventDefault(); onChange(min) }
        if (event.key === 'End') { event.preventDefault(); onChange(max) }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMenu(true) }
      }}>
      {/* Inside the separator: it may not carry aria-expanded or aria-haspopup itself. */}
      <AnchoredMenu open={menu} onOpenChange={setMenu} side={orientation === 'vertical' ? 'right' : 'bottom'} label={i18n.t('ui.splitter.menu', { name: label })} returnFocus={() => separator.current}
        items={[
          { label: i18n.t('ui.splitter.smaller'), onSelect: () => resize(-step), disabled: value <= min, keepOpen: true },
          { label: i18n.t('ui.splitter.larger'), onSelect: () => resize(step), disabled: value >= max, keepOpen: true },
          { label: i18n.t('ui.splitter.restore'), onSelect: () => onChange(clamp(defaultValue)), disabled: clamp(value) === clamp(defaultValue) }
        ]} />
    </div>
}
