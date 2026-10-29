import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import type { OxeQueryAuditEntry } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { EmptyState } from '../../ui/Display'
import { formatDateTime } from '../../utils/formatTime'

const DECISIONS: Record<string, string> = {
  auto: 'allowed', approved: 'approved', 'approved-session': 'approved (run)', denied: 'declined', refused: 'refused by policy', pending: 'waiting for you'
}

/** What agents asked OxeQuery to do and how each request ended; read-only, kept 90 days. */
export function ActivityPanel({ active }: { active: boolean }): ReactElement {
  const [entries, setEntries] = useState<OxeQueryAuditEntry[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'writes' | 'problems'>('all')

  const load = useCallback(async (): Promise<void> => {
    try { setEntries(await oq('audit.list', { limit: 200 })); setError('') } catch (cause) { setError(errorMessage(cause)) }
  }, [])
  useEffect(() => { if (active) void load() }, [active, load])

  const shown = entries.filter(entry => filter === 'all' ? true
    : filter === 'writes' ? /execute|write|action/.test(entry.tool)
      : entry.outcome === 'error' || entry.decision === 'denied' || entry.decision === 'refused')

  return <section className="oq-activity" aria-label="Agent activity">
    <header className="oq-activity-head">
      <ShieldCheck size={15} aria-hidden="true" />
      <strong>Agent activity</strong>
      <span className="oq-muted">Every database or container request an AI agent made, and what you decided.</span>
      <span className="oq-spacer" />
      <div role="group" aria-label="Filter" className="oq-segment">
        {(['all', 'writes', 'problems'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={filter === value} data-selected={filter === value} onClick={() => setFilter(value)}>{value}</button>)}
      </div>
      <button type="button" onClick={() => void load()}><RefreshCw size={13} aria-hidden="true" />Refresh</button>
    </header>
    {error && <p role="alert" className="oq-error">{error}</p>}
    {shown.length === 0 && !error ? <div className="oq-empty"><EmptyState icon={<ShieldCheck size={20} />} title="No agent requests yet">Agents only reach a database when you turn on agent access for a connection. Every request they make appears here, with what you decided.</EmptyState></div>
      : <table className="oq-activity-table">
        <thead><tr><th>When</th><th>Agent</th><th>Connection</th><th>Request</th><th>Decision</th><th>Result</th></tr></thead>
        <tbody>{shown.map(entry => <tr key={entry.id} data-outcome={entry.outcome} data-decision={entry.decision}>
          <td>{formatDateTime(entry.ts)}</td>
          <td>{entry.actor}</td>
          <td>{entry.connectionName ?? '—'}{entry.environment ? <small> · {entry.environment}</small> : null}</td>
          <td><strong>{entry.tool.replace('oxespace_', '')}</strong>{entry.text ? <code title={entry.text}>{entry.text.replace(/\s+/g, ' ').slice(0, 120)}</code> : null}</td>
          <td>{DECISIONS[entry.decision] ?? entry.decision}</td>
          <td>{entry.outcome === 'ok' ? `${entry.rows ?? '–'} rows${entry.durationMs !== null ? ` · ${entry.durationMs} ms` : ''}` : entry.outcome === 'skipped' ? 'not run' : `failed${entry.errorCode ? ` (${entry.errorCode})` : ''}`}</td>
        </tr>)}</tbody>
      </table>}
  </section>
}
