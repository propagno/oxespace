import { createPortal } from 'react-dom'
import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'

interface ViewportTooltipProps {
  ariaLabel: string
  children: ReactNode
  className?: string
  content: string
}

interface TooltipPosition {
  arrowX: number
  left: number
  side: 'top' | 'bottom'
  top: number
}

const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 9
const ARROW_MARGIN = 12

/**
 * Tooltip rendered at document level so pane overflow clipping cannot cut it.
 * Its fixed coordinates are collision-aware and refreshed while any ancestor
 * scrolls or resizes (including draggable workspace panel boundaries).
 */
export function ViewportTooltip({ ariaLabel, children, className, content }: ViewportTooltipProps): ReactElement {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const tooltipId = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const updatePosition = useCallback((): void => {
    const anchor = anchorRef.current
    const tooltip = tooltipRef.current
    if (!anchor || !tooltip) return

    const anchorRect = anchor.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - tooltipRect.width - VIEWPORT_MARGIN)
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - tooltipRect.height - VIEWPORT_MARGIN)
    const anchorCenter = anchorRect.left + anchorRect.width / 2
    const left = clamp(anchorCenter - tooltipRect.width / 2, VIEWPORT_MARGIN, maxLeft)
    const spaceAbove = anchorRect.top - VIEWPORT_MARGIN - ANCHOR_GAP
    const spaceBelow = viewportHeight - anchorRect.bottom - VIEWPORT_MARGIN - ANCHOR_GAP
    const side: TooltipPosition['side'] = spaceAbove >= tooltipRect.height || spaceAbove >= spaceBelow ? 'top' : 'bottom'
    const desiredTop = side === 'top'
      ? anchorRect.top - tooltipRect.height - ANCHOR_GAP
      : anchorRect.bottom + ANCHOR_GAP
    const arrowMax = Math.max(ARROW_MARGIN, tooltipRect.width - ARROW_MARGIN)

    setPosition({
      arrowX: clamp(anchorCenter - left, ARROW_MARGIN, arrowMax),
      left,
      side,
      top: clamp(desiredTop, VIEWPORT_MARGIN, maxTop)
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }

    let frame = 0
    const schedulePosition = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updatePosition)
    }
    updatePosition()
    window.addEventListener('resize', schedulePosition)
    window.addEventListener('scroll', schedulePosition, true)

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePosition)
    if (anchorRef.current) {
      observer?.observe(anchorRef.current)
      if (anchorRef.current.parentElement) observer?.observe(anchorRef.current.parentElement)
    }
    if (tooltipRef.current) observer?.observe(tooltipRef.current)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedulePosition)
      window.removeEventListener('scroll', schedulePosition, true)
      observer?.disconnect()
    }
  }, [content, open, updatePosition])

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      event.currentTarget.blur()
    }
  }

  const tooltipStyle = position
    ? ({
        '--viewport-tooltip-arrow-x': `${position.arrowX}px`,
        left: `${position.left}px`,
        top: `${position.top}px`,
        visibility: 'visible'
      } as CSSProperties)
    : ({ left: 0, top: 0, visibility: 'hidden' } as CSSProperties)

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        aria-describedby={open ? tooltipId : undefined}
        aria-label={ariaLabel}
        tabIndex={0}
        onBlur={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </span>
      {open ? createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          className="viewport-tooltip"
          role="tooltip"
          data-side={position?.side ?? 'top'}
          style={tooltipStyle}
        >
          {content}
        </div>,
        document.body
      ) : null}
    </>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
