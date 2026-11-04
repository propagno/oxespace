import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, SquarePen } from 'lucide-react'
import type { OxeQueryAuditEntry } from '../../../shared/types/oxequery'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import { Notice } from '../../ui/Display'
import { formatDateTime, formatNumber } from '../../utils/formatTime'
import { copyText, formatMs } from './catalog'
import { useOxeQueryStore } from './oxequery.store'
import { formatSql } from './sql-snippets'

/** A JSON request (a document filter, a container action) shown indented; anything else as it was recorded. */
function formatJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

/**
 * One agent request from the audit, in full (T63): the whole statement formatted, everything the audit recorded about
 * it, Copy, and "Open in editor", which only puts the statement in a new query tab. The audit never holds the data a
 * request returned, so the dialog says how to see it: run the statement in the editor.
 */
export function ActivityDetail({ entry, scope, decision, result, onClose, returnFocusTo }: {
  entry: OxeQueryAuditEntry
  scope: 'database' | 'containers'
  /** The decision and the result as the table words them. */
  decision: string
  result: string
  onClose: () => void
  returnFocusTo: () => HTMLElement | null
}): ReactElement {
  const { t } = useTranslation('oxequery')
  const connection = useOxeQueryStore(state => entry.connectionId ? state.connections.find(item => item.id === entry.connectionId) : undefined)
  const sql = entry.engine === 'postgres' || connection?.engine === 'postgres'
  const raw = entry.text ?? ''
  // SQL is formatted by a module loaded on first use; until it is, the statement shows as recorded.
  const [formatted, setFormatted] = useState<{ raw: string; text: string } | null>(null)
  useEffect(() => {
    if (!raw || !sql) return
    let alive = true
    void formatSql(raw).then(text => { if (alive) setFormatted({ raw, text }) })
    return () => { alive = false }
  }, [raw, sql])
  const text = sql ? (formatted?.raw === raw ? formatted.text : raw) : formatJson(raw)

  const canOpen = scope === 'database' && sql && Boolean(entry.text) && Boolean(connection)
  const open = (): void => {
    if (!entry.connectionId) return
    onClose()
    useOxeQueryStore.getState().openInEditor(entry.connectionId, text)
  }
  const rows = entry.rows === null || entry.rows === undefined ? '—' : formatNumber(entry.rows)
  const facts: Array<[string, string]> = [
    [t('activity.column.when'), formatDateTime(entry.ts)],
    [t('activity.column.agent'), entry.actor],
    ...(scope === 'database' ? [[t('activity.column.connection'), entry.connectionName ?? '—'] as [string, string], [t('activity.detail.environment'), entry.environment ?? '—'] as [string, string]] : []),
    [t('activity.detail.tool'), entry.tool.replace('oxespace_', '')],
    [t('activity.column.decision'), decision],
    [t('activity.column.result'), result],
    [t('activity.detail.rows'), rows],
    [t('activity.detail.duration'), entry.durationMs === null || entry.durationMs === undefined ? '—' : formatMs(entry.durationMs)],
    ...(entry.errorCode ? [[t('activity.detail.error'), entry.errorCode] as [string, string]] : [])
  ]

  return <Dialog title={t('activity.detail.title')} onClose={onClose} returnFocusTo={returnFocusTo} size="lg" testId="oq-activity-detail"
    footer={<>
      {entry.text ? <Button icon={<Copy size={13} aria-hidden="true" />} onClick={() => void copyText(text, t('activity.detail.statement'))}>{t('common.copy')}</Button> : null}
      {canOpen ? <Button variant="primary" icon={<SquarePen size={13} aria-hidden="true" />} onClick={open}>{t('activity.detail.openInEditor')}</Button> : null}
    </>}>
    <dl className="oq-activity-facts">
      {facts.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
    </dl>
    <h3 className="oq-activity-detail-heading">{t('activity.detail.statement')}</h3>
    {entry.text
      ? <pre className="oq-activity-statement" tabIndex={0} aria-label={t('activity.detail.statement')}><code>{text}</code></pre>
      : <p className="oq-muted">{t('activity.detail.noStatement')}</p>}
    <Notice intent="info">{scope === 'database'
      ? (canOpen ? t('activity.detail.noDataOpen') : t('activity.detail.noData'))
      : t('activity.detail.noDataContainers')}</Notice>
  </Dialog>
}
