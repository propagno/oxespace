import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Gauge, History, Play, Plus, Square, Table2, X } from 'lucide-react'
// Side-effect: self-hosted Monaco (no CDN), required before <Editor> mounts.
import '../../lib/monacoSetup'
import type { OxeQueryConnection, SqlExplain, SqlResult, SqlTable, SqlTableDetails } from '../../../shared/types/oxequery'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { ResultGrid, displayCell, toCsv, toJsonRows } from './ResultGrid'
import { pushHistory, readHistory, writeHistory, type HistoryEntry } from './query-history'
import { ExportButton, TableEditor } from './TableEditor'
import { ImportButton } from './ImportDialog'
import { ExplainView } from './ExplainView'

const ROW_LIMITS = [100, 500, 1000, 5000]
const PAGE = 100
const MAX_TABS = 12

interface Pending { sql: string; reasons: string[]; explain?: 'analyze' }
interface Browse { schema: string; table: string; offset: number }
interface QueryTab {
  id: string
  title: string
  sql: string
  result: SqlResult | null
  error: string
  browse: Browse | null
  details: SqlTableDetails | null
  explain: SqlExplain | null
}

let counter = 0
const newTab = (sql = '', title?: string): QueryTab => ({ id: `q${++counter}`, title: title ?? `Query ${counter}`, sql, result: null, error: '', browse: null, details: null, explain: null })

function copy(text: string): void {
  void window.oxe?.clipboard?.writeText(text).catch(() => undefined)
}

