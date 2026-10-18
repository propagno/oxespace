import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { OxeQueryConnection, SqlTableDetails } from '../../../shared/types/oxequery'
import type { MaintenanceAction, StructureAction, StructurePlan } from '../../../shared/types/oxequery-structure'
import { Button, Checkbox, Dialog, Tabs, TextArea, TextField } from '../../ui'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { changesFromDraft, createFromDraft, draftFromDetails, draftProblems, emptyDraft, type StructureDraft } from './structure-model'
import { ColumnsTab, ConstraintsTab, IndexesTab } from './StructureParts'
import styles from './StructureEditor.module.css'

type TabId = 'columns' | 'constraints' | 'indexes' | 'table'
export type StructureOutcome = { kind: 'created' | 'altered'; table: string } | { kind: 'dropped' | 'truncated' | 'duplicated'; table: string }

interface Props {
  connection: OxeQueryConnection
  schema: string
  /** The table to edit, or null to create one. */
  table: string | null
  onClose: () => void
  onChanged: (outcome: StructureOutcome) => void
}

const bytes = (value: number): string => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`

/**
 * Create a table or change its structure. Every edit is staged in a draft; "Review" asks the main
 * process for the exact DDL and its warnings, and "Apply" runs it in one transaction. The page never
 * sends SQL text: the shapes in `oxequery-structure` are turned into statements on the other side.
 */
export function StructureEditor({ connection, schema, table, onClose, onChanged }: Props): ReactElement {
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

  const reviewDraft = (): Promise<void> => review(creating ? { kind: 'create', table: createFromDraft(draft) } : { kind: 'alter', changes }, creating ? 'Create table' : 'Apply changes')

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
      setNote(`${done.statement} finished in ${done.durationMs} ms.`)
    } catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }

  const needsConfirm = Boolean(plan && (plan.value.destructive || production))
  const readOnly = connection.readOnly
  const tableTab = !creating && <div className={styles.section}>
    {details?.properties && <dl className={styles.facts}>
      <div><dt>Kind</dt><dd>{details.properties.kind}</dd></div>
      <div><dt>Owner</dt><dd>{details.properties.owner}</dd></div>
      <div><dt>Size</dt><dd>{bytes(details.properties.sizeBytes)}</dd></div>
      <div><dt>Rows (estimate)</dt><dd>{details.properties.estimatedRows.toLocaleString()}</dd></div>
    </dl>}
    {details && details.dependents.length > 0 && <>
      <h4 className={styles.heading}>Used by</h4>
      <ul className={styles.list} aria-label="Dependents">{details.dependents.map(item => <li key={`${item.kind}:${item.schema}.${item.name}`}><span>{item.schema}.{item.name}</span><span className={styles.note}>{item.kind}</span></li>)}</ul>
    </>}
    {details && details.privileges.length > 0 && <>
      <h4 className={styles.heading}>Privileges</h4>
      <ul className={styles.list} aria-label="Privileges">{details.privileges.map(item => <li key={`${item.grantee}:${item.privilege}`}><span>{item.grantee}</span><span className={styles.note}>{item.privilege}{item.grantable ? ' (can grant)' : ''}</span></li>)}</ul>
    </>}
    <TextField mono label="Name" value={draft.tableName} onChange={event => edit({ ...draft, tableName: event.target.value })} />
    <TextArea label="Comment" rows={2} value={draft.comment} onChange={event => edit({ ...draft, comment: event.target.value })} />
    <h4 className={styles.heading}>Maintenance</h4>
    <div className={styles.actions}>
      <Button size="sm" disabled={busy || readOnly} onClick={() => void maintain('vacuum')}>Vacuum</Button>
      <Button size="sm" disabled={busy || readOnly} onClick={() => void maintain('analyze')}>Analyze</Button>
      <Button size="sm" disabled={busy || readOnly} onClick={() => void maintain('vacuum-analyze')}>Vacuum + analyze</Button>
      <Button size="sm" disabled={busy || readOnly} onClick={() => void maintain('reindex', true)} title="Locks the table while its indexes are rebuilt">Reindex</Button>
    </div>
    <h4 className={styles.heading}>Copy</h4>
    <div className={styles.row}>
      <TextField mono aria-label="Name of the copy" value={copyName} onChange={event => setCopyName(event.target.value)} />
      <Checkbox label="Copy the rows too" checked={copyData} onChange={event => setCopyData(event.target.checked)} />
      <Button size="sm" disabled={busy || readOnly || !copyName.trim()} onClick={() => void review({ kind: 'duplicate', to: copyName.trim(), withData: copyData }, 'Duplicate table')}>Review copy</Button>
    </div>
    <h4 className={styles.heading}>Danger zone</h4>
    <div className={styles.row}>
      <Checkbox label="Restart identity" checked={restartIdentity} onChange={event => setRestartIdentity(event.target.checked)} />
      <Checkbox label="Cascade to referencing tables" checked={cascade} onChange={event => setCascade(event.target.checked)} />
      <Button size="sm" variant="danger" disabled={busy || readOnly} onClick={() => void review({ kind: 'truncate', restartIdentity, cascade }, 'Truncate table')}>Review truncate</Button>
      <Button size="sm" variant="danger" disabled={busy || readOnly} onClick={() => void review({ kind: 'drop' }, 'Drop table')}>Review drop</Button>
    </div>
  </div>

  const body = loadError
    ? <p role="alert" className={styles.error}>{loadError}</p>
    : !creating && !details ? <p className={styles.note}>Loading the structure…</p>
      : <>
        {creating && <div className={styles.name}><TextField mono autoFocus label="Table name" value={draft.tableName} onChange={event => edit({ ...draft, tableName: event.target.value })} />
          <TextField label="Comment (optional)" value={draft.comment} onChange={event => edit({ ...draft, comment: event.target.value })} /></div>}
        <Tabs<TabId> label="Structure" value={tab} onChange={setTab} tabs={[
          { value: 'columns', label: 'Columns', content: <ColumnsTab draft={draft} details={details} onChange={edit} /> },
          { value: 'constraints', label: 'Constraints', content: <ConstraintsTab draft={draft} details={details} onChange={edit} /> },
          { value: 'indexes', label: 'Indexes', content: <IndexesTab draft={draft} details={details} onChange={edit} /> },
          ...(creating ? [] : [{ value: 'table' as const, label: 'Table', content: tableTab }])
        ]} />
        {!plan && problems.length > 0 && <ul className={styles.problems} aria-label="To fix">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
        {plan && <section className={styles.plan} aria-label="Review">
          <h4 className={styles.heading}>{plan.label}</h4>
          {plan.value.warnings.length > 0 && <ul className={styles.warnings}>{plan.value.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <pre className={styles.sql} tabIndex={0}>{plan.value.statements.map(statement => `${statement};`).join('\n\n')}</pre>
          <p className={styles.note}>Runs in one transaction: if a statement fails, none of them is kept.</p>
          {needsConfirm && <Checkbox label={plan.value.destructive ? 'I understand this cannot be undone' : 'This is a production connection: apply the change'} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />}
        </section>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {note && <p role="status" className={styles.ok}>{note}</p>}
      </>

  return <Dialog className="oq-scope" title={creating ? `New table in ${schema}` : `${schema}.${table}`} description={creating ? 'Define the columns, keys and indexes, then review the SQL before it runs.' : 'Edit the columns, keys and indexes. Nothing changes until you apply.'}
    size="xl" onClose={onClose} testId="structure-editor"
    footer={<>
      <Button variant="ghost" onClick={onClose}>Close</Button>
      {plan && <Button variant={plan.value.destructive ? 'danger' : 'primary'} loading={busy} disabled={readOnly || (needsConfirm && !confirmed)} onClick={() => void apply()}>{plan.label}</Button>}
      {!plan && !loadError && <Button variant="primary" loading={busy} disabled={readOnly || !pending || problems.length > 0} onClick={() => void reviewDraft()}>Review SQL</Button>}
    </>}>
    {readOnly && <p role="note" className={styles.note}>This connection is read-only. You can look at the structure but not change it.</p>}
    {body}
  </Dialog>
}
