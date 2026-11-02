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
 * restore the default size. Dragging is never the only way (WCAG 2.5.7): a click without dragging, Enter, Space or the
 * context-menu keys open Smaller, Larger and Restore, each a single click, like the pane grid's dividers.
 */
export function Splitter({ orientation, label, value, min, max, defaultValue, onChange, after = false, step = 16, className, edge = false }: SplitterProps): ReactElement {
  const drag = useRef<{ start: number; size: number; moved: boolean } | null>(null)
  const separator = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const clamp = (size: number): number => Math.round(Math.max(min, Math.min(max, size)))
  const axis = (event: { clientX: number; clientY: number }): number => orientation === 'vertical' ? event.clientX : event.clientY
  const direction = after ? -1 : 1
  const smaller = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp', larger = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
  // FL-09: keys, menu items and drags start from the last size REQUESTED, not the rendered `value`: two keys that
  // arrive before the new size renders would otherwise both start from the old one and count as one step. A new
  // `value` from the parent (its own change, or the request applied) becomes the starting point again.
  const requested = useRef(value)
  const seen = useRef(value)
  if (seen.current !== value) { seen.current = value; requested.current = value }
  const request = (size: number): void => { requested.current = clamp(size); onChange(requested.current) }
  // The panel's own size, whichever side of the splitter it is on.
  const resize = (change: number): void => request(requested.current + change)
  return <div ref={separator} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clamp(value)}
      aria-keyshortcuts="Enter Shift+F10" className={cx(styles.splitter, edge && styles.edge, className)} data-orientation={orientation}
      onPointerDown={event => { drag.current = { start: axis(event), size: requested.current, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
      onPointerMove={event => {
        if (!drag.current) return
        const delta = axis(event) - drag.current.start
        if (Math.abs(delta) > CLICK_SLOP) drag.current.moved = true
        if (drag.current.moved) request(drag.current.size + delta * direction)
      }}
      onPointerUp={() => { const click = drag.current?.moved === false; drag.current = null; if (click) setMenu(true) }}
      onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
      onDoubleClick={() => { setMenu(false); request(defaultValue) }}
      onKeyDown={event => {
        const change = event.key === smaller ? -step : event.key === larger ? step : 0
        if (change) { event.preventDefault(); request(requested.current + change * direction) }
        if (event.key === 'Home') { event.preventDefault(); request(min) }
        if (event.key === 'End') { event.preventDefault(); request(max) }
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); setMenu(true) }
      }}
      // Shift+F10 and the context-menu key often reach the page only as a contextmenu event (Chromium on Linux and
      // Windows): open the same menu from it, and from a right click.
      onContextMenu={event => { event.preventDefault(); setMenu(true) }}>
      {/* Inside the separator: it may not carry aria-expanded or aria-haspopup itself. */}
      <AnchoredMenu open={menu} onOpenChange={setMenu} side={orientation === 'vertical' ? 'right' : 'bottom'} label={i18n.t('ui.splitter.menu', { name: label })} returnFocus={() => separator.current}
        items={[
          { label: i18n.t('ui.splitter.smaller'), onSelect: () => resize(-step), disabled: value <= min, keepOpen: true },
          { label: i18n.t('ui.splitter.larger'), onSelect: () => resize(step), disabled: value >= max, keepOpen: true },
          { label: i18n.t('ui.splitter.restore'), onSelect: () => request(defaultValue), disabled: clamp(value) === clamp(defaultValue) }
        ]} />
    </div>
}
