import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentActionEntry } from '../../../shared/types/mcp-internal'
import { Button, EmptyState, ErrorState } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'

function tone(entry: AgentActionEntry): 'ok' | 'warning' | 'error' {
  if (entry.outcome === 'error') return 'error'
  if (entry.decision === 'denied' || entry.decision === 'pending' || entry.outcome === 'skipped') return 'warning'
  return 'ok'
}

/** Changes agents made through the OXESpace MCP tools (reads are not listed); kept 90 days. */
export function AgentActivitySettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [entries, setEntries] = useState<AgentActionEntry[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setEntries((await window.oxe.mcpInternal.actionAudit(100)) ?? []); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setEntries([]) }
  }, [])
  useEffect(() => { void load() }, [load])
  const [saved, setSaved] = useState('')
  // Thread permission decisions, agent actions and OxeQuery requests, one JSON object per line, secrets removed.
  const exportAudit = async (): Promise<void> => {
    try {
      const path = await window.oxe.mcpInternal.exportAudit()
      setSaved(path ? t('activity.savedAudit', { path }) : ''); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return <div className="settings-form-group" data-testid="agent-activity">
    <h3 className="settings-form-group-title">{t('activity.title')}</h3>
    <p className="settings-field-hint">{t('activity.hint')}</p>
    {error ? <ErrorState compact title={error} /> : null}
    {entries && entries.length === 0 && !error
      ? <EmptyState compact title={t('activity.empty')} />
      : <div className="diagnostics-checks" role="list" aria-label={t('activity.list')}>
        {(entries ?? []).map(entry => <div key={entry.id} role="listitem" className={`diagnostics-check tone-${tone(entry)}`}>
          <span className="diagnostics-check-dot" aria-hidden="true" />
          <span className="diagnostics-check-label">{entry.tool.replace(/^oxespace_/, '')}.{entry.action}</span>
          <span className="diagnostics-check-detail" title={entry.text ?? undefined}>
            {formatDateTime(entry.ts)} · {entry.actor} · {t(`activity.decisions.${entry.decision}`, { defaultValue: entry.decision })}
            {entry.outcome === 'error' ? ` · ${entry.errorCode ? t('activity.failedWithCode', { code: entry.errorCode }) : t('activity.failed')}` : ''}
            {entry.text ? ` — ${entry.text.replace(/\s+/g, ' ').slice(0, 140)}` : ''}
          </span>
        </div>)}
      </div>}
    <div className="settings-inline-actions">
      <Button variant="ghost" onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" /> {t('activity.refresh')}</Button>
      <Button variant="ghost" onClick={() => void exportAudit()}><Download size={14} aria-hidden="true" /> {t('activity.export')}</Button>
    </div>
    {saved ? <p className="settings-field-hint" role="status">{saved}</p> : null}
  </div>
}
