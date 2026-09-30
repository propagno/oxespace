import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'

export interface ThreadVirtualItem {
  index: number
  key: string
  start: number
  size: number
}

export interface ThreadVirtualRange {
  start: number
  end: number
  visibleStart: number
}

export function computeThreadVirtualRange(offsets: number[], sizes: number[], viewportStart: number, viewportSize: number, overscan = 6, maxMounted = 80): ThreadVirtualRange {
  const count = sizes.length
  if (!count) return { start: 0, end: 0, visibleStart: 0 }
  const lowerBound = (value: number) => {
    let low = 0, high = count
    while (low < high) {
      const middle = (low + high) >>> 1
      if (offsets[middle] + sizes[middle] < value) low = middle + 1
      else high = middle
    }
    return Math.min(low, count - 1)
  }
  const visibleStart = lowerBound(Math.max(0, viewportStart))
  const visibleEnd = Math.min(count, lowerBound(Math.max(0, viewportStart) + Math.max(1, viewportSize)) + 1)
  let start = Math.max(0, visibleStart - overscan)
  let end = Math.min(count, visibleEnd + overscan)
  if (end - start > maxMounted) {
    start = Math.max(0, Math.min(start, visibleStart))
    end = Math.min(count, start + maxMounted)
    if (end < visibleEnd) { end = visibleEnd; start = Math.max(0, end - maxMounted) }
  }
  return { start, end, visibleStart }
}

export function useThreadVirtualizer(keys: string[], scrollRef: RefObject<HTMLElement | null>, followingRef: MutableRefObject<boolean>, estimateSize = 132) {
  const spaceRef = useRef<HTMLDivElement>(null)
  const sizesRef = useRef(new Map<string, number>())
  const measurementFrame = useRef<number | null>(null)
  const stickToBottom = useRef(false)
  const firstVisibleRef = useRef(0)
  const [measurementVersion, setMeasurementVersion] = useState(0)
  const [viewport, setViewport] = useState({ start: 0, size: 720 })
  const geometry = useMemo(() => {
    const offsets = new Array<number>(keys.length)
    const sizes = new Array<number>(keys.length)
    let total = 0
    for (let index = 0; index < keys.length; index++) {
      offsets[index] = total
      sizes[index] = sizesRef.current.get(keys[index]) ?? estimateSize
      total += sizes[index]
    }
    return { offsets, sizes, total }
  // Sizes live in a ref; this version invalidates their cached geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, estimateSize, measurementVersion])
  const range = useMemo(() => computeThreadVirtualRange(geometry.offsets, geometry.sizes, viewport.start, viewport.size), [geometry, viewport])
  // Measurements from overscan rows above the viewport must also compensate
  // scrollTop. Using the mounted range start here lets those rows move the
  // reader's anchor while they settle from estimates to their real height.
  firstVisibleRef.current = range.visibleStart
  const updateViewport = useCallback(() => {
    const scroll = scrollRef.current, space = spaceRef.current
    if (!scroll || !space) return
    setViewport(current => {
      const next = { start: Math.max(0, scroll.scrollTop - space.offsetTop), size: scroll.clientHeight || current.size }
      return next.start === current.start && next.size === current.size ? current : next
    })
  }, [scrollRef])
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    updateViewport()
    scroll.addEventListener('scroll', updateViewport, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateViewport)
    observer?.observe(scroll)
    return () => { scroll.removeEventListener('scroll', updateViewport); observer?.disconnect() }
  }, [scrollRef, updateViewport, keys.length])
  useLayoutEffect(() => {
    // ThreadView restores scrollTop after this child mounts. A later content
    // measurement can also change the scroll range without firing scroll.
    const frame = requestAnimationFrame(updateViewport)
    return () => cancelAnimationFrame(frame)
  }, [updateViewport, keys.length, geometry.total])
  useLayoutEffect(() => () => {
    if (measurementFrame.current !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(measurementFrame.current)
  }, [])
  const measure = useCallback((key: string, index: number, size: number) => {
    // A mounted Thread stays in the DOM while Code is visible. Do not replace
    // measurements while its scroll container is hidden, but allow genuinely
    // empty protocol rows to take zero space instead of the 132px estimate.
    if (!Number.isFinite(size) || !scrollRef.current?.clientHeight) return
    const normalized = Math.max(0, Math.ceil(size))
    const previous = sizesRef.current.get(key) ?? estimateSize
    if (Math.abs(previous - normalized) < 1) return
    sizesRef.current.set(key, normalized)
    const scroll = scrollRef.current
    if (scroll) {
      if (followingRef.current && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 64) stickToBottom.current = true
      if (index < firstVisibleRef.current) scroll.scrollTop += normalized - previous
    }
    if (measurementFrame.current === null) {
      measurementFrame.current = requestAnimationFrame(() => {
        measurementFrame.current = null
        setMeasurementVersion(value => value + 1)
        if (stickToBottom.current) requestAnimationFrame(() => {
          stickToBottom.current = false
          if (followingRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        })
      })
    }
  }, [estimateSize, followingRef, scrollRef])
  const items = useMemo(() => keys.slice(range.start, range.end).map((key, offset) => {
    const index = range.start + offset
    return { index, key, start: geometry.offsets[index], size: geometry.sizes[index] } satisfies ThreadVirtualItem
  }), [geometry, keys, range])
  return { spaceRef, updateViewport, totalSize: geometry.total, paddingTop: geometry.offsets[range.start] ?? geometry.total,
    paddingBottom: geometry.total - (geometry.offsets[range.end] ?? geometry.total), items, measure, mountedCount: items.length }
}