export function SqlWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab('SELECT now();', 'Query 1')])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [running, setRunning] = useState(false)
  const [maxRows, setMaxRows] = useState(500)
  const [pending, setPending] = useState<Pending | null>(null)
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory(connection.id))
  const [historyOpen, setHistoryOpen] = useState(false)
  const editor = useRef<Parameters<OnMount>[0] | null>(null)
  const pendingExplain = useRef<string | null>(null)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const activeRef = useRef(active)
  activeRef.current = active

  const patch = useCallback((id: string, change: Partial<QueryTab>): void => {
    setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...change } : tab))
  }, [])

  const record = useCallback((entry: HistoryEntry): void => {
    setHistory(current => {
      const next = pushHistory(current, entry)
      writeHistory(connection.id, next)
      return next
    })
  }, [connection.id])

  const run = useCallback(async (text: string, confirmed = false): Promise<void> => {
    const tab = activeRef.current
    if (!text.trim()) return
    setRunning(true); setPending(null); setSelectedRow(null)
    patch(tab.id, { error: '', browse: null, details: null, explain: null })
    const started = Date.now()
    try {
      const result = await oq('sql.run', { connectionId: connection.id, sql: text, maxRows, confirmed })
      patch(tab.id, { result })
      record({ sql: text, at: started, ms: result.durationMs, rows: result.columns.length ? result.rowCount : result.affectedRows ?? null, ok: true })
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setPending({ sql: text, reasons: cause.reasons })
      else {
        patch(tab.id, { result: null, error: errorMessage(cause) })
        record({ sql: text, at: started, ms: Date.now() - started, rows: null, ok: false })
      }
    } finally { setRunning(false) }
  }, [connection.id, maxRows, patch, record])

  const explain = useCallback(async (analyze: boolean, confirmed = false): Promise<void> => {
    const tab = activeRef.current
    const instance = editor.current
    const selection = instance?.getSelection()
    const selected = selection && !selection.isEmpty() ? instance?.getModel()?.getValueInRange(selection) : ''
    const text = pendingExplain.current ?? (selected || tab.sql)
    if (!text.trim()) return
    setRunning(true); setPending(null)
    patch(tab.id, { error: '' })
    try {
      patch(tab.id, { explain: await oq('sql.explain', { connectionId: connection.id, sql: text, analyze, confirmed }), result: null, browse: null, details: null })
      pendingExplain.current = null
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') { pendingExplain.current = text; setPending({ sql: text, reasons: cause.reasons, explain: 'analyze' }) }
      else patch(tab.id, { explain: null, error: errorMessage(cause) })
    } finally { setRunning(false) }
  }, [connection.id, patch])

  const runCurrent = useCallback((): void => {
    const instance = editor.current
    const selection = instance?.getSelection()
    const selected = selection && !selection.isEmpty() ? instance?.getModel()?.getValueInRange(selection) : ''
    void run(selected || activeRef.current.sql)
  }, [run])
  const runRef = useRef(runCurrent)
  runRef.current = runCurrent

  const openTable = useCallback(async (table: SqlTable, offset = 0): Promise<void> => {
    const tab = activeRef.current
    setRunning(true); setPending(null); setSelectedRow(null)
    patch(tab.id, { error: '' })
    try {
      const [rows, meta] = await Promise.all([
        oq('sql.browse', { connectionId: connection.id, schema: table.schema, table: table.name, limit: PAGE, offset }),
        offset === 0 ? oq('sql.table', { connectionId: connection.id, schema: table.schema, table: table.name }) : Promise.resolve(null)
      ])
      patch(tab.id, { result: rows, browse: { schema: table.schema, table: table.name, offset }, ...(meta ? { details: meta } : {}), title: table.name })
    } catch (cause) { patch(tab.id, { error: errorMessage(cause) }) } finally { setRunning(false) }
  }, [connection.id, patch])

  const addTab = (sql = ''): void => {
    if (tabs.length >= MAX_TABS) return
    const tab = newTab(sql)
    setTabs(current => [...current, tab]); setActiveId(tab.id); setSelectedRow(null)
  }
  const closeTab = (id: string): void => {
    if (tabs.length === 1) { patch(id, { sql: '', result: null, error: '', browse: null, details: null, explain: null }); return }
    const index = tabs.findIndex(tab => tab.id === id)
    const next = tabs.filter(tab => tab.id !== id)
    setTabs(next)
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id)
  }

  const cancel = (): void => { void oq('sql.cancel', { connectionId: connection.id }).catch(() => undefined) }

  const result = active.result
  const columns = useMemo(() => result?.columns.map(column => column.name) ?? [], [result])
  const types = useMemo(() => result?.columns.map(column => column.type) ?? [], [result])
  const row = selectedRow !== null && result ? result.rows[selectedRow] : null

  return <div className="oq-workbench">
    <SchemaTree connection={connection} onOpen={table => void openTable(table)} onInsert={text => addTab(text)} />
    <div className="oq-workbench-main">
      <div className="oq-qtabs" role="tablist" aria-label="Queries">
        {tabs.map(tab => <span key={tab.id} className="oq-qtab" data-active={tab.id === active.id}>
          <button type="button" role="tab" aria-selected={tab.id === active.id} onClick={() => { setActiveId(tab.id); setSelectedRow(null) }}>{tab.title}</button>
          <button type="button" className="oq-tab-close" aria-label={`Close ${tab.title}`} onClick={() => closeTab(tab.id)}><X size={11} aria-hidden="true" /></button>
        </span>)}
        <button type="button" className="oq-qtab-add" aria-label="New query" title="New query tab" disabled={tabs.length >= MAX_TABS} onClick={() => addTab('')}><Plus size={13} aria-hidden="true" /></button>
      </div>
      <div className="oq-editor-toolbar">
        <button type="button" className="oq-primary" onClick={runCurrent} disabled={running} title="Run (Ctrl+Enter). Runs the selection when there is one."><Play size={13} aria-hidden="true" />Run<kbd>Ctrl ↵</kbd></button>
        <button type="button" onClick={() => { pendingExplain.current = null; void explain(false) }} disabled={running} title="Show the execution plan without running the statement"><Gauge size={13} aria-hidden="true" />Explain</button>
        <button type="button" onClick={() => { pendingExplain.current = null; void explain(true) }} disabled={running} title="Run the statement and show real timings. A statement that changes data is rolled back.">Analyze</button>
        <button type="button" onClick={cancel} disabled={!running} title="Cancel the running statement"><Square size={13} aria-hidden="true" />Cancel</button>
        <label className="oq-inline">Limit<select value={maxRows} onChange={event => setMaxRows(Number(event.target.value))}>{ROW_LIMITS.map(value => <option key={value} value={value}>{value} rows</option>)}</select></label>
        <div className="oq-history">
          <button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)} disabled={history.length === 0}><History size={13} aria-hidden="true" />History</button>
          {historyOpen && <ul role="listbox" aria-label="Query history">{history.map(item => <li key={`${item.at}:${item.sql}`}>
            <button type="button" role="option" aria-selected="false" title={item.sql} onClick={() => { patch(active.id, { sql: item.sql }); setHistoryOpen(false) }}>
              <code>{item.sql.replace(/\s+/g, ' ').slice(0, 90)}</code>
              <small>{item.ok ? `${item.rows ?? '–'} rows · ${item.ms} ms` : 'failed'} · {new Date(item.at).toLocaleTimeString()}</small></button></li>)}</ul>}
        </div>
        <span className="oq-spacer" />
        <span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>
        <span className="oq-badge" data-readonly={connection.readOnly} title={connection.readOnly ? 'The server refuses statements that change data' : 'This connection can change data'}>{connection.readOnly ? 'read-only' : 'read-write'}</span>
      </div>
      <div className="oq-editor"><Editor key={active.id} height="100%" language="sql" theme="vs-dark" value={active.sql} onChange={value => patch(active.id, { sql: value ?? '' })}
        onMount={(instance, monaco) => { editor.current = instance; instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current()) }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, tabSize: 2, padding: { top: 8 } }} /></div>
      {pending && <div className="oq-confirm" role="alertdialog" aria-label="Confirm statement">
        <strong>{pending.explain ? 'Analyze runs this statement' : 'This statement is destructive'}</strong>
        <ul>{pending.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {connection.environment === 'prod' && <p className="oq-error">This is a production connection.</p>}
        <div><button type="button" onClick={() => { pendingExplain.current = null; setPending(null) }}>Cancel</button><button type="button" className="oq-danger" onClick={() => pending.explain ? void explain(true, true) : void run(pending.sql, true)}>{pending.explain ? 'Analyze anyway' : 'Run anyway'}</button></div>
      </div>}
      <div className="oq-results">
        <div className="oq-results-bar">
          {active.browse && <span className="oq-results-title"><Table2 size={13} aria-hidden="true" /> {active.browse.schema}.{active.browse.table}</span>}
          <span className="oq-muted">{running ? 'Running…' : result ? summary(result, active.browse) : 'Results appear here.'}</span>
          <span className="oq-spacer" />
          {active.browse && <><button type="button" disabled={running || active.browse.offset === 0} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, Math.max(0, active.browse!.offset - PAGE))}>Previous</button>
            <button type="button" disabled={running || !result?.truncated} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, active.browse!.offset + PAGE)}>Next</button></>}
          {(active.browse || (result && columns.length > 0 && active.sql.trim())) && <ExportButton connection={connection}
            source={active.browse ? { kind: 'table', schema: active.browse.schema, table: active.browse.table } : { kind: 'sql', sql: active.sql }}
            label={active.browse ? 'Export table' : 'Export query'} />}
          {active.browse && <ImportButton connection={connection} target={{ kind: 'table', schema: active.browse.schema, table: active.browse.table }}
            onImported={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, 0)} />}
          {result && columns.length > 0 && <><button type="button" onClick={() => copy(toCsv(columns, result.rows))}>Copy CSV</button>
            <button type="button" onClick={() => copy(toJsonRows(columns, result.rows))}>Copy JSON</button></>}
        </div>
        {active.error && <div role="alert" className="oq-query-error"><strong>Query failed</strong><pre>{active.error}</pre></div>}
        {result?.notices?.map(notice => <p key={notice} className="oq-muted oq-notice">{notice}</p>)}
        {active.details && <ColumnsPanel details={active.details} />}
        {active.browse && result && <TableEditor key={`${active.browse.schema}.${active.browse.table}`} connection={connection} schema={active.browse.schema} table={active.browse.table}
          result={result} selectedRow={selectedRow} onClearSelection={() => setSelectedRow(null)}
          onApplied={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, active.browse!.offset)} />}
        <div className="oq-results-body">
          {active.explain ? <ExplainView explain={active.explain} onClose={() => patch(active.id, { explain: null })} />
            : result && columns.length > 0 ? <ResultGrid columns={columns} types={types} rows={result.rows} onCopy={copy} selected={selectedRow} onSelect={index => setSelectedRow(current => current === index ? null : index)} />
            : result && !active.error ? <div className="oq-empty"><p>{result.command ?? 'Done'}{result.affectedRows !== undefined ? ` · ${result.affectedRows} row${result.affectedRows === 1 ? '' : 's'} affected` : ''}</p></div>
              : !active.error && <div className="oq-empty"><p>Write a query and press <kbd>Ctrl ↵</kbd>, or pick a table on the left.</p></div>}
          {row && <aside className="oq-row-detail" aria-label="Row details">
            <header><strong>Row {selectedRow! + 1}</strong><button type="button" aria-label="Close row details" onClick={() => setSelectedRow(null)}><X size={13} aria-hidden="true" /></button></header>
            <dl>{columns.map((name, index) => <div key={`${name}:${index}`}><dt>{name}<small>{types[index]}</small></dt><dd className={row[index] === null ? 'is-null' : undefined} onDoubleClick={() => copy(displayCell(row[index]))} title="Double-click to copy">{displayCell(row[index])}</dd></div>)}</dl>
          </aside>}
        </div>
      </div>
    </div>
  </div>
}

