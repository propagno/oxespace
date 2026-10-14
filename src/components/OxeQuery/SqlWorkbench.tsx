import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Gauge, Play, Plus, Square, Table2, X } from 'lucide-react'
// Side-effect: self-hosted Monaco (no CDN), required before <Editor> mounts.
import '../../lib/monacoSetup'
import { MONACO_THEME } from '../../lib/monacoTheme'
import type { OxeQueryConnection, SqlFilter, SqlResult, SqlTable, SqlTableDetails, SqlTxState, WorkspaceState } from '../../../shared/types/oxequery'
import { namedToPositional, scanParameters, splitStatements, statementAt } from '../../../shared/sqlText'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { ResultGrid, type GridSort } from './ResultGrid'
import { displayCell, formatRows, type CopyFormat } from './grid-format'
import { LibraryMenu } from './LibraryMenu'
import { ExportButton, TableEditor } from './TableEditor'
import { SchemaTree } from './SchemaTree'
import { ImportButton } from './ImportDialog'
import { ExplainView } from './ExplainView'
import { bindCompletion, cacheFor } from './sql-completion'
import { registerSqlExtras } from './sql-snippets'
import { CellViewer, FilterBar, ParamsBar, TxBar } from './WorkbenchPanels'
import { MAX_TABS, completeFilters, newTab, outputsFromScript, restoreWorkspace, serializeWorkspace, type Browse, type Output, type ParamValue, type QueryTab } from './workbench-model'

const ROW_LIMITS = [100, 500, 1000, 5000, 10_000, 50_000, 100_000]
const PAGE = 100
const SAVE_DELAY_MS = 700

/** What waits for a confirmation or for parameter values: the text to run and where it sits in the editor. */
interface Pending { text: string; base: number; reasons: string[]; explain?: 'analyze' }
interface ParamsAsk { text: string; base: number; names: string[]; confirmed: boolean }

function copy(text: string): void {
  void window.oxe?.clipboard?.writeText(text).catch(() => undefined)
}

