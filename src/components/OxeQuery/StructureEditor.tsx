import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { OxeQueryConnection, SqlTableDetails } from '../../../shared/types/oxequery'
import type { MaintenanceAction, StructureAction, StructurePlan } from '../../../shared/types/oxequery-structure'
import { Button, Checkbox, Dialog, ErrorState, LoadingState, Tabs, TextArea, TextField } from '../../ui'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { changesFromDraft, createFromDraft, draftFromDetails, draftProblems, emptyDraft, type StructureDraft } from './structure-model'
import { ColumnsTab, ConstraintsTab, IndexesTab } from './StructureParts'
import styles from './StructureEditor.module.css'
import { formatNumber } from '../../utils/formatTime'
import { formatBytes, formatMs } from './catalog'

type TabId = 'columns' | 'constraints' | 'indexes' | 'table'
/** Maintenance buttons carry the PostgreSQL command they run, the same in every language. */
const MAINTENANCE_SQL: Record<MaintenanceAction, string> = { vacuum: 'VACUUM', analyze: 'ANALYZE', 'vacuum-analyze': 'VACUUM ANALYZE', reindex: 'REINDEX' }
export type StructureOutcome = { kind: 'created' | 'altered'; table: string } | { kind: 'dropped' | 'truncated' | 'duplicated'; table: string }

interface Props {
  connection: OxeQueryConnection
  schema: string
  /** The table to edit, or null to create one. */
  table: string | null
  onClose: () => void
  onChanged: (outcome: StructureOutcome) => void
}

/**
 * Create a table or change its structure. Every edit is staged in a draft; "Review" asks the main
 * process for the exact DDL and its warnings, and "Apply" runs it in one transaction. The page never
 * sends SQL text: the shapes in `oxequery-structure` are turned into statements on the other side.
 */
