import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { ThreadTimelineItem } from './threadTimelineModel'
import { findRows, textRanges } from './threadFind'
import { TextField } from '../../ui'

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void }
const highlights = (): Highlights | undefined => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

/**
 * Find in the conversation. Searches the whole timeline model, not only the
 * rows the virtualizer has mounted, scrolls to each match and highlights it.
 */
export function ThreadFindBar({ rows, scrollRoot, scrollTo, onClose }: {
  rows: ThreadTimelineItem[]
  scrollRoot: RefObject<HTMLElement | null>
  scrollTo: (index: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => findRows(rows, query), [rows, query])
  const active = matches.length ? matches[Math.min(current, matches.length - 1)] : -1
  // Latest values without re-running the scroll when new events arrive mid-search.
  const latest = useRef({ rows, scrollTo })
  latest.current = { rows, scrollTo }
  const activeKey = active >= 0 ? rows[active].key : null
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setCurrent(0) }, [query])
  useEffect(() => {
    if (!activeKey) { highlights()?.delete('thread-find'); return }
    const index = latest.current.rows.findIndex(row => row.key === activeKey)
    if (index < 0) return
    latest.current.scrollTo(index)
    // Two frames: the virtualizer mounts the row, then its content lays out.
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
      const row = scrollRoot.current?.querySelector(`[data-thread-row="${CSS.escape(activeKey)}"]`)
      // Estimated heights of unmounted rows are approximate; place the mounted row exactly.
      row?.scrollIntoView?.({ block: 'center' })
      const registry = highlights()
      if (row && registry && HighlightCtor) registry.set('thread-find', new HighlightCtor(...textRanges(row, query)))
    }) })
    return () => cancelAnimationFrame(frame)
  }, [activeKey, query, scrollRoot])
  useEffect(() => () => highlights()?.delete('thread-find'), [])
  const step = (delta: number) => { if (matches.length) setCurrent(value => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length) }
  return <div className="thread-find" role="search" aria-label="Find in conversation">
    <TextField ref={input} type="search" aria-label="Find in conversation" placeholder="Find in conversation" value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }} />
    <span role="status" aria-live="polite">{query.trim() ? matches.length ? `${Math.min(current, matches.length - 1) + 1} of ${matches.length}` : 'No results' : ''}</span>
    <button type="button" aria-label="Previous match" title="Previous · Shift+Enter" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={14} /></button>
    <button type="button" aria-label="Next match" title="Next · Enter" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={14} /></button>
    <button type="button" aria-label="Close find" title="Close · Esc" onClick={onClose}><X size={14} /></button>
  </div>
}