function summary(result: SqlResult, browse: Browse | null): string {
  if (browse) return `rows ${browse.offset + 1}–${browse.offset + result.rowCount} · ${result.durationMs} ms`
  if (result.columns.length === 0) return `${result.command ?? 'Done'}${result.affectedRows !== undefined ? ` · ${result.affectedRows} rows affected` : ''} · ${result.durationMs} ms`
  return `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}${result.truncated ? ' (limited — more exist)' : ''} · ${result.durationMs} ms`
}

function ColumnsPanel({ details }: { details: SqlTableDetails }): ReactElement {
  const [open, setOpen] = useState(false)
  return <section className="oq-columns" aria-label="Table structure">
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}Structure · {details.columns.length} columns · {details.indexes.length} indexes</button>
    {open && <div className="oq-columns-grid">
      <table><thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Default</th></tr></thead>
        <tbody>{details.columns.map(column => <tr key={column.name}><td>{column.primaryKey ? '🔑 ' : ''}{column.name}</td><td>{column.type}</td><td>{column.nullable ? 'yes' : 'no'}</td><td>{column.default ?? ''}</td></tr>)}</tbody></table>
      {details.indexes.length > 0 && <ul>{details.indexes.map(index => <li key={index.name} title={index.definition}>{index.name}{index.primary ? ' · primary' : index.unique ? ' · unique' : ''}</li>)}</ul>}
    </div>}
  </section>
}

