import { useCallback, useEffect, useRef, useState } from 'react'
import type { ThreadDebugPage, ThreadDebugRow } from '../../../shared/types/thread'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, LoadingState, TextField } from '../../ui'
import { formatClock, formatNumber } from '../../utils/formatTime'
import { humanizeError } from '../../utils/humanizeError'
import './ThreadEventsPanel.css'

const PAGE = 200
/** The filter syntax, shown as the placeholder; code, so the same in every language. */
const FILTER_SYNTAX = 'tool, message, !delta   before:2026-10-14   after:2026-10-14t09:30'

const clock = (at: number): string => {
  if (!at) return '—'
  const date = new Date(at)
  return `${formatClock(date, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`
}
const duration = (ms?: number): string => ms === undefined ? '' : ms < 1000 ? `${formatNumber(ms)} ms` : `${formatNumber(ms / 1000, { maximumFractionDigits: ms < 10000 ? 1 : 0, minimumFractionDigits: ms < 10000 ? 1 : 0 })} s`

/** The saved events of the conversation in order, with their timing, for finding out what the agent actually did. */
export default function ThreadEventsPanel({ threadId }: { threadId: string }) {
  const { t } = useTranslation('thread')
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
      if (ticket === latest.current) setError(humanizeError(cause, t('events.loadFailed')))
    }
  }, [api, threadId, t])

  // A filter typed quickly is read once it settles.
  useEffect(() => {
    const timer = setTimeout(() => { setSelected(null); void load(filter) }, 200)
    return () => clearTimeout(timer)
  }, [filter, load])

  if (!api?.debugEvents) return <EmptyState compact title={t('events.unavailable')} />
  const chosen = rows.find(row => row.seq === selected)
  const copy = () => navigator.clipboard.writeText(rows.map(row => JSON.stringify(row)).join('\n')).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => setError(t('events.copyFailed')))

  return <div className="thread-events">
    {error && <ErrorState compact title={error} />}
    <div className="thread-events-bar">
      <TextField aria-label={t('events.filter')} type="search" value={filter} maxLength={500} placeholder={FILTER_SYNTAX} onChange={event => setFilter(event.target.value)} />
      <button type="button" disabled={rows.length === 0} onClick={() => void copy()}>{copied ? t('events.copied') : t('events.copy')}</button>
    </div>
    {page === null ? <LoadingState label={t('common.loading')} /> : <p className="thread-events-note" role="status">
      {t('events.shown', { shown: formatNumber(rows.length), count: page.matched })}
      {page.scanLimited && t('events.scanLimited')}
    </p>}
    <div className="thread-events-body">
      <ol className="thread-events-list" aria-label={t('events.list')}>
        {page?.hasMore && <li><button type="button" className="thread-events-more" onClick={() => void load(filter, rows[0]?.seq)}>{t('events.earlier')}</button></li>}
        {rows.map(row => <li key={row.seq}>
          <button type="button" aria-pressed={row.seq === selected} className={`thread-events-row${row.state === 'failed' || row.exitCode ? ' is-failed' : ''}`} onClick={() => setSelected(row.seq === selected ? null : row.seq)}>
            <time>{clock(row.createdAt)}</time>
            <span className="thread-events-type">{row.type}</span>
            <span className="thread-events-label">{row.label}</span>
            <span className="thread-events-meta">{[row.state, row.exitCode !== undefined ? t('events.exit', { code: row.exitCode }) : '', duration(row.durationMs)].filter(Boolean).join(' · ')}</span>
          </button>
        </li>)}
        {page && rows.length === 0 && <li><EmptyState compact title={filter.trim() ? t('events.noMatch') : t('events.none')} /></li>}
      </ol>
      {chosen && <section className="thread-events-detail" aria-label={t('events.detail')}>
        <dl>
          <dt>{t('events.sequence')}</dt><dd>{chosen.seq}</dd>
          {chosen.eventId && <><dt>{t('events.event')}</dt><dd><code>{chosen.eventId}</code></dd></>}
          {chosen.turnId && <><dt>{t('events.turn')}</dt><dd><code>{chosen.turnId}</code></dd></>}
          {chosen.operationId && <><dt>{t('events.operation')}</dt><dd><code>{chosen.operationId}</code></dd></>}
        </dl>
        <pre>{chosen.payload}</pre>
        {chosen.payloadTruncated && <p>{t('events.truncated')}</p>}
      </section>}
    </div>
  </div>
}
