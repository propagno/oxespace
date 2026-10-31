import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Which side a popup should hang from: `left` when it fits to the right of its button, else `right`. Measured
 * when it opens, so the same menu works wherever a wrapping toolbar puts its button.
 */
export function useEdgeAlign(anchor: RefObject<HTMLElement | null>, open: boolean, width: number): 'left' | 'right' {
  const [side, setSide] = useState<'left' | 'right'>('left')
  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const box = anchor.current.getBoundingClientRect()
    setSide(box.left + width <= window.innerWidth - 12 ? 'left' : 'right')
  }, [anchor, open, width])
  return side
}
