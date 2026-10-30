import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Download, Eye, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { ExportFormat, OxeQueryConnection, SqlCellValue, SqlEditability, SqlResult, SqlRowChange } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { displayCell } from './ResultGrid'
import { toast } from '../../ui/Toast'
import { ErrorState, LoadingState } from '../../ui/Display'
import { tq } from './catalog'
import { SQL_NULL } from './grid-format'
import { formatNumber } from '../../utils/formatTime'

interface Props {
  connection: OxeQueryConnection
  schema: string
  table: string
  result: SqlResult
  selectedRow: number | null
  onClearSelection: () => void
  /** Called after changes were written so the page can be read again. */
  onApplied: () => void
}

type Draft = Record<string, { value: string; isNull: boolean }>

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function describeChange(change: SqlRowChange): string {
  if (change.kind === 'insert') return tq('rows.change.insert', { columns: Object.keys(change.values).join(', ') || tq('rows.change.defaults') })
  const key = Object.entries(change.key).map(([name, value]) => `${name} = ${cellText(value)}`).join(', ')
  return change.kind === 'delete' ? tq('rows.change.delete', { key }) : tq('rows.change.update', { columns: Object.keys(change.set).join(', '), key })
}

/**
 * Staged row editing for a browsed table. Nothing is written until "Apply":
 * the changes are sent as structure (key, new values, old values) and the main
 * process builds parameterised statements, so no SQL text from this page ever
 * runs. "View SQL" shows exactly what Apply would execute.
 */
