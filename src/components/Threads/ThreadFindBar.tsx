import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadTimelineItem } from './threadTimelineModel'
import { findRows, textRanges } from './threadFind'
import { TextField } from '../../ui'

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void }
const highlights = (): Highlights | undefined => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
/** How many frames a jump waits for its row to be mounted by the virtualizer. */
const MOUNT_FRAMES = 30

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
  const { t } = useTranslation('thread')
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
    // The virtualizer mounts the row a few frames later, more on a slow machine: wait for it (up to about half a
    // second), then place it exactly, since the heights of rows never mounted are only estimates.
    let frame = 0, waited = 0
    const place = () => {
      const row = scrollRoot.current?.querySelector(`[data-thread-row="${CSS.escape(activeKey)}"]`)
      if (!row) { if (++waited < MOUNT_FRAMES) frame = requestAnimationFrame(place); return }
      row.scrollIntoView?.({ block: 'center' })
      const registry = highlights()
      if (registry && HighlightCtor) registry.set('thread-find', new HighlightCtor(...textRanges(row, query)))
    }
    // One frame first: the row's content lays out after it mounts.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(place) })
    return () => cancelAnimationFrame(frame)
  }, [activeKey, query, scrollRoot])
  useEffect(() => () => highlights()?.delete('thread-find'), [])
  const step = (delta: number) => { if (matches.length) setCurrent(value => (Math.min(value, matches.length - 1) + delta + matches.length) % matches.length) }
  return <div className="thread-find" role="search" aria-label={t('find.label')}>
    <TextField ref={input} type="search" aria-label={t('find.label')} placeholder={t('find.label')} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      }} />
    <span role="status" aria-live="polite">{query.trim() ? matches.length ? t('find.position', { current: Math.min(current, matches.length - 1) + 1, total: matches.length }) : t('find.none') : ''}</span>
    <button type="button" aria-label={t('find.previous')} title={t('find.previousTitle')} disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={14} /></button>
    <button type="button" aria-label={t('find.next')} title={t('find.nextTitle')} disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={14} /></button>
    <button type="button" aria-label={t('find.close')} title={t('find.closeTitle')} onClick={onClose}><X size={14} /></button>
  </div>
}
