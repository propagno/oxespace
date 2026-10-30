import { useEffect, useState, type ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DIAGNOSTICS_AREAS, type DiagnosticsArea, type DiagnosticsIncident } from '../../../shared/types/diagnostics'
import { formatMainMessage, loadMainMessages } from '../../i18n/messages'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel, Select, toast } from '../../ui'
import { formatDateTime, formatRelative } from '../../utils/formatTime'
import { humanizeError } from '../../utils/humanizeError'
import type { JournalStatus } from './useDiagnostics'
import styles from './Diagnostics.module.css'

type Filter = DiagnosticsArea | 'all'

/**
 * The problem journal as a timeline, newest first, filtered by area. Each entry is the C3 code's words in the
 * interface language (the `main` catalog), how often and when it happened, and what to do about it.
 */
export function IncidentJournal({ incidents, status, reload }: { incidents: DiagnosticsIncident[]; status: JournalStatus; reload: () => void }): ReactElement {
  const { t } = useTranslation('settings')
  const [catalog, setCatalog] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  useEffect(() => {
    let alive = true
    void loadMainMessages().catch(() => undefined).finally(() => { if (alive) setCatalog(true) })
    return () => { alive = false }
  }, [])

  const counts = new Map<DiagnosticsArea, number>()
  for (const incident of incidents) counts.set(incident.area, (counts.get(incident.area) ?? 0) + 1)
  // A filter whose area emptied (the journal was cleared) falls back to every area.
  const active: Filter = filter !== 'all' && !counts.has(filter) ? 'all' : filter
  const shown = active === 'all' ? incidents : incidents.filter(incident => incident.area === active)
  const api = window.oxe?.diagnostics

  const clear = async (): Promise<void> => {
    if (!api?.clearIncidents) return
    setClearing(true)
    try {
      await api.clearIncidents()
      toast({ title: t('diagnostics.journal.cleared'), intent: 'success' })
      setConfirming(false)
      reload()
    } catch (cause) {
      toast({ title: t('diagnostics.journal.clearFailed'), description: humanizeError(cause), intent: 'danger' })
    } finally { setClearing(false) }
  }

  const actions = status === 'ready' && incidents.length > 0 ? <>
    <Select aria-label={t('diagnostics.journal.area')} value={active} onChange={event => setFilter(event.target.value as Filter)} className={styles.areaSelect}
      options={[{ value: 'all', label: t('diagnostics.journal.allAreas', { count: incidents.length }) },
        ...DIAGNOSTICS_AREAS.filter(area => counts.has(area)).map(area => ({ value: area, label: t('diagnostics.journal.areaOption', { area: t(`diagnostics.journal.areas.${area}`), count: counts.get(area) }) }))]} />
    {api?.clearIncidents && <Button variant="ghost" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setConfirming(true)}>{t('diagnostics.journal.clear')}</Button>}
  </> : undefined

  let body: ReactElement
  if (status === 'loading' || (status === 'ready' && !catalog)) body = <LoadingState label={t('diagnostics.journal.loading')} />
  else if (status === 'failed' || status === 'unavailable') body = <ErrorState compact title={t('diagnostics.journal.failed')} onRetry={status === 'failed' ? reload : undefined} />
  else if (!incidents.length) body = <EmptyState compact title={t('diagnostics.journal.empty')} />
  else if (!shown.length) body = <EmptyState compact title={t('diagnostics.journal.emptyArea')} />
  else body = <ol className={styles.timeline} aria-label={t('diagnostics.journal.list')} data-testid="diagnostics-incidents">
    {shown.map(incident => <li key={incident.id} className={styles.incident} data-area={incident.area}>
      <span className={styles.incidentMark} aria-hidden="true" />
      <div className={styles.incidentBody}>
        <p className={styles.incidentText}>
          <Badge>{t(`diagnostics.journal.areas.${incident.area}`)}</Badge>
          <span>{formatMainMessage({ code: incident.code, params: {} })}</span>
        </p>
        <p className={styles.detail}>
          <time dateTime={new Date(incident.lastAt).toISOString()} title={formatDateTime(incident.lastAt)}>
            {t('diagnostics.journal.when', { last: formatRelative(incident.lastAt), times: t('diagnostics.journal.times', { count: incident.count }) })}
          </time>
        </p>
        <p className={styles.action}><strong>{t('diagnostics.health.whatToDo')}</strong> {t(`diagnostics.journal.actions.${incident.area}`)}</p>
      </div>
    </li>)}
  </ol>

  return <Panel title={t('diagnostics.journal.title')} actions={actions} className={styles.section} label={t('diagnostics.journal.title')}>
    <p className={styles.note}>{t('diagnostics.journal.description')}</p>
    {body}
    {confirming && <ConfirmDialog title={t('diagnostics.journal.clearTitle')} description={t('diagnostics.journal.clearDescription')}
      confirmLabel={t('diagnostics.journal.clear')} danger busy={clearing} onConfirm={() => { void clear() }} onCancel={() => setConfirming(false)} />}
  </Panel>
}
