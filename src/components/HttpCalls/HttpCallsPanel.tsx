import { useEffect, useState, useMemo } from 'react'
import type { HttpAuditRow, HttpAuditView, HttpAuditHostSummary, HttpAuditQuery } from '../../../shared/types/http-audit'
import { formatRowButtonLabel, formatHeaders, formatBodySize, formatResponse, formatAgentName, formatTime } from './httpCallsModel'
import { Button } from '../../ui/Button'
import { EmptyState, ErrorState } from '../../ui/Display'
import { useThreadStore } from '../../store/thread.store'
import './HttpCallsPanel.css'

export function HttpCallsPanel({ workspaceId, actor }: { workspaceId: string; actor?: string }) {
  const [view, setView] = useState<HttpAuditView>('all')
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState<HttpAuditRow[]>([])
  const [hosts, setHosts] = useState<HttpAuditHostSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.oxe?.featureUsage?.record?.('httpCalls') }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const query: HttpAuditQuery = {
      workspaceId,
      ...(actor ? { actor } : {}),
      ...(view !== 'all' ? { view } : {}),
      ...(filter.trim() ? { filter: filter.trim() } : {})
    }
    const list = window.oxe?.httpAudit?.list
    if (!list) {
      setLoading(false)
      return
    }
    list(query)
      .then(page => {
        if (!active) return
        setRows(page.rows || [])
        setHosts(page.hosts || [])
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError("Couldn't read the HTTP log")
        setLoading(false)
      })
    return () => { active = false }
  }, [workspaceId, actor, view, filter])

  const groupedHosts = useMemo(() => {
    const map = new Map<string, { host: string; production: boolean; rows: HttpAuditRow[] }>()
    for (const h of hosts) {
      map.set(h.host, { host: h.host, production: h.production, rows: [] })
    }
    for (const r of rows) {
      const existing = map.get(r.host)
      if (existing) {
        existing.rows.push(r)
        if (r.production) existing.production = true
      } else {
        map.set(r.host, { host: r.host, production: r.production, rows: [r] })
      }
    }
    return Array.from(map.values()).filter(g => g.rows.length > 0)
  }, [hosts, rows])

  const selectedRow = useMemo(() => rows.find(r => r.id === selectedId) || null, [rows, selectedId])

  return (
    <div className="http-calls-panel">
      <div className="http-calls-toolbar">
        <div role="toolbar" className="http-calls-views">
          <button
            type="button"
            className="http-calls-view-btn"
            aria-pressed={view === 'all'}
            onClick={() => setView('all')}
          >
            All
          </button>
          <button
            type="button"
            className="http-calls-view-btn"
            aria-pressed={view === 'errors'}
            onClick={() => setView('errors')}
          >
            Errors
          </button>
          <button
            type="button"
            className="http-calls-view-btn"
            aria-pressed={view === 'flagged'}
            onClick={() => setView('flagged')}
          >
            Flagged
          </button>
        </div>
        <input
          type="text"
          className="http-calls-filter-input"
          aria-label="Filter by host or path"
          placeholder="Filter by host or path"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className="http-calls-content">
        {error ? (
          <ErrorState title={error} compact />
        ) : !loading && rows.length === 0 ? (
          filter.trim() || view !== 'all' ? (
            <EmptyState
              title="Nothing matches"
              actions={<Button variant="secondary" size="sm" onClick={() => { setFilter(''); setView('all') }}>Clear filters</Button>}
            />
          ) : (
            <EmptyState title="No HTTP calls yet. curl, wget and HTTPie calls from agents show up here." />
          )
        ) : (
          <div className="http-calls-list">
            {groupedHosts.map(group => (
              <section key={group.host} className="http-host-section">
                <div className="http-host-heading-row">
                  <h4 className="http-host-heading">{group.host}</h4>
                  {group.production && <span className="http-pill-production">production</span>}
                </div>
                {group.rows.map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className={`http-call-row ${selectedId === row.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(row.id)}
                    aria-label={formatRowButtonLabel(row)}
                  >
                    <div className="http-call-row-main">
                      <span>{row.method} {row.pathTemplate || '/'}, </span>
                      <span>{row.status != null ? row.status : 'No status'}</span>
                      <span>, {formatAgentName(row.agent)}, {formatTime(row.at)}</span>
                    </div>
                    {(row.plainHttpExternal || row.insecure) && (
                      <div className="http-call-row-pills">
                        {row.plainHttpExternal && <span className="http-pill-warning">Not encrypted</span>}
                        {row.insecure && <span className="http-pill-warning">TLS not checked</span>}
                      </div>
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}

        {selectedRow && (
          <aside className="http-call-detail">
            {selectedRow.headerNames && selectedRow.headerNames.length > 0 && (
              <div className="http-detail-headers">{formatHeaders(selectedRow.headerNames)}</div>
            )}
            {selectedRow.hasBody && selectedRow.bodyBytes != null && (
              <div>{formatBodySize(selectedRow.bodyBytes)}</div>
            )}
            {selectedRow.status != null ? (
              <div>{formatResponse(selectedRow.status, selectedRow.durationMs)}</div>
            ) : (
              <div>No status</div>
            )}
            {(selectedRow.sourceKind === 'rollout' || selectedRow.agent === 'codex') && (
              <div>Read after the turn</div>
            )}
            {selectedRow.production && (
              <div className="http-callout-warning">A production host.</div>
            )}
            {selectedRow.plainHttpExternal && (
              <div className="http-callout-warning">Sent without TLS to a host outside this computer.</div>
            )}
            {selectedRow.commandRedacted && (
              <pre>
                <code>{selectedRow.commandRedacted}</code>
              </pre>
            )}
            {selectedRow.actor?.kind === 'thread' && selectedRow.actor.id && (
              <button
                type="button"
                onClick={() => void useThreadStore.getState().select(selectedRow.actor.id)}
              >
                Open the conversation
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