export function TableEditor({ connection, schema, table, result, selectedRow, onClearSelection, onApplied }: Props): ReactElement {
  const { t } = useTranslation('oxequery')
  const [editability, setEditability] = useState<SqlEditability | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [staged, setStaged] = useState<SqlRowChange[]>([])
  const [draft, setDraft] = useState<Draft>({})
  const [inserting, setInserting] = useState(false)
  const [statements, setStatements] = useState<string[] | null>(null)
  const [confirmReasons, setConfirmReasons] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    let alive = true
    setEditability(null); setEnabled(false); setStaged([]); setStatements(null); setError('')
    oq('sql.editability', { connectionId: connection.id, schema, table }).then(
      value => { if (alive) setEditability(value) },
      cause => { if (alive) setEditability({ editable: false, reason: errorMessage(cause), columns: [] }) })
    return () => { alive = false }
  }, [connection.id, schema, table])

  const names = useMemo(() => result.columns.map(column => column.name), [result])
  const row = selectedRow !== null ? result.rows[selectedRow] : null
  const keyColumns = useMemo(() => editability?.columns.filter(column => column.key).map(column => column.name) ?? [], [editability])

  // Opening another row starts a fresh draft from that row's values.
  useEffect(() => {
    if (!row) { setDraft({}); return }
    setInserting(false)
    setDraft(Object.fromEntries(names.map((name, index) => [name, { value: cellText(row[index]), isNull: row[index] === null || row[index] === undefined }])))
  }, [row, names])

  const reason = connection.readOnly ? t('rows.readOnly') : editability && !editability.editable ? editability.reason ?? t('rows.notEditable') : ''

  const stage = (change: SqlRowChange): void => { setStaged(current => [...current, change]); setStatements(null); setError(''); setConflict(false) }

  const stageUpdate = (): void => {
    if (!row || !editability) return
    const key: Record<string, SqlCellValue> = {}
    for (const name of keyColumns) key[name] = row[names.indexOf(name)] as SqlCellValue
    const set: Record<string, SqlCellValue> = {}
    const old: Record<string, SqlCellValue> = {}
    names.forEach((name, index) => {
      const meta = editability.columns.find(column => column.name === name)
      if (!meta || meta.generated) return
      const entry = draft[name]
      if (!entry) return
      const before = row[index]
      const next: SqlCellValue = entry.isNull ? null : entry.value
      const same = entry.isNull ? before === null || before === undefined : before !== null && before !== undefined && cellText(before) === entry.value
      if (same) return
      set[name] = next
      old[name] = before as SqlCellValue
    })
    if (Object.keys(set).length === 0) { setError(t('rows.nothingChanged')); return }
    stage({ kind: 'update', key, set, old })
    onClearSelection()
  }

  const stageDelete = (): void => {
    if (!row) return
    const key: Record<string, SqlCellValue> = {}
    for (const name of keyColumns) key[name] = row[names.indexOf(name)] as SqlCellValue
    stage({ kind: 'delete', key, old: Object.fromEntries(names.map((name, index) => [name, row[index] as SqlCellValue])) })
    onClearSelection()
  }

  const stageInsert = (): void => {
    const values: Record<string, SqlCellValue> = {}
    for (const [name, entry] of Object.entries(draft)) {
      if (entry.isNull) values[name] = null
      else if (entry.value !== '') values[name] = entry.value
    }
    stage({ kind: 'insert', values })
    setInserting(false); setDraft({})
  }

  const input = { connectionId: connection.id, schema, table, changes: staged }

  const viewSql = useCallback(async (): Promise<void> => {
    setBusy(true); setError('')
    try { setStatements((await oq('sql.previewChanges', { connectionId: connection.id, schema, table, changes: staged })).statements) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }, [connection.id, schema, table, staged])

  const apply = async (confirmed = false): Promise<void> => {
    setBusy(true); setError(''); setConflict(false)
    try {
      await oq('sql.apply', { ...input, confirmed })
      toast({ title: t('rows.applied', { count: staged.length }), intent: 'success', duration: 3000 })
      setStaged([]); setStatements(null); setConfirmReasons(null)
      onApplied()
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setConfirmReasons(cause.reasons)
      else if (cause instanceof OxeQueryClientError && cause.code === 'conflict') { setConflict(true); setError(cause.message) }
      else setError(errorMessage(cause))
    } finally { setBusy(false) }
  }

  const startInsert = (): void => {
    if (!editability) return
    onClearSelection()
    setInserting(true)
    setDraft(Object.fromEntries(editability.columns.filter(column => !column.generated).map(column => [column.name, { value: '', isNull: false }])))
  }

  if (!editability) return <div className="oq-editor-bar"><LoadingState label={t('rows.checking')} /></div>

  return <section className="oq-editor-bar" aria-label={t('rows.edit')}>
    <div className="oq-editor-bar-row">
      <button type="button" aria-pressed={enabled} disabled={Boolean(reason)} title={reason || t('rows.editTitle')}
        onClick={() => { setEnabled(value => !value); setInserting(false); onClearSelection() }}><Pencil size={13} aria-hidden="true" />{enabled ? t('rows.editing') : t('rows.edit')}</button>
      {reason && <span className="oq-muted">{reason}</span>}
      {enabled && <>
        <button type="button" onClick={startInsert}><Plus size={13} aria-hidden="true" />{t('rows.add')}</button>
        <span className="oq-muted">{staged.length === 0 ? t('rows.selectHint') : t('rows.pending', { count: staged.length })}</span>
      </>}
      {connection.environment === 'prod' && enabled && <span className="oq-badge" data-environment="prod">{t('environment.short.prod')}</span>}
    </div>

    {enabled && (row || inserting) && <div className="oq-edit-form" role="group" aria-label={inserting ? t('rows.newRow') : t('rows.editRow')}>
      <header><strong>{inserting ? t('rows.newRow') : t('workbench.row', { number: selectedRow! + 1 })}</strong>
        <button type="button" aria-label={t('rows.closeEditor')} onClick={() => { setInserting(false); onClearSelection() }}><X size={13} aria-hidden="true" /></button></header>
      <div className="oq-edit-fields">{Object.keys(draft).map(name => {
        const meta = editability.columns.find(column => column.name === name)
        const locked = Boolean(meta?.generated) || (!inserting && Boolean(meta?.key))
        const entry = draft[name]
        return <label key={name}>
          <span>{name}<small>{meta?.type}{meta?.key ? ` · ${t('rows.key')}` : ''}{meta?.generated ? ` · ${t('rows.generated')}` : ''}{inserting && meta?.hasDefault ? ` · ${t('rows.default')}` : ''}</small></span>
          <input value={entry.isNull ? '' : entry.value} disabled={locked || entry.isNull} placeholder={entry.isNull ? SQL_NULL : inserting && meta?.hasDefault ? t('rows.default') : ''}
            onChange={event => setDraft(current => ({ ...current, [name]: { value: event.target.value, isNull: false } }))} />
          {meta?.nullable && !locked && <button type="button" className="oq-null-toggle" aria-pressed={entry.isNull} title={t('rows.setNull')}
            onClick={() => setDraft(current => ({ ...current, [name]: { value: '', isNull: !entry.isNull } }))}>{SQL_NULL}</button>}
        </label>
      })}</div>
      <footer>
        {inserting ? <button type="button" className="oq-primary" onClick={stageInsert}>{t('rows.stageInsert')}</button>
          : <><button type="button" className="oq-primary" onClick={stageUpdate}>{t('rows.stageUpdate')}</button>
            <button type="button" className="oq-danger" onClick={stageDelete}><Trash2 size={13} aria-hidden="true" />{t('rows.stageDelete')}</button></>}
      </footer>
    </div>}

    {enabled && staged.length > 0 && <div className="oq-staged">
      <ul aria-label={t('rows.pendingLabel')}>{staged.map((change, index) => <li key={index} data-kind={change.kind}>
        <span>{describeChange(change)}</span>
        <button type="button" aria-label={t('rows.discardOne', { number: index + 1 })} onClick={() => { setStaged(current => current.filter((_, position) => position !== index)); setStatements(null) }}><Undo2 size={12} aria-hidden="true" /></button>
      </li>)}</ul>
      {statements && <pre className="oq-sql-preview" aria-label={t('rows.sqlPreview')}>{statements.join('\n')}</pre>}
      {error && <ErrorState compact title={t('rows.applyFailed')} message={conflict ? `${error} ${t('rows.conflict')}` : error} />}
      {confirmReasons && <ConfirmDialog danger title={t('rows.confirmTitle')} confirmLabel={t('rows.confirmApply')} cancelLabel={t('common.back')} busy={busy}
        description={t('rows.confirmDescription')}
        onCancel={() => setConfirmReasons(null)} onConfirm={() => void apply(true)}>
        <ul>{confirmReasons.map(item => <li key={item}>{item}</li>)}</ul>
      </ConfirmDialog>}
      <div className="oq-staged-actions">
        <button type="button" disabled={busy} onClick={() => void viewSql()}><Eye size={13} aria-hidden="true" />{t('rows.viewSql')}</button>
        <button type="button" disabled={busy} onClick={() => { setStaged([]); setStatements(null); setError(''); setConfirmReasons(null) }}>{t('rows.discardAll')}</button>
        <button type="button" className="oq-primary" disabled={busy} onClick={() => void apply(false)}>{t('rows.applyCount', { count: staged.length })}</button>
      </div>
    </div>}
    {enabled && staged.length === 0 && error && <ErrorState compact title={error} />}
  </section>
}