export function StructureEditor({ connection, schema, table, onClose, onChanged }: Props): ReactElement {
  const { t } = useTranslation('oxequery')
  const creating = table === null
  const [details, setDetails] = useState<SqlTableDetails | null>(null)
  const [draft, setDraft] = useState<StructureDraft>(() => emptyDraft())
  const [tab, setTab] = useState<TabId>('columns')
  const [plan, setPlan] = useState<{ action: StructureAction; value: StructurePlan; label: string } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [note, setNote] = useState('')
  const [copyName, setCopyName] = useState(table ? `${table}_copy` : '')
  const [copyData, setCopyData] = useState(false)
  const [restartIdentity, setRestartIdentity] = useState(false)
  const [cascade, setCascade] = useState(false)
  const production = connection.environment === 'prod'

  useEffect(() => {
    if (table === null) return
    let alive = true
    oq('sql.table', { connectionId: connection.id, schema, table }).then(
      value => { if (alive) { setDetails(value); setDraft(draftFromDetails(table, value)) } },
      cause => { if (alive) setLoadError(errorMessage(cause)) })
    return () => { alive = false }
  }, [connection.id, schema, table])

  const edit = useCallback((next: StructureDraft): void => { setDraft(next); setPlan(null); setConfirmed(false); setError('') }, [])
  const originalComment = details?.properties?.comment ?? ''
  const changes = useMemo(() => table === null ? [] : changesFromDraft(draft, table, originalComment), [draft, table, originalComment])
  const problems = useMemo(() => draftProblems(draft, creating), [draft, creating])
  const pending = creating ? problems.length === 0 : changes.length > 0

  const review = async (action: StructureAction, label: string): Promise<void> => {
    setBusy(true); setError(''); setNote(''); setConfirmed(false)
    try {
      const value = await oq('sql.structure.preview', { connectionId: connection.id, schema, table: creating ? draft.tableName.trim() : table!, action })
      setPlan({ action, value, label })
    } catch (cause) { setPlan(null); setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const reviewDraft = (): Promise<void> => review(creating ? { kind: 'create', table: createFromDraft(draft) } : { kind: 'alter', changes }, creating ? t('structure.createTable') : t('structure.applyChanges'))

  const apply = async (): Promise<void> => {
    if (!plan) return
    setBusy(true); setError('')
    try {
      const name = creating ? draft.tableName.trim() : table!
      await oq('sql.structure.apply', { connectionId: connection.id, schema, table: name, action: plan.action, confirmed })
      const kind = plan.action.kind
      if (kind === 'create') onChanged({ kind: 'created', table: name })
      else if (kind === 'alter') onChanged({ kind: 'altered', table: draft.tableName.trim() || name })
      else if (kind === 'drop') onChanged({ kind: 'dropped', table: name })
      else if (kind === 'truncate') onChanged({ kind: 'truncated', table: name })
      else onChanged({ kind: 'duplicated', table: plan.action.kind === 'duplicate' ? plan.action.to : name })
      onClose()
    } catch (cause) {
      setError(cause instanceof OxeQueryClientError && cause.code === 'confirm' ? `${cause.message}\n${cause.reasons.join('\n')}` : errorMessage(cause))
    } finally { setBusy(false) }
  }

  const maintain = async (action: MaintenanceAction, confirmedRun = false): Promise<void> => {
    if (table === null) return
    setBusy(true); setError(''); setNote('')
    try {
      const done = await oq('sql.maintenance', { connectionId: connection.id, schema, table, action, confirmed: confirmedRun })
      setNote(t('structure.maintenanceDone', { statement: done.statement, duration: formatMs(done.durationMs) }))
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const needsConfirm = Boolean(plan && (plan.value.destructive || production))
  const readOnly = connection.readOnly
  const tableTab = !creating && <div className={styles.section}>
    {details?.properties && <dl className={styles.facts}>
      <div><dt>{t('structure.kind')}</dt><dd>{details.properties.kind}</dd></div>
      <div><dt>{t('server.column.owner')}</dt><dd>{details.properties.owner}</dd></div>
      <div><dt>{t('server.column.size')}</dt><dd>{formatBytes(details.properties.sizeBytes)}</dd></div>
      <div><dt>{t('structure.rowsEstimate')}</dt><dd>{formatNumber(details.properties.estimatedRows)}</dd></div>
    </dl>}
    {details && details.dependents.length > 0 && <>
      <h4 className={styles.heading}>{t('structure.usedBy')}</h4>
      <ul className={styles.list} aria-label={t('structure.dependents')}>{details.dependents.map(item => <li key={`${item.kind}:${item.schema}.${item.name}`}><span>{item.schema}.{item.name}</span><span className={styles.note}>{item.kind}</span></li>)}</ul>
    </>}
    {details && details.privileges.length > 0 && <>
      <h4 className={styles.heading}>{t('structure.privileges')}</h4>
      <ul className={styles.list} aria-label={t('structure.privileges')}>{details.privileges.map(item => <li key={`${item.grantee}:${item.privilege}`}><span>{item.grantee}</span><span className={styles.note}>{item.privilege}{item.grantable ? ` ${t('structure.canGrant')}` : ''}</span></li>)}</ul>
    </>}
    <TextField mono label={t('server.column.name')} value={draft.tableName} onChange={event => edit({ ...draft, tableName: event.target.value })} />
    <TextArea label={t('structure.comment')} rows={2} value={draft.comment} onChange={event => edit({ ...draft, comment: event.target.value })} />
    <h4 className={styles.heading}>{t('structure.maintenance')}</h4>
    <div className={styles.actions}>
      <Button size="sm" disabled={busy || readOnly} title={t('structure.vacuumTitle')} onClick={() => void maintain('vacuum')}>{MAINTENANCE_SQL.vacuum}</Button>
      <Button size="sm" disabled={busy || readOnly} title={t('structure.analyzeTitle')} onClick={() => void maintain('analyze')}>{MAINTENANCE_SQL.analyze}</Button>
      <Button size="sm" disabled={busy || readOnly} title={t('structure.vacuumAnalyzeTitle')} onClick={() => void maintain('vacuum-analyze')}>{MAINTENANCE_SQL['vacuum-analyze']}</Button>
      <Button size="sm" disabled={busy || readOnly} onClick={() => void maintain('reindex', true)} title={t('structure.reindexTitle')}>{MAINTENANCE_SQL.reindex}</Button>
    </div>
    <h4 className={styles.heading}>{t('structure.copy')}</h4>
    <div className={styles.row}>
      <TextField mono aria-label={t('structure.copyName')} value={copyName} onChange={event => setCopyName(event.target.value)} />
      <Checkbox label={t('structure.copyRows')} checked={copyData} onChange={event => setCopyData(event.target.checked)} />
      <Button size="sm" disabled={busy || readOnly || !copyName.trim()} onClick={() => void review({ kind: 'duplicate', to: copyName.trim(), withData: copyData }, t('structure.duplicateTable'))}>{t('structure.reviewCopy')}</Button>
    </div>
    <h4 className={styles.heading}>{t('structure.danger')}</h4>
    <div className={styles.row}>
      <Checkbox label={t('structure.restartIdentity')} checked={restartIdentity} onChange={event => setRestartIdentity(event.target.checked)} />
      <Checkbox label={t('structure.cascade')} checked={cascade} onChange={event => setCascade(event.target.checked)} />
      <Button size="sm" variant="danger" disabled={busy || readOnly} onClick={() => void review({ kind: 'truncate', restartIdentity, cascade }, t('structure.truncateTable'))}>{t('structure.reviewTruncate')}</Button>
      <Button size="sm" variant="danger" disabled={busy || readOnly} onClick={() => void review({ kind: 'drop' }, t('structure.dropTable'))}>{t('structure.reviewDrop')}</Button>
    </div>
  </div>

  const body = loadError
    ? <ErrorState compact title={t('structure.loadFailed')} message={loadError} />
    : !creating && !details ? <LoadingState label={t('structure.loading')} />
      : <>
        {creating && <div className={styles.name}><TextField mono autoFocus label={t('structure.tableName')} value={draft.tableName} onChange={event => edit({ ...draft, tableName: event.target.value })} />
          <TextField label={t('structure.commentOptional')} value={draft.comment} onChange={event => edit({ ...draft, comment: event.target.value })} /></div>}
        <Tabs<TabId> label={t('tree.structure')} value={tab} onChange={setTab} tabs={[
          { value: 'columns', label: t('structure.columns'), content: <ColumnsTab draft={draft} details={details} onChange={edit} /> },
          { value: 'constraints', label: t('structure.constraints'), content: <ConstraintsTab draft={draft} details={details} onChange={edit} /> },
          { value: 'indexes', label: t('structure.indexes'), content: <IndexesTab draft={draft} details={details} onChange={edit} /> },
          ...(creating ? [] : [{ value: 'table' as const, label: t('structure.table'), content: tableTab }])
        ]} />
        {!plan && problems.length > 0 && <ul className={styles.problems} aria-label={t('structure.toFix')}>{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
        {plan && <section className={styles.plan} aria-label={t('structure.review')}>
          <h4 className={styles.heading}>{plan.label}</h4>
          {plan.value.warnings.length > 0 && <ul className={styles.warnings}>{plan.value.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <pre className={styles.sql} tabIndex={0}>{plan.value.statements.map(statement => `${statement};`).join('\n\n')}</pre>
          <p className={styles.note}>{t('structure.oneTransaction')}</p>
          {needsConfirm && <Checkbox label={plan.value.destructive ? t('structure.understand') : t('structure.productionApply')} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />}
        </section>}
        {error && <ErrorState compact title={t('structure.failed')} message={error} />}
        {note && <p role="status" className={styles.ok}>{note}</p>}
      </>

  return <Dialog className="oq-scope" title={creating ? t('tree.newTableIn', { schema }) : `${schema}.${table}`} description={creating ? t('structure.createDescription') : t('structure.editDescription')} closeLabel={t('common.close')}
    size="xl" onClose={onClose} testId="structure-editor"
    footer={<>
      <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      {plan && <Button variant={plan.value.destructive ? 'danger' : 'primary'} loading={busy} disabled={readOnly || (needsConfirm && !confirmed)} onClick={() => void apply()}>{plan.label}</Button>}
      {!plan && !loadError && <Button variant="primary" loading={busy} disabled={readOnly || !pending || problems.length > 0} onClick={() => void reviewDraft()}>{t('structure.reviewSql')}</Button>}
    </>}>
    {readOnly && <p role="note" className={styles.note}>{t('structure.readOnly')}</p>}
    {body}
  </Dialog>
}
