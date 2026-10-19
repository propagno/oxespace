import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AgentActionEntry } from '../../../shared/types/mcp-internal'
import { Button } from '../../ui'

const DECISIONS: Record<AgentActionEntry['decision'], string> = {
  auto: 'ran', approved: 'you approved', denied: 'you declined', refused: 'refused by policy', pending: 'waiting for you'
}

function tone(entry: AgentActionEntry): 'ok' | 'warning' | 'error' {
  if (entry.outcome === 'error') return 'error'
  if (entry.decision === 'denied' || entry.decision === 'pending' || entry.outcome === 'skipped') return 'warning'
  return 'ok'
}

/** Changes agents made through the OXESpace MCP tools (reads are not listed); kept 90 days. */
export function AgentActivitySettings(): ReactElement {
  const [entries, setEntries] = useState<AgentActionEntry[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setEntries((await window.oxe.mcpInternal.actionAudit(100)) ?? []); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setEntries([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  return <div className="settings-form-group" data-testid="agent-activity">
    <h3 className="settings-form-group-title">Agent activity</h3>
    <p className="settings-field-hint">
      What agents changed through OXESpace (commits, pushes, pull requests, Threads, tasks, skills, automations) and what you decided.
      Database and container requests are listed in OxeQuery.
    </p>
    {error ? <div className="settings-callout" role="alert">{error}</div> : null}
    {entries && entries.length === 0 && !error
      ? <div className="settings-callout">No agent changes yet.</div>
      : <div className="diagnostics-checks" role="list" aria-label="Agent changes">
        {(entries ?? []).map(entry => <div key={entry.id} role="listitem" className={`diagnostics-check tone-${tone(entry)}`}>
          <span className="diagnostics-check-dot" aria-hidden="true" />
          <span className="diagnostics-check-label">{entry.tool.replace(/^oxespace_/, '')}.{entry.action}</span>
          <span className="diagnostics-check-detail" title={entry.text ?? undefined}>
            {new Date(entry.ts).toLocaleString()} · {entry.actor} · {DECISIONS[entry.decision] ?? entry.decision}
            {entry.outcome === 'error' ? ` · failed${entry.errorCode ? ` (${entry.errorCode})` : ''}` : ''}
            {entry.text ? ` — ${entry.text.replace(/\s+/g, ' ').slice(0, 140)}` : ''}
          </span>
        </div>)}
      </div>}
    <div className="settings-inline-actions">
      <Button variant="ghost" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> Refresh activity</Button>
    </div>
  </div>
}
