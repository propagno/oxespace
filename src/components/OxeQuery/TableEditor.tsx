import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Download, Eye, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { OxeQueryConnection, SqlCellValue, SqlEditability, SqlResult, SqlRowChange } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { displayCell } from './ResultGrid'

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

function describe(change: SqlRowChange): string {
  if (change.kind === 'insert') return `Insert a row (${Object.keys(change.values).join(', ') || 'defaults'})`
  const key = Object.entries(change.key).map(([name, value]) => `${name} = ${cellText(value)}`).join(', ')
  return change.kind === 'delete' ? `Delete row where ${key}` : `Update ${Object.keys(change.set).join(', ')} where ${key}`
}

/**
 * Staged row editing for a browsed table. Nothing is written until "Apply":
 * the changes are sent as structure (key, new values, old values) and the main
 * process builds parameterised statements, so no SQL text from this page ever
 * runs. "View SQL" shows exactly what Apply would execute.
 */
export function TableEditor({ connection, schema, table, result, selectedRow, onClearSelection, onApplied }: Props): ReactElement {
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

  const reason = connection.readOnly ? 'This connection is read-only. Turn that off in the connection settings to edit.' : editability && !editability.editable ? editability.reason ?? 'This table cannot be edited.' : ''

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
    if (Object.keys(set).length === 0) { setError('Nothing changed in this row.'); return }
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

  if (!editability) return <div className="oq-editor-bar" aria-busy="true"><span className="oq-muted">Checking whether this table can be edited…</span></div>

  return <section className="oq-editor-bar" aria-label="Edit rows">
    <div className="oq-editor-bar-row">
      <button type="button" aria-pressed={enabled} disabled={Boolean(reason)} title={reason || 'Stage changes to rows, review the SQL, then apply them in one transaction'}
        onClick={() => { setEnabled(value => !value); setInserting(false); onClearSelection() }}><Pencil size={13} aria-hidden="true" />{enabled ? 'Editing' : 'Edit rows'}</button>
      {reason && <span className="oq-muted">{reason}</span>}
      {enabled && <>
        <button type="button" onClick={startInsert}><Plus size={13} aria-hidden="true" />Add row</button>
        <span className="oq-muted">{staged.length === 0 ? 'Select a row to change or delete it.' : `${staged.length} pending change${staged.length === 1 ? '' : 's'}`}</span>
      </>}
      {connection.environment === 'prod' && enabled && <span className="oq-badge" data-environment="prod">production</span>}
    </div>

    {enabled && (row || inserting) && <div className="oq-edit-form" role="group" aria-label={inserting ? 'New row' : 'Edit row'}>
      <header><strong>{inserting ? 'New row' : `Row ${selectedRow! + 1}`}</strong>
        <button type="button" aria-label="Close editor" onClick={() => { setInserting(false); onClearSelection() }}><X size={13} aria-hidden="true" /></button></header>
      <div className="oq-edit-fields">{Object.keys(draft).map(name => {
        const meta = editability.columns.find(column => column.name === name)
        const locked = Boolean(meta?.generated) || (!inserting && Boolean(meta?.key))
        const entry = draft[name]
        return <label key={name}>
          <span>{name}<small>{meta?.type}{meta?.key ? ' · key' : ''}{meta?.generated ? ' · generated' : ''}{inserting && meta?.hasDefault ? ' · default' : ''}</small></span>
          <input value={entry.isNull ? '' : entry.value} disabled={locked || entry.isNull} placeholder={entry.isNull ? 'NULL' : inserting && meta?.hasDefault ? 'default' : ''}
            onChange={event => setDraft(current => ({ ...current, [name]: { value: event.target.value, isNull: false } }))} />
          {meta?.nullable && !locked && <button type="button" className="oq-null-toggle" aria-pressed={entry.isNull} title="Set to NULL"
            onClick={() => setDraft(current => ({ ...current, [name]: { value: '', isNull: !entry.isNull } }))}>NULL</button>}
        </label>
      })}</div>
      <footer>
        {inserting ? <button type="button" className="oq-primary" onClick={stageInsert}>Stage insert</button>
          : <><button type="button" className="oq-primary" onClick={stageUpdate}>Stage update</button>
            <button type="button" className="oq-danger" onClick={stageDelete}><Trash2 size={13} aria-hidden="true" />Stage delete</button></>}
      </footer>
    </div>}

    {enabled && staged.length > 0 && <div className="oq-staged">
      <ul aria-label="Pending changes">{staged.map((change, index) => <li key={index} data-kind={change.kind}>
        <span>{describe(change)}</span>
        <button type="button" aria-label={`Discard change ${index + 1}`} onClick={() => { setStaged(current => current.filter((_, position) => position !== index)); setStatements(null) }}><Undo2 size={12} aria-hidden="true" /></button>
      </li>)}</ul>
      {statements && <pre className="oq-sql-preview" aria-label="SQL that will run">{statements.join('\n')}</pre>}
      {error && <p role="alert" className="oq-error">{error}{conflict && ' Reload the table to see the current values.'}</p>}
      {confirmReasons && <div className="oq-confirm" role="alertdialog" aria-label="Confirm changes">
        <strong>Confirm these changes</strong>
        <ul>{confirmReasons.map(item => <li key={item}>{item}</li>)}</ul>
        <div><button type="button" onClick={() => setConfirmReasons(null)}>Back</button>
          <button type="button" className="oq-danger" disabled={busy} onClick={() => void apply(true)}>Apply changes</button></div>
      </div>}
      <div className="oq-staged-actions">
        <button type="button" disabled={busy} onClick={() => void viewSql()}><Eye size={13} aria-hidden="true" />View SQL</button>
        <button type="button" disabled={busy} onClick={() => { setStaged([]); setStatements(null); setError(''); setConfirmReasons(null) }}>Discard all</button>
        <button type="button" className="oq-primary" disabled={busy} onClick={() => void apply(false)}>Apply {staged.length}</button>
      </div>
    </div>}
    {enabled && staged.length === 0 && error && <p role="alert" className="oq-error">{error}</p>}
  </section>
}