export function SqlWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab('SELECT now();', 'Query 1')])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [loaded, setLoaded] = useState(false)
  const [pinned, setPinned] = useState<NonNullable<WorkspaceState['pinned']>>([])
  const [running, setRunning] = useState(false)
  const [maxRows, setMaxRows] = useState(connection.maxRows)
  const [pending, setPending] = useState<Pending | null>(null)
  const [paramsAsk, setParamsAsk] = useState<ParamsAsk | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, ParamValue>>({})
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [cell, setCell] = useState<{ column: string; type?: string; value: unknown; row: number } | null>(null)
  const [libraryTick, setLibraryTick] = useState(0)
  const [tx, setTx] = useState<SqlTxState>({ state: 'none', statements: 0 })
  const [notice, setNotice] = useState('')
  const editor = useRef<Parameters<OnMount>[0] | null>(null)
  const pendingExplain = useRef<{ text: string; base: number } | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const activeRef = useRef(active)
  activeRef.current = active

  const patch = useCallback((id: string, change: Partial<QueryTab>): void => {
    setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...change } : tab))
  }, [])

  // ---- workspace: the tabs come back when the connection is opened again --------------------------
  useEffect(() => {
    let alive = true
    oq('workspace.load', { connectionId: connection.id }).then(({ state }) => {
      if (!alive) return
      if (state) { const restored = restoreWorkspace(state); setTabs(restored.tabs); setActiveId(restored.activeId); setPinned(restored.pinned) }
      setLoaded(true)
    }, () => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [connection.id])

  const latest = useRef({ tabs, activeId, pinned })
  latest.current = { tabs, activeId, pinned }
  const saveNow = useCallback((): void => {
    void oq('workspace.save', { connectionId: connection.id, state: serializeWorkspace(latest.current.tabs, latest.current.activeId, latest.current.pinned) }).catch(() => undefined)
  }, [connection.id])
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(saveNow, SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [loaded, tabs, activeId, pinned, saveNow])
  useEffect(() => () => { if (loadedRef.current) saveNow() }, [saveNow])
  const loadedRef = useRef(false)
  loadedRef.current = loaded

  // The editor owns its text while a person types (a controlled value drops keystrokes that arrive
  // between a render and its state); text that comes from elsewhere (the library, a definition) is pushed in.
  const typed = useRef({ id: active.id, text: active.sql })
  useEffect(() => {
    const instance = editor.current
    // Text the editor itself produced is already there; only a change from elsewhere is pushed in.
    if (typed.current.id === active.id && typed.current.text === active.sql) return
    typed.current = { id: active.id, text: active.sql }
    if (instance && instance.getValue() !== active.sql) instance.setValue(active.sql)
  }, [active.id, active.sql])

  // ---- transaction state ---------------------------------------------------------------------------
  const refreshTx = useCallback(async (): Promise<void> => {
    if (connection.readOnly) return
    try { setTx(await oq('sql.tx', { connectionId: connection.id, action: 'status' })) } catch { /* the state is a convenience */ }
  }, [connection.id, connection.readOnly])
  useEffect(() => { void refreshTx() }, [refreshTx])
  const txAction = async (action: 'begin' | 'commit' | 'rollback'): Promise<void> => {
    setRunning(true); setNotice('')
    try { setTx(await oq('sql.tx', { connectionId: connection.id, action })) } catch (cause) { setNotice(errorMessage(cause)) } finally { setRunning(false) }
  }

  // ---- editor helpers ------------------------------------------------------------------------------
  const clearMarkers = useCallback((): void => {
    const model = editor.current?.getModel()
    if (model && monacoRef.current) monacoRef.current.editor.setModelMarkers(model, 'oxequery', [])
  }, [])

  /** Underlines the token the server complained about. `offset` is 0-based within the editor text. */
  const markError = useCallback((offset: number, message: string): void => {
    const model = editor.current?.getModel()
    const monaco = monacoRef.current
    if (!model || !monaco) return
    const start = model.getPositionAt(Math.max(0, offset))
    const word = model.getWordAtPosition(start)
    monaco.editor.setModelMarkers(model, 'oxequery', [{
      severity: monaco.MarkerSeverity.Error, message,
      startLineNumber: start.lineNumber, startColumn: start.column,
      endLineNumber: start.lineNumber, endColumn: word && word.endColumn > start.column ? word.endColumn : start.column + 1
    }])
  }, [])

  /** The selection, else the statement under the cursor; with no editor yet, the first statement. */
  const currentStatement = useCallback((): { text: string; base: number } | null => {
    const instance = editor.current
    const model = instance?.getModel()
    const selection = instance?.getSelection()
    if (instance && model && selection && !selection.isEmpty()) return { text: model.getValueInRange(selection), base: model.getOffsetAt(selection.getStartPosition()) }
    const sql = activeRef.current.sql
    const position = instance?.getPosition()
    const span = statementAt(sql, position && model ? model.getOffsetAt(position) : 0)
    return span ? { text: span.text, base: span.start } : null
  }, [])

  // ---- running -------------------------------------------------------------------------------------
  const run = useCallback(async (text: string, base: number, confirmed = false, values: Record<string, ParamValue> = paramValues): Promise<void> => {
    const tab = activeRef.current
    if (!text.trim()) return
    const spans = splitStatements(text)
    const scan = scanParameters(text)
    if (scan.kind !== 'none' && spans.length > 1) { patch(tab.id, { outputs: [{ id: 's0', label: 'Parameters', start: base, text, error: { message: 'Parameters work with one statement at a time. Run a single statement, or remove the parameters.' } }], outputIndex: 0, browse: null, details: null, explain: null }); return }
    if (scan.kind !== 'none' && scan.names.some(name => values[name] === undefined)) { setParamsAsk({ text, base, names: scan.names, confirmed }); return }
    setRunning(true); setPending(null); setParamsAsk(null); setSelectedRow(null); setCell(null); setNotice('')
    patch(tab.id, { browse: null, details: null, explain: null })
    clearMarkers()
    try {
      if (spans.length > 1) {
        const outcome = await oq('sql.script', { connectionId: connection.id, sql: text, maxRows, confirmed })
        const outputs = outputsFromScript(outcome.statements, base, text)
        patch(tab.id, { outputs, outputIndex: Math.max(0, outputs.length - 1) })
        const failed = outputs[outputs.length - 1]
        if (failed?.error?.position) markError(failed.start + failed.error.position - 1, failed.error.message)
      } else {
        let sql = text
        let params: (string | null)[] | undefined
        if (scan.kind === 'named') {
          const rewritten = namedToPositional(text)
          sql = rewritten.sql
          params = rewritten.names.map(name => (values[name].isNull ? null : values[name].value))
        } else if (scan.kind === 'positional') {
          const highest = Math.max(...scan.names.map(Number))
          params = Array.from({ length: highest }, (_, index) => { const entry = values[String(index + 1)]; return entry ? (entry.isNull ? null : entry.value) : null })
        }
        const result = await oq('sql.run', { connectionId: connection.id, sql, maxRows, confirmed, ...(params ? { params } : {}) })
        patch(tab.id, { outputs: [{ id: 's0', label: text.replace(/\s+/g, ' ').slice(0, 40), start: base, text, result }], outputIndex: 0 })
        // New or dropped tables and columns must show up in suggestions without reconnecting.
        if (/^(CREATE|ALTER|DROP)/i.test(result.command ?? '')) cacheFor(connection).clear()
      }
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setPending({ text, base, reasons: cause.reasons })
      else {
        patch(tab.id, { outputs: [{ id: 's0', label: text.replace(/\s+/g, ' ').slice(0, 40), start: base, text, error: { message: errorMessage(cause), ...(cause instanceof OxeQueryClientError && cause.position ? { position: cause.position } : {}) } }], outputIndex: 0 })
        if (cause instanceof OxeQueryClientError && cause.position) markError(base + cause.position - 1, cause.message)
      }
    } finally { setRunning(false); setLibraryTick(value => value + 1); void refreshTx() }
  }, [clearMarkers, connection, markError, maxRows, paramValues, patch, refreshTx])

  const explain = useCallback(async (analyze: boolean, confirmed = false): Promise<void> => {
    const tab = activeRef.current
    const target = pendingExplain.current ?? currentStatement()
    if (!target || !target.text.trim()) return
    setRunning(true); setPending(null)
    try {
      patch(tab.id, { explain: await oq('sql.explain', { connectionId: connection.id, sql: target.text, analyze, confirmed }), outputs: [], browse: null, details: null })
      pendingExplain.current = null
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') { pendingExplain.current = target; setPending({ text: target.text, base: target.base, reasons: cause.reasons, explain: 'analyze' }) }
      else patch(tab.id, { explain: null, outputs: [{ id: 's0', label: 'Explain', start: target.base, text: target.text, error: { message: errorMessage(cause) } }], outputIndex: 0 })
    } finally { setRunning(false) }
  }, [connection.id, currentStatement, patch])

  const runCurrent = useCallback((): void => { const target = currentStatement(); if (target) void run(target.text, target.base) }, [currentStatement, run])
  const runAll = useCallback((): void => { const sql = activeRef.current.sql; const selection = editor.current?.getSelection(); void run(selection && !selection.isEmpty() ? editor.current?.getModel()?.getValueInRange(selection) ?? sql : sql, 0) }, [run])
  const runRef = useRef(runCurrent); runRef.current = runCurrent
  const runAllRef = useRef(runAll); runAllRef.current = runAll

  // ---- browsing a table ------------------------------------------------------------------------------
  const openTable = useCallback(async (table: SqlTable, options: { offset?: number; sort?: GridSort | null; filters?: SqlFilter[] } = {}): Promise<void> => {
    const tab = activeRef.current
    const offset = options.offset ?? 0
    const previous = tab.browse && tab.browse.schema === table.schema && tab.browse.table === table.name ? tab.browse : null
    const filters = options.filters ?? previous?.filters ?? []
    const sort = options.sort !== undefined ? options.sort : previous?.sort ?? null
    setRunning(true); setPending(null); setSelectedRow(null); setCell(null)
    try {
      const details = previous ? tab.details : await oq('sql.table', { connectionId: connection.id, schema: table.schema, table: table.name })
      const key = details?.columns.find(column => column.primaryKey)
      const sortColumn = sort ? details?.columns[sort.column]?.name ?? null : null
      const rows = await oq('sql.browse', {
        connectionId: connection.id, schema: table.schema, table: table.name, limit: PAGE, offset,
        ...(sortColumn && sort ? { orderBy: { column: sortColumn, direction: sort.direction } } : key ? { orderBy: { column: key.name, direction: 'asc' as const } } : {}),
        ...(filters.length ? { filters } : {})
      })
      patch(tab.id, { outputs: [{ id: 's0', label: table.name, start: 0, text: '', result: rows }], outputIndex: 0, browse: { schema: table.schema, table: table.name, offset, kind: table.kind, sort, filters }, details, explain: null, title: table.name })
    } catch (cause) { patch(tab.id, { outputs: [{ id: 's0', label: table.name, start: 0, text: '', error: { message: errorMessage(cause) } }], outputIndex: 0 }) } finally { setRunning(false) }
  }, [connection.id, patch])

  const addTab = (sql = ''): void => {
    if (tabs.length >= MAX_TABS) return
    const tab = newTab(sql)
    setTabs(current => [...current, tab]); setActiveId(tab.id); setSelectedRow(null); setCell(null)
  }
  const closeTab = (id: string): void => {
    if (tabs.length === 1) { patch(id, { sql: '', outputs: [], outputIndex: 0, browse: null, details: null, explain: null }); return }
    const index = tabs.findIndex(tab => tab.id === id)
    const next = tabs.filter(tab => tab.id !== id)
    setTabs(next)
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id)
  }

  const cancel = (): void => { void oq('sql.cancel', { connectionId: connection.id }).catch(() => undefined) }
  const format = (): void => { void editor.current?.getAction('editor.action.formatDocument')?.run() }

  const output: Output | undefined = active.outputs[Math.min(active.outputIndex, Math.max(0, active.outputs.length - 1))]
  const result = output?.result
  const error = output?.error
  const columns = useMemo(() => result?.columns.map(column => column.name) ?? [], [result])
  const types = useMemo(() => result?.columns.map(column => column.type) ?? [], [result])
  const row = selectedRow !== null && result ? result.rows[selectedRow] : null
  const qualified = active.browse ? `"${active.browse.schema.replace(/"/g, '""')}"."${active.browse.table.replace(/"/g, '""')}"` : undefined
  const copyAs = (format: CopyFormat): void => { if (result) copy(formatRows(format, columns, result.rows, qualified)) }
  const executedText = active.browse ? null : output?.text ?? null

  return <div className="oq-workbench">
    <SchemaTree connection={connection} pinned={pinned} onPinnedChange={setPinned} onOpen={table => void openTable(table)} onInsert={text => addTab(text)} />
    <div className="oq-workbench-main">
      <div className="oq-qtabs" role="tablist" aria-label="Queries">
        {tabs.map(tab => <span key={tab.id} className="oq-qtab" data-active={tab.id === active.id}>
          <button type="button" role="tab" aria-selected={tab.id === active.id} onClick={() => { setActiveId(tab.id); setSelectedRow(null); setCell(null) }}>{tab.title}</button>
          <button type="button" className="oq-tab-close" aria-label={`Close ${tab.title}`} onClick={() => closeTab(tab.id)}><X size={11} aria-hidden="true" /></button>
        </span>)}
        <button type="button" className="oq-qtab-add" aria-label="New query" title="New query tab" disabled={tabs.length >= MAX_TABS} onClick={() => addTab('')}><Plus size={13} aria-hidden="true" /></button>
      </div>
      <div className="oq-editor-toolbar">
        <button type="button" className="oq-primary" onClick={runCurrent} disabled={running} title="Run the selection, or the statement the cursor is in (Ctrl+Enter)"><Play size={13} aria-hidden="true" />Run<kbd>Ctrl ↵</kbd></button>
        <button type="button" onClick={runAll} disabled={running} title="Run every statement, one after the other (Ctrl+Shift+Enter)">Run all</button>
        <button type="button" onClick={() => { pendingExplain.current = null; void explain(false) }} disabled={running} title="Show the execution plan without running the statement"><Gauge size={13} aria-hidden="true" />Explain</button>
        <button type="button" onClick={() => { pendingExplain.current = null; void explain(true) }} disabled={running} title="Run the statement and show real timings. A statement that changes data is rolled back.">Analyze</button>
        <button type="button" onClick={cancel} disabled={!running} title="Cancel the running statement"><Square size={13} aria-hidden="true" />Cancel</button>
        <button type="button" onClick={format} title="Format the SQL (Shift+Alt+F)">Format</button>
        <label className="oq-inline">Limit<select value={maxRows} onChange={event => setMaxRows(Number(event.target.value))}>{[...new Set([...ROW_LIMITS, connection.maxRows])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value.toLocaleString('en-US')} rows</option>)}</select></label>
        <LibraryMenu connection={connection} currentSql={active.sql} refreshKey={libraryTick} onPick={sql => patch(active.id, { sql })} />
        {!connection.readOnly && <TxBar state={tx} busy={running} onAction={action => void txAction(action)} />}
        <span className="oq-spacer" />
        <span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>
        <span className="oq-badge" data-readonly={connection.readOnly} title={connection.readOnly ? 'The server refuses statements that change data' : 'This connection can change data'}>{connection.readOnly ? 'read-only' : 'read-write'}</span>
      </div>
      {notice && <p role="alert" className="oq-error oq-notice">{notice}</p>}
      <div className="oq-editor"><Editor key={active.id} height="100%" language="sql" theme={MONACO_THEME} defaultValue={active.sql} onChange={value => { typed.current = { id: active.id, text: value ?? '' }; patch(active.id, { sql: value ?? '' }) }}
        onMount={(instance, monaco) => {
          editor.current = instance; monacoRef.current = monaco; bindCompletion(monaco, connection); registerSqlExtras(monaco)
          instance.onDidFocusEditorText(() => bindCompletion(monaco, connection))
          instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
          instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runAllRef.current())
        }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, tabSize: 2, padding: { top: 8 }, formatOnPaste: false,
          // Space, `(` and `.` end a word in SQL; they must not also accept whatever suggestion is highlighted (Enter and Tab do).
          acceptSuggestionOnCommitCharacter: false }} /></div>
      {paramsAsk && <ParamsBar names={paramsAsk.names} values={paramValues}
        onChange={(name, value) => setParamValues(current => ({ ...current, [name]: value }))}
        onRun={() => { const ask = paramsAsk; setParamsAsk(null); void run(ask.text, ask.base, ask.confirmed) }} onCancel={() => setParamsAsk(null)} />}
      {pending && <div className="oq-confirm" role="alertdialog" aria-label="Confirm statement">
        <strong>{pending.explain ? 'Analyze runs this statement' : 'This statement is destructive'}</strong>
        <ul>{pending.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {connection.environment === 'prod' && <p className="oq-error">This is a production connection.</p>}
        <div><button type="button" onClick={() => { pendingExplain.current = null; setPending(null) }}>Cancel</button><button type="button" className="oq-danger" onClick={() => pending.explain ? void explain(true, true) : void run(pending.text, pending.base, true)}>{pending.explain ? 'Analyze anyway' : 'Run anyway'}</button></div>
      </div>}
      <div className="oq-results">
        {active.outputs.length > 1 && <div className="oq-output-tabs" role="tablist" aria-label="Results">
          {active.outputs.map((entry, index) => <button key={entry.id} type="button" role="tab" aria-selected={index === active.outputIndex} data-error={entry.error ? 'true' : undefined}
            title={entry.text} onClick={() => { patch(active.id, { outputIndex: index }); setSelectedRow(null); setCell(null) }}>{index + 1}. {entry.error ? '✕ ' : ''}{entry.label}</button>)}
        </div>}
        <div className="oq-results-bar">
          {active.browse && <span className="oq-results-title"><Table2 size={13} aria-hidden="true" /> {active.browse.schema}.{active.browse.table}</span>}
          <span className="oq-muted">{running ? 'Running…' : result ? summary(result, active.browse) : 'Results appear here.'}</span>
          <span className="oq-spacer" />
          {active.browse && <><button type="button" disabled={running || active.browse.offset === 0} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: Math.max(0, active.browse!.offset - PAGE) })}>Previous</button>
            <button type="button" disabled={running || !result?.truncated} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: active.browse!.offset + PAGE })}>Next</button></>}
          {(active.browse || (result && columns.length > 0 && executedText?.trim())) && <ExportButton connection={connection}
            source={active.browse ? { kind: 'table', schema: active.browse.schema, table: active.browse.table } : { kind: 'sql', sql: executedText ?? '' }}
            label={active.browse ? 'Export table' : 'Export query'} />}
          {active.browse && <ImportButton connection={connection} target={{ kind: 'table', schema: active.browse.schema, table: active.browse.table }}
            onImported={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' })} />}
          {result && columns.length > 0 && <select aria-label="Copy results as" value="" onChange={event => { if (event.target.value) copyAs(event.target.value as CopyFormat) }}>
            <option value="">Copy as…</option><option value="csv">CSV</option><option value="tsv">TSV (spreadsheet)</option><option value="json">JSON</option><option value="markdown">Markdown table</option><option value="insert">INSERT statements</option></select>}
        </div>
        {error && <div role="alert" className="oq-query-error"><strong>Query failed</strong>{error.sqlState && <small> SQLSTATE {error.sqlState}</small>}<pre>{error.message}</pre>{error.hint && <p className="oq-muted">Hint: {error.hint}</p>}</div>}
        {result?.notices?.map(text => <p key={text} className="oq-muted oq-notice">{text}</p>)}
        {active.details && <ColumnsPanel details={active.details} />}
        {active.browse && active.details && <FilterBar key={`${active.browse.schema}.${active.browse.table}:${JSON.stringify(active.browse.filters)}`} columns={active.details.columns} filters={active.browse.filters}
          onApply={filters => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: active.browse!.kind as SqlTable['kind'] }, { offset: 0, filters })} />}
        {active.browse && <DefinitionPanel connection={connection} schema={active.browse.schema} name={active.browse.table} kind={active.browse.kind} onOpen={text => addTab(text)} />}
        {active.browse && result && <TableEditor key={`${active.browse.schema}.${active.browse.table}`} connection={connection} schema={active.browse.schema} table={active.browse.table}
          result={result} selectedRow={selectedRow} onClearSelection={() => setSelectedRow(null)}
          onApplied={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: active.browse!.offset })} />}
        <div className="oq-results-body">
          {active.explain ? <ExplainView explain={active.explain} onClose={() => patch(active.id, { explain: null })} />
            : result && columns.length > 0 ? <ResultGrid columns={columns} types={types} rows={result.rows} onCopy={copy} selected={selectedRow} tableName={qualified}
              onSelect={index => setSelectedRow(current => current === index ? null : index)} onOpenCell={setCell}
              {...(active.browse ? { sort: active.browse.sort, onSort: (sort: GridSort | null) => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: active.browse!.kind as SqlTable['kind'] }, { offset: 0, sort }) } : {})} />
            : result && !error ? <div className="oq-empty"><p>{result.command ?? 'Done'}{result.affectedRows !== undefined ? ` · ${result.affectedRows} row${result.affectedRows === 1 ? '' : 's'} affected` : ''}</p></div>
              : !error && <div className="oq-empty"><p>Write a query and press <kbd>Ctrl ↵</kbd> to run the statement you are in, <kbd>Ctrl ⇧ ↵</kbd> to run them all, or pick a table on the left.</p></div>}
          {cell && <CellViewer cell={cell} onCopy={copy} onClose={() => setCell(null)} />}
          {row && !cell && <aside className="oq-row-detail" aria-label="Row details">
            <header><strong>Row {selectedRow! + 1}</strong><button type="button" aria-label="Close row details" onClick={() => setSelectedRow(null)}><X size={13} aria-hidden="true" /></button></header>
            <dl>{columns.map((name, index) => <div key={`${name}:${index}`}><dt>{name}<small>{types[index]}</small></dt><dd className={row[index] === null ? 'is-null' : undefined} onDoubleClick={() => copy(displayCell(row[index]))} title="Double-click to copy">{displayCell(row[index])}</dd></div>)}</dl>
          </aside>}
        </div>
      </div>
    </div>
  </div>
}