function SchemaTree({ connection, onOpen, onInsert }: { connection: OxeQueryConnection; onOpen: (table: SqlTable) => void; onInsert: (sql: string) => void }): ReactElement {
  const [schemas, setSchemas] = useState<string[]>([])
  const [tables, setTables] = useState<Record<string, SqlTable[]>>({})
  const [openSchemas, setOpenSchemas] = useState<Set<string>>(new Set(['public']))
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(async (schema: string): Promise<void> => {
    try { const list = await oq('sql.tables', { connectionId: connection.id, schema }); setTables(current => ({ ...current, [schema]: list })) }
    catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])
  useEffect(() => {
    let alive = true
    oq('sql.schemas', { connectionId: connection.id }).then(list => { if (alive) { setSchemas(list); if (list.includes('public')) void load('public') } }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [connection.id, load])
  const toggle = (schema: string): void => {
    setOpenSchemas(current => { const next = new Set(current); if (next.has(schema)) next.delete(schema); else { next.add(schema); if (!tables[schema]) void load(schema) } return next })
  }
  const needle = filter.trim().toLowerCase()
  return <nav className="oq-tree" aria-label="Schema">
    <input type="search" className="oq-tree-filter" aria-label="Filter tables" placeholder="Filter tables" value={filter} onChange={event => setFilter(event.target.value)} />
    {error && <p role="alert" className="oq-error">{error}</p>}
    {schemas.map(schema => {
      const list = (tables[schema] ?? []).filter(table => !needle || table.name.toLowerCase().includes(needle))
      const expanded = openSchemas.has(schema) || (needle !== '' && list.length > 0)
      return <div key={schema}>
        <button type="button" className="oq-tree-node" aria-expanded={expanded} onClick={() => toggle(schema)}>
          {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{schema}</button>
        {expanded && list.map(table => <div key={table.name} className="oq-tree-leaf">
          <button type="button" title={`Browse ${schema}.${table.name}`} onClick={() => onOpen(table)}>{table.name}<small>{table.kind === 'table' ? '' : table.kind}</small></button>
          <button type="button" aria-label={`Write a query for ${table.name}`} title="Open a new query for this table" onClick={() => onInsert(`SELECT *\nFROM "${schema.replace(/"/g, '""')}"."${table.name.replace(/"/g, '""')}"\nLIMIT 100;`)}>Query</button>
        </div>)}
      </div>
    })}
  </nav>
}
