import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Whether a scrolling box has more below what it shows: true while it can scroll further down. A box that does not
 * scroll (all of it fits) is never "more below". Read on scroll and whenever the box or its content changes size, so a
 * fade or a cue can say there is more instead of the content just ending at the box's edge.
 */
export function useMoreBelow<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    // A pixel of slack: fractional layout can leave scrollHeight a hair above clientHeight at the very bottom.
    const read = (): void => setMore(box.scrollHeight - box.clientHeight - box.scrollTop > 1)
    read()
    box.addEventListener('scroll', read, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    observer?.observe(box)
    for (const child of Array.from(box.children)) observer?.observe(child)
    return () => { box.removeEventListener('scroll', read); observer?.disconnect() }
  }, [])
  return [ref, more]
}
