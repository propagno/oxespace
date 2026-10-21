import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadDebugPage, ThreadDebugRow } from '../../../shared/types/thread'
import { TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import './ThreadEventsPanel.css'

const PAGE = 200

const clock = (at: number): string => {
  if (!at) return '—'
  const date = new Date(at)
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`
}
const duration = (ms?: number): string => ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`

/** The saved events of the conversation in order, with their timing, for finding out what the agent actually did. */
export default function ThreadEventsPanel({ threadId }: { threadId: string }) {
  const api = window.oxe?.thread
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState<ThreadDebugPage | null>(null)
  const [rows, setRows] = useState<ThreadDebugRow[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const latest = useRef(0)

  const load = useCallback(async (text: string, before?: number) => {
    if (!api?.debugEvents) return
    const ticket = ++latest.current
    try {
      const next = await api.debugEvents(threadId, { filter: text, before, limit: PAGE })
      if (ticket !== latest.current) return
      setError('')
      setPage(next)
      setRows(current => before === undefined ? next.rows : [...next.rows, ...current])
    } catch (cause) {
      if (ticket === latest.current) setError(humanizeError(cause, 'Could not load the events'))
    }
  }, [api, threadId])

  // A filter typed quickly is read once it settles.
  useEffect(() => {
    const timer = setTimeout(() => { setSelected(null); void load(filter) }, 200)
    return () => clearTimeout(timer)
  }, [filter, load])

  if (!api?.debugEvents) return <p>The event inspector is not available in this build.</p>
  const chosen = rows.find(row => row.seq === selected)
  const copy = () => navigator.clipboard.writeText(rows.map(row => JSON.stringify(row)).join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => setError('Could not copy the events'))

  return <div className="thread-events">
    {error && <p role="alert">{error}</p>}
    <div className="thread-events-bar">
      <TextField aria-label="Filter events" type="search" value={filter} maxLength={500} placeholder="tool, message, !delta   before:2026-10-14   after:2026-10-14t09:30" onChange={event => setFilter(event.target.value)} />
      <button type="button" disabled={rows.length === 0} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy as JSON lines'}</button>
    </div>
    <p className="thread-events-note" role="status">
      {page === null ? 'Loading…' : `${rows.length} of ${page.matched} matching event${page.matched === 1 ? '' : 's'} shown.`}
      {page?.scanLimited && ' Only the most recent events were searched.'}
    </p>
    <div className="thread-events-body">
      <ol className="thread-events-list" aria-label="Events">
        {page?.hasMore && <li><button type="button" className="thread-events-more" onClick={() => void load(filter, rows[0]?.seq)}>Load earlier events</button></li>}
        {rows.map(row => <li key={row.seq}>
          <button type="button" aria-pressed={row.seq === selected} className={`thread-events-row${row.state === 'failed' || row.exitCode ? ' is-failed' : ''}`} onClick={() => setSelected(row.seq === selected ? null : row.seq)}>
            <time>{clock(row.createdAt)}</time>
            <span className="thread-events-type">{row.type}</span>
            <span className="thread-events-label">{row.label}</span>
            <span className="thread-events-meta">{[row.state, row.exitCode !== undefined ? `exit ${row.exitCode}` : '', duration(row.durationMs)].filter(Boolean).join(' · ')}</span>
          </button>
        </li>)}
        {page && rows.length === 0 && <li><p>{filter.trim() ? 'No event matches this filter.' : 'This conversation has no saved events yet.'}</p></li>}
      </ol>
      {chosen && <section className="thread-events-detail" aria-label="Event detail">
        <dl>
          <dt>Sequence</dt><dd>{chosen.seq}</dd>
          {chosen.eventId && <><dt>Event</dt><dd><code>{chosen.eventId}</code></dd></>}
          {chosen.turnId && <><dt>Turn</dt><dd><code>{chosen.turnId}</code></dd></>}
          {chosen.operationId && <><dt>Operation</dt><dd><code>{chosen.operationId}</code></dd></>}
        </dl>
        <pre>{chosen.payload}</pre>
        {chosen.payloadTruncated && <p>The event is longer than the inspector shows; the rest is cut.</p>}
      </section>}
    </div>
  </div>
}