function summary(result: SqlResult, browse: Browse | null): string {
  if (browse) return `rows ${browse.offset + 1}–${browse.offset + result.rowCount}${result.totalRows !== undefined ? ` of ${result.totalRows.toLocaleString('en-US')} matching` : ''} · ${result.durationMs} ms`
  if (result.columns.length === 0) return `${result.command ?? 'Done'}${result.affectedRows !== undefined ? ` · ${result.affectedRows} rows affected` : ''} · ${result.durationMs} ms`
  return `${result.rowCount} row${result.rowCount === 1 ? '' : 's'}${result.truncated ? (result.limitedBy === 'bytes' ? ' (cut: the result is too large to show — narrow the query or export it)' : ' (limited — more exist)') : ''} · ${result.durationMs} ms`
}

function DefinitionPanel({ connection, schema, name, kind, onOpen }: { connection: OxeQueryConnection; schema: string; name: string; kind?: string; onOpen: (sql: string) => void }): ReactElement {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  // Not keyed by the table: replacing a keyed sibling here left the old panel in the page. The state is reset instead.
  useEffect(() => { setOpen(false); setText(null); setError('') }, [schema, name])
  useEffect(() => {
    if (!open || text !== null) return
    let alive = true
    const objectKind = kind && kind.includes('view') ? 'view' : 'table'
    oq('sql.definition', { connectionId: connection.id, kind: objectKind, schema, name }).then(value => { if (alive) setText(value.text) }, cause => { if (alive) setError(errorMessage(cause)) })
    return () => { alive = false }
  }, [open, text, connection.id, schema, name, kind])
  return <section className="oq-columns" aria-label="Definition">
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}Definition (DDL)</button>
    {open && <div className="oq-columns-grid">
      {error ? <p role="alert" className="oq-error">{error}</p> : text === null ? <p className="oq-muted" aria-busy="true">Reading the catalog…</p>
        : <><pre className="oq-sql-preview">{text}</pre>
          <div className="oq-staged-actions"><button type="button" onClick={() => copy(text)}>Copy</button><button type="button" onClick={() => onOpen(text)}>Open in a new tab</button></div></>}
    </div>}
  </section>
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