/** Export of the table being browsed. The path is chosen in a native dialog in the main process. */
export function ExportButton({ connection, source, label }: {
  connection: OxeQueryConnection
  source: { kind: 'table'; schema: string; table: string } | { kind: 'sql'; sql: string } | { kind: 'collection'; database: string; collection: string; filter?: string }
  label?: string
}): ReactElement {
  const { t } = useTranslation('oxequery')
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ phase: 'idle' | 'running' | 'done' | 'error'; rows: number; text: string }>({ phase: 'idle', rows: 0, text: '' })
  const [exportId, setExportId] = useState('')

  useEffect(() => {
    const api = window.oxe?.oxeQuery
    if (!api?.onEvent || !exportId) return
    return api.onEvent(event => {
      if (event.type === 'export-progress' && event.exportId === exportId) setState(current => ({ ...current, phase: 'running', rows: event.rows }))
    })
  }, [exportId])

  const run = async (format: ExportFormat): Promise<void> => {
    const id = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setExportId(id); setOpen(false); setState({ phase: 'running', rows: 0, text: '' })
    try {
      const outcome = await oq('export.run', { connectionId: connection.id, exportId: id, source, format })
      if (outcome.dismissed) setState({ phase: 'idle', rows: 0, text: '' })
      else if (outcome.cancelled) setState({ phase: 'error', rows: outcome.rows, text: t('export.cancelled') })
      else setState({ phase: 'done', rows: outcome.rows, text: t('export.saved', { count: outcome.rows, formatted: formatNumber(outcome.rows), file: outcome.fileName ?? t('export.chosenFile') }) })
    } catch (cause) { setState({ phase: 'error', rows: 0, text: errorMessage(cause) }) }
  }

  const formats: ExportFormat[] = connection.engine === 'postgres' ? ['csv', 'xlsx', 'json', 'ndjson', 'sql'] : ['json', 'ndjson', 'csv', 'xlsx']
  return <span className="oq-export">
    <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={state.phase === 'running'} onClick={() => setOpen(value => !value)}><Download size={13} aria-hidden="true" />{label ?? t('export.label')}</button>
    {open && <ul role="menu" aria-label={t('export.format')}>{formats.map(format => <li key={format} role="none"><button type="button" role="menuitem" onClick={() => void run(format)}>{format.toUpperCase()}</button></li>)}</ul>}
    {state.phase === 'running' && <span className="oq-muted" role="status">{t('export.running', { count: state.rows, formatted: formatNumber(state.rows) })}
      <button type="button" onClick={() => void oq('export.cancel', { exportId }).catch(() => undefined)}>{t('common.cancel')}</button></span>}
    {state.phase === 'done' && <span className="oq-muted" role="status">{state.text}</span>}
    {state.phase === 'error' && <ErrorState compact title={state.text} />}
  </span>
}

export { displayCell }
