import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Play, Square, Table2 } from 'lucide-react'
// Side-effect: self-hosted Monaco (no CDN), required before <Editor> mounts.
import '../../lib/monacoSetup'
import type { OxeQueryConnection, SqlResult, SqlTable, SqlTableDetails } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { ResultGrid, toCsv, toJsonRows } from './ResultGrid'

const ROW_LIMITS = [100, 500, 1000, 5000]
const PAGE = 100

interface Pending { sql: string; reasons: string[] }
interface Browse { schema: string; table: string; offset: number }

function copy(text: string): void {
  void window.oxe?.clipboard?.writeText(text).catch(() => undefined)
}

export function SqlWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const [sql, setSql] = useState('SELECT now();')
  const [result, setResult] = useState<SqlResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [maxRows, setMaxRows] = useState(500)
  const [pending, setPending] = useState<Pending | null>(null)
  const [browse, setBrowse] = useState<Browse | null>(null)
  const [details, setDetails] = useState<SqlTableDetails | null>(null)
  const editor = useRef<Parameters<OnMount>[0] | null>(null)
  const sqlRef = useRef(sql)
  sqlRef.current = sql

  const run = useCallback(async (text: string, confirmed = false): Promise<void> => {
    if (!text.trim()) return
    setRunning(true); setError(''); setPending(null); setBrowse(null); setDetails(null)
    try {
      setResult(await oq('sql.run', { connectionId: connection.id, sql: text, maxRows, confirmed }))
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setPending({ sql: text, reasons: cause.reasons })
      else { setResult(null); setError(errorMessage(cause)) }
    } finally { setRunning(false) }
  }, [connection.id, maxRows])

  const runCurrent = useCallback((): void => {
    const instance = editor.current
    const selection = instance?.getSelection()
    const selected = selection && !selection.isEmpty() ? instance?.getModel()?.getValueInRange(selection) : ''
    void run(selected || sqlRef.current)
  }, [run])
  const runRef = useRef(runCurrent)
  runRef.current = runCurrent

  const openTable = useCallback(async (table: SqlTable, offset = 0): Promise<void> => {
    setRunning(true); setError(''); setPending(null)
    try {
      const [rows, meta] = await Promise.all([
        oq('sql.browse', { connectionId: connection.id, schema: table.schema, table: table.name, limit: PAGE, offset }),
        offset === 0 ? oq('sql.table', { connectionId: connection.id, schema: table.schema, table: table.name }) : Promise.resolve(null)
      ])
      setResult(rows); setBrowse({ schema: table.schema, table: table.name, offset })
      if (meta) setDetails(meta)
    } catch (cause) { setError(errorMessage(cause)) } finally { setRunning(false) }
  }, [connection.id])

  const cancel = (): void => { void oq('sql.cancel', { connectionId: connection.id }).catch(() => undefined) }

  const columns = useMemo(() => result?.columns.map(column => column.name) ?? [], [result])
  const types = useMemo(() => result?.columns.map(column => column.type) ?? [], [result])

  return <div className="oq-workbench">
    <SchemaTree connection={connection} onOpen={table => void openTable(table)} onInsert={text => { setSql(text); setBrowse(null) }} />
    <div className="oq-workbench-main">
      <div className="oq-editor-toolbar">
        <button type="button" className="oq-primary" onClick={runCurrent} disabled={running} title="Run (Ctrl+Enter). Runs the selection when there is one."><Play size={13} aria-hidden="true" />Run</button>
        <button type="button" onClick={cancel} disabled={!running} title="Cancel the running statement"><Square size={13} aria-hidden="true" />Cancel</button>
        <label className="oq-inline">Rows<select value={maxRows} onChange={event => setMaxRows(Number(event.target.value))}>{ROW_LIMITS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <span className="oq-spacer" />
        <span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>
        <span className="oq-badge" data-readonly={connection.readOnly}>{connection.readOnly ? 'read-only' : 'read-write'}</span>
      </div>
      <div className="oq-editor"><Editor height="100%" language="sql" theme="vs-dark" value={sql} onChange={value => setSql(value ?? '')}
        onMount={(instance, monaco) => { editor.current = instance; instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current()) }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, tabSize: 2 }} /></div>
      {pending && <div className="oq-confirm" role="alertdialog" aria-label="Confirm statement">
        <strong>This statement is destructive</strong>
        <ul>{pending.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {connection.environment === 'prod' && <p className="oq-error">This is a production connection.</p>}
        <div><button type="button" onClick={() => setPending(null)}>Cancel</button><button type="button" className="oq-danger" onClick={() => void run(pending.sql, true)}>Run anyway</button></div>
      </div>}
      <div className="oq-results">
        <div className="oq-results-bar">
          {running ? <span>Running…</span> : result ? <span>{browse ? <><Table2 size={13} aria-hidden="true" /> {browse.schema}.{browse.table} · rows {browse.offset + 1}–{browse.offset + result.rowCount}</>
            : <>{result.command && result.columns.length === 0 ? `${result.command}${result.affectedRows !== undefined ? ` · ${result.affectedRows} rows affected` : ''}` : `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}${result.truncated ? ' (limited)' : ''}`}</>} · {result.durationMs} ms</span> : <span className="oq-muted">Results appear here.</span>}
          <span className="oq-spacer" />
          {browse && <><button type="button" disabled={running || browse.offset === 0} onClick={() => void openTable({ schema: browse.schema, name: browse.table, kind: 'table' }, Math.max(0, browse.offset - PAGE))}>Previous</button>
            <button type="button" disabled={running || !result?.truncated} onClick={() => void openTable({ schema: browse.schema, name: browse.table, kind: 'table' }, browse.offset + PAGE)}>Next</button></>}
          {result && columns.length > 0 && <><button type="button" onClick={() => copy(toCsv(columns, result.rows))}>Copy CSV</button>
            <button type="button" onClick={() => copy(toJsonRows(columns, result.rows))}>Copy JSON</button></>}
        </div>
        {error && <p role="alert" className="oq-error">{error}</p>}
        {result?.notices?.map(notice => <p key={notice} className="oq-muted">{notice}</p>)}
        {details && <details className="oq-columns"><summary>{details.columns.length} columns · {details.indexes.length} indexes</summary>
          <table><tbody>{details.columns.map(column => <tr key={column.name}><td>{column.primaryKey ? '🔑 ' : ''}{column.name}</td><td>{column.type}</td><td>{column.nullable ? 'null' : 'not null'}</td><td>{column.default ?? ''}</td></tr>)}</tbody></table></details>}
        {result && columns.length > 0 && <ResultGrid columns={columns} types={types} rows={result.rows} onCopy={copy} />}
      </div>
    </div>
  </div>
}