/** Export of the table being browsed. The path is chosen in a native dialog in the main process. */
export function ExportButton({ connection, source, label = 'Export' }: {
  connection: OxeQueryConnection
  source: { kind: 'table'; schema: string; table: string } | { kind: 'sql'; sql: string } | { kind: 'collection'; database: string; collection: string; filter?: string }
  label?: string
}): ReactElement {
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

  const run = async (format: 'csv' | 'json' | 'ndjson' | 'sql'): Promise<void> => {
    const id = `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setExportId(id); setOpen(false); setState({ phase: 'running', rows: 0, text: '' })
    try {
      const outcome = await oq('export.run', { connectionId: connection.id, exportId: id, source, format })
      if (outcome.dismissed) setState({ phase: 'idle', rows: 0, text: '' })
      else if (outcome.cancelled) setState({ phase: 'error', rows: outcome.rows, text: 'Export cancelled. No file was kept.' })
      else setState({ phase: 'done', rows: outcome.rows, text: `${outcome.rows.toLocaleString()} rows saved to ${outcome.fileName ?? 'the chosen file'}.` })
    } catch (cause) { setState({ phase: 'error', rows: 0, text: errorMessage(cause) }) }
  }

  const formats: ('csv' | 'json' | 'ndjson' | 'sql')[] = connection.engine === 'postgres' ? ['csv', 'json', 'ndjson', 'sql'] : ['json', 'ndjson', 'csv']
  return <span className="oq-export">
    <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={state.phase === 'running'} onClick={() => setOpen(value => !value)}><Download size={13} aria-hidden="true" />{label}</button>
    {open && <ul role="menu" aria-label="Export format">{formats.map(format => <li key={format} role="none"><button type="button" role="menuitem" onClick={() => void run(format)}>{format.toUpperCase()}</button></li>)}</ul>}
    {state.phase === 'running' && <span className="oq-muted" role="status">Exporting… {state.rows.toLocaleString()} rows
      <button type="button" onClick={() => void oq('export.cancel', { exportId }).catch(() => undefined)}>Cancel</button></span>}
    {state.phase === 'done' && <span className="oq-muted" role="status">{state.text}</span>}
    {state.phase === 'error' && <span className="oq-error" role="alert">{state.text}</span>}
  </span>
}

export { displayCell }
