import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { useThreadVirtualizer, type ThreadVirtualItem } from './useThreadVirtualizer'

function MeasuredTimelineRow({ item, onMeasure, children }: { item: ThreadVirtualItem; onMeasure: (key: string, index: number, size: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => onMeasure(item.key, item.index, node.getBoundingClientRect().height)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [item.index, item.key, onMeasure])
  return <div ref={ref} className="thread-virtual-row" data-thread-row={item.key}>{children}</div>
}

export function ThreadTimelineWindow<T extends { key: string }>({ rows, scrollRef, followingRef, onViewportUpdateRef, children }: {
  rows: T[]
  scrollRef: RefObject<HTMLElement | null>
  followingRef: MutableRefObject<boolean>
  onViewportUpdateRef?: MutableRefObject<(() => void) | null>
  children: (row: T, index: number) => ReactNode
}) {
  const keys = useMemo(() => rows.map(row => row.key), [rows])
  const virtual = useThreadVirtualizer(keys, scrollRef, followingRef)
  useLayoutEffect(() => {
    if (!onViewportUpdateRef) return
    onViewportUpdateRef.current = virtual.updateViewport
    return () => { onViewportUpdateRef.current = null }
  }, [onViewportUpdateRef, virtual.updateViewport])
  return <div ref={virtual.spaceRef} className="thread-virtual-space" style={{ paddingTop: virtual.paddingTop, paddingBottom: virtual.paddingBottom }} data-mounted-rows={virtual.mountedCount} data-total-rows={rows.length}>
    {virtual.items.map(item => <MeasuredTimelineRow key={item.key} item={item} onMeasure={virtual.measure}>{children(rows[item.index], item.index)}</MeasuredTimelineRow>)}
  </div>
}