function SchemaTree({ connection, onOpen, onInsert }: { connection: OxeQueryConnection; onOpen: (table: SqlTable) => void; onInsert: (sql: string) => void }): ReactElement {
  const [schemas, setSchemas] = useState<string[]>([])
  const [tables, setTables] = useState<Record<string, SqlTable[]>>({})
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set(['public']))
  const [error, setError] = useState('')
  const load = useCallback(async (schema: string): Promise<void> => {
    try { const list = await oq('sql.tables', { connectionId: connection.id, schema }); setTables(current => ({ ...current, [schema]: list })) }
    catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])
  useEffect(() => {
    let active = true
    oq('sql.schemas', { connectionId: connection.id }).then(list => { if (active) { setSchemas(list); if (list.includes('public')) void load('public') } }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [connection.id, load])
  const toggle = (schema: string): void => {
    setOpenSchemas(current => { const next = new Set(current); if (next.has(schema)) next.delete(schema); else { next.add(schema); if (!tables[schema]) void load(schema) } return next })
  }
  return <nav className="oq-tree" aria-label="Schema">
    {error && <p role="alert" className="oq-error">{error}</p>}
    {schemas.map(schema => <div key={schema}>
      <button type="button" className="oq-tree-node" aria-expanded={openSchemas.has(schema)} onClick={() => toggle(schema)}>
        {openSchemas.has(schema) ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{schema}</button>
      {openSchemas.has(schema) && (tables[schema] ?? []).map(table => <div key={table.name} className="oq-tree-leaf">
        <button type="button" title={`Browse ${schema}.${table.name}`} onClick={() => onOpen(table)}>{table.name}<small>{table.kind === 'table' ? '' : table.kind}</small></button>
        <button type="button" aria-label={`Write a query for ${table.name}`} title="Put a SELECT in the editor" onClick={() => onInsert(`SELECT *\nFROM "${schema.replace(/"/g, '""')}"."${table.name.replace(/"/g, '""')}"\nLIMIT 100;`)}>SQL</button>
      </div>)}
    </div>)}
  </nav>
}
