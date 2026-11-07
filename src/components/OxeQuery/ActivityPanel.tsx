import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import type { OxeQueryAuditEntry } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { formatMs } from './catalog'
import { EmptyState, ErrorState } from '../../ui/Display'
import { ActivityDetail } from './ActivityDetail'
import { formatDateTime, formatNumber } from '../../utils/formatTime'
import './OxeQuery.css'

const DECISIONS = new Set(['auto', 'approved', 'approved-session', 'denied', 'refused', 'pending'])
const FILTERS = ['all', 'writes', 'problems'] as const
/** The agent tools that act on containers; the rest reach a database. */
export const isContainerTool = (tool: string): boolean => /^oxespace_containers?_/.test(tool)

/**
 * What agents asked to do and how each request ended; read-only, kept 90 days. One audit records both kinds:
 * OxeQuery shows the database requests, OxePod the container ones.
 */
export function ActivityPanel({ active, scope = 'database' }: { active: boolean; scope?: 'database' | 'containers' }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [entries, setEntries] = useState<OxeQueryAuditEntry[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  // The request shown in full, and its row, where focus goes back when the dialog closes.
  const [detail, setDetail] = useState<OxeQueryAuditEntry | null>(null)
  const detailRow = useRef<HTMLTableRowElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try { setEntries(await oq('audit.list', { limit: 200 })); setError('') } catch (cause) { setError(errorMessage(cause)) }
  }, [])
  useEffect(() => { if (active) void load() }, [active, load])

  const shown = entries.filter(entry => isContainerTool(entry.tool) === (scope === 'containers')).filter(entry => filter === 'all' ? true
    : filter === 'writes' ? /execute|write|action/.test(entry.tool)
      : entry.outcome === 'error' || entry.decision === 'denied' || entry.decision === 'refused')

  const result = (entry: OxeQueryAuditEntry): string => entry.outcome === 'ok'
    ? [entry.rows === null || entry.rows === undefined ? t('activity.rowsUnknown') : t('common.rows', { count: entry.rows, formatted: formatNumber(entry.rows) }), entry.durationMs !== null && entry.durationMs !== undefined ? formatMs(entry.durationMs) : ''].filter(Boolean).join(' · ')
    : entry.outcome === 'skipped' ? t('activity.notRun') : entry.errorCode ? t('activity.failedCode', { code: entry.errorCode }) : t('common.failed')

  const decisionOf = (entry: OxeQueryAuditEntry): string => DECISIONS.has(entry.decision) ? t(`activity.decision.${entry.decision}` as 'activity.decision.auto') : entry.decision
  const show = (entry: OxeQueryAuditEntry, row: HTMLTableRowElement): void => { detailRow.current = row; setDetail(entry) }
  const onRowKey = (entry: OxeQueryAuditEntry) => (event: KeyboardEvent<HTMLTableRowElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(entry, event.currentTarget) }
  }

  return <section className="oq-activity" aria-label={t('activity.label')}>
    <header className="oq-activity-head">
      <ShieldCheck size={15} aria-hidden="true" />
      <strong>{t('activity.label')}</strong>
      <span className="oq-muted">{t(scope === 'containers' ? 'activity.introContainers' : 'activity.intro')}</span>
      <span className="oq-spacer" />
      <div role="group" aria-label={t('activity.filter')} className="oq-segment">
        {FILTERS.map(value => <button key={value} type="button" role="radio" aria-checked={filter === value} data-selected={filter === value} onClick={() => setFilter(value)}>{t(`activity.show.${value}`)}</button>)}
      </div>
      <button type="button" onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" />{t('common.refresh')}</button>
    </header>
    {error && <ErrorState compact title={error} onRetry={() => void load()} />}
    {shown.length === 0 && !error ? <EmptyState icon={<ShieldCheck size={20} />} title={t('activity.emptyTitle')}>{t(scope === 'containers' ? 'activity.emptyContainers' : 'activity.emptyText')}</EmptyState>
      : <table className="oq-activity-table">
        <thead><tr><th>{t('activity.column.when')}</th><th>{t('activity.column.agent')}</th>{scope === 'database' && <th>{t('activity.column.connection')}</th>}<th>{t('activity.column.request')}</th><th>{t('activity.column.decision')}</th><th>{t('activity.column.result')}</th></tr></thead>
        <tbody>{shown.map(entry => <tr key={entry.id} data-outcome={entry.outcome} data-decision={entry.decision} tabIndex={0} aria-haspopup="dialog"
          title={t('activity.detail.open')} onClick={event => show(entry, event.currentTarget)} onKeyDown={onRowKey(entry)}>
          <td>{formatDateTime(entry.ts)}</td>
          <td>{entry.actor}</td>
          {scope === 'database' && <td>{entry.connectionName ?? '—'}{entry.environment ? <small> · {entry.environment}</small> : null}</td>}
          <td><strong>{entry.tool.replace('oxespace_', '')}</strong>{entry.text ? <code title={entry.text}>{entry.text.replace(/\s+/g, ' ').slice(0, 120)}</code> : null}</td>
          <td className="oq-decision">{decisionOf(entry)}</td>
          <td>{result(entry)}</td>
        </tr>)}</tbody>
      </table>}
    {detail && <ActivityDetail entry={detail} scope={scope} decision={decisionOf(detail)} result={result(detail)}
      onClose={() => setDetail(null)} returnFocusTo={() => detailRow.current} />}
  </section>
}
