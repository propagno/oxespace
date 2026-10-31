import Editor, { type OnMount } from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { ChevronDown, ChevronRight, Gauge, Play, Plus, Square, Table2, X } from 'lucide-react'
// Side-effect: self-hosted Monaco (no CDN), required before <Editor> mounts.
import '../../lib/monacoSetup'
import { MONACO_THEME } from '../../lib/monacoTheme'
import type { OxeQueryConnection, SqlFilter, SqlResult, SqlTable, SqlTableDetails, SqlTxState, WorkspaceState } from '../../../shared/types/oxequery'
import { namedToPositional, scanParameters, splitStatements, statementAt } from '../../../shared/sqlText'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { ResultGrid, type GridSort } from './ResultGrid'
import { SQL_NULL, displayCell, formatRows, type CopyFormat } from './grid-format'
import { LibraryMenu } from './LibraryMenu'
import { ExportButton, TableEditor } from './TableEditor'
import { SchemaTree } from './SchemaTree'
import { ReconnectBar } from './ReconnectBar'
import { AskAgent } from './AskAgent'
import { QueryError } from './QueryError'
import { describeTable } from './agent-prompt'
import { ImportButton } from './ImportDialog'
import { ExplainView } from './ExplainView'
import { bindCompletion, cacheFor } from './sql-completion'
import { registerSqlExtras } from './sql-snippets'
import { CellViewer, FilterBar, ParamsBar, TxBar } from './WorkbenchPanels'
import { MAX_TABS, completeFilters, looksLikeLostConnection, newTab, outputError, outputsFromScript, restoreWorkspace, serializeWorkspace, type Browse, type Output, type ParamValue, type QueryTab } from './workbench-model'
import { Select, TextField } from '../../ui/Field'
import { EmptyState, ErrorState, LoadingState } from '../../ui/Display'
import { copyText, formatMs, tq } from './catalog'
import { Splitter } from '../../ui/Splitter'
import { toast } from '../../ui/Toast'
import { EDITOR_HEIGHT, RESULTS_MIN_HEIGHT, TREE_WIDTH, useHeight, useOxeQueryLayout } from './oxequery-layout.store'
import { formatNumber } from '../../utils/formatTime'
import { nameMatches } from '../../../shared/oxequerySafety'
import { useConnectionSafety } from './useConnectionSafety'
import { useSqlLint } from './useSqlLint'
import { confirmScript, lineAt } from './confirm-statements'
import { ConfirmStatements } from './ConfirmStatements'

const ROW_LIMITS = [100, 500, 1000, 5000, 10_000, 50_000, 100_000]
const PAGE = 100
/** Rows the result grid holds after "Load more"; the rest of a longer result is for an export. */
const MAX_GRID_ROWS = 1_000_000
const SAVE_DELAY_MS = 700

/** What waits for a confirmation or for parameter values: the text to run and where it sits in the editor. */
/** `typed`: the connection's name has to be typed before it goes on (production); `destructive`: the statement removes data for good. */
interface Pending { text: string; base: number; reasons: string[]; explain?: 'analyze'; typed?: boolean; destructive?: boolean }
interface ParamsAsk { text: string; base: number; names: string[]; confirmed: boolean }

function copy(text: string, what = tq('workbench.copiedText'), done = tq('workbench.copiedTextDone')): void {
  void copyText(text, what, done)
}

/** Query tabs and toolbar above the editor, which the editor's height does not include. */
const EDITOR_CHROME = 90

export function SqlWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const { t } = useTranslation('oxequery')
  const layout = useOxeQueryLayout()
  const main = useRef<HTMLDivElement>(null)
  const mainHeight = useHeight(main)
  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab('SELECT now();', tq('workbench.queryTitle', { number: 1 }))])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [loaded, setLoaded] = useState(false)
  const [pinned, setPinned] = useState<NonNullable<WorkspaceState['pinned']>>([])
  const [running, setRunning] = useState(false)
  const safety = useConnectionSafety(connection)
  const [chosenRows, setMaxRows] = useState(connection.maxRows)
  // A lower ceiling (the environment's, after a change in settings) takes the editor's choice down with it.
  const maxRows = Math.min(chosenRows, safety.maxRowsCeiling)
  const [pending, setPending] = useState<Pending | null>(null)
  const [typedName, setTypedName] = useState('')
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
  const lint = useSqlLint(connection, editor, monacoRef)
  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const activeRef = useRef(active)
  activeRef.current = active
  // What a confirmation is about: every statement that will run, with its editor line, and the reasons found in each.
  const { check: lintCheck, describe: lintDescribe } = lint
  const pendingScript = useMemo(() => {
    if (!pending) return null
    const source = editor.current?.getValue() ?? activeRef.current.sql
    const findings = lintCheck(pending.text).filter(finding => finding.destructive).map(finding => ({ start: finding.start, reason: lintDescribe(finding) }))
    return confirmScript(pending.text, source.slice(pending.base, pending.base + pending.text.length) === pending.text ? lineAt(source, pending.base) : 1, findings)
  }, [pending, lintCheck, lintDescribe])

  const patch = useCallback((id: string, change: Partial<QueryTab>): void => {
    setTabs(current => current.map(tab => tab.id === id ? { ...tab, ...change } : tab))
  }, [])

  // ---- workspace: the tabs come back when the connection is opened again --------------------------
  useEffect(() => {
    let alive = true
    oq('workspace.load', { connectionId: connection.id }).then(({ state }) => {
      if (!alive) return
      if (state) {
        const restored = restoreWorkspace(state)
        setTabs(restored.tabs); setActiveId(restored.activeId); setPinned(restored.pinned)
        // The editor is keyed by tab id, so it is only reused (and needs the text) when the id happens to be the same.
        const shown = restored.tabs.find(tab => tab.id === restored.activeId)
        if (shown && editor.current && activeRef.current.id === shown.id && editor.current.getValue() !== shown.sql) editor.current.setValue(shown.sql)
      }
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

  // The editor owns its text while a person types: a controlled value drops keystrokes that arrive between a
  // render and its state, and so would comparing state with the editor to decide whether to push (state lags
  // behind the editor while keys are still coming in). Text that comes from elsewhere (the library, a restored
  // workspace) is therefore pushed in on purpose, here, and never inferred.
  const replaceText = useCallback((id: string, text: string): void => {
    patch(id, { sql: text })
    const instance = editor.current
    if (instance && activeRef.current.id === id && instance.getValue() !== text) instance.setValue(text)
  }, [patch])

  // ---- transaction state ---------------------------------------------------------------------------
  const refreshTx = useCallback(async (): Promise<void> => {
    if (safety.readOnly) return
    try { setTx(await oq('sql.tx', { connectionId: connection.id, action: 'status' })) } catch { /* the state is a convenience */ }
  }, [connection.id, safety.readOnly])
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
    // The editor's own text: state lags behind it while keys are still arriving (a slow machine, a fast typist).
    const sql = instance?.getValue() ?? activeRef.current.sql
    const position = instance?.getPosition()
    const span = statementAt(sql, position && model ? model.getOffsetAt(position) : 0)
    return span ? { text: span.text, base: span.start } : null
  }, [])

  // ---- running -------------------------------------------------------------------------------------
  const run = useCallback(async (text: string, base: number, confirmed = false, values: Record<string, ParamValue> = paramValues, confirmName?: string): Promise<void> => {
    const tab = activeRef.current
    if (!text.trim()) return
    const spans = splitStatements(text)
    const scan = scanParameters(text)
    if (scan.kind !== 'none' && spans.length > 1) { patch(tab.id, { outputs: [{ id: 's0', label: t('params.title'), start: base, text, error: { message: t('params.oneStatement') } }], outputIndex: 0, browse: null, details: null, explain: null }); return }
    if (scan.kind !== 'none' && scan.names.some(name => values[name] === undefined)) { setParamsAsk({ text, base, names: scan.names, confirmed }); return }
    // Advice the editor already marked becomes a question before a statement that removes data runs.
    if (!confirmed && !safety.readOnly) {
      const risky = lint.check(text).filter(finding => finding.destructive)
      if (risky.length) { setPending({ text, base, reasons: risky.map(lint.describe), typed: safety.typedConfirmation, destructive: true }); return }
    }
    setRunning(true); setPending(null); setParamsAsk(null); setSelectedRow(null); setCell(null); setNotice('')
    patch(tab.id, { browse: null, details: null, explain: null })
    clearMarkers()
    try {
      if (spans.length > 1) {
        const outcome = await oq('sql.script', { connectionId: connection.id, sql: text, maxRows, confirmed, ...(confirmName ? { confirmName } : {}) })
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
        const result = await oq('sql.run', { connectionId: connection.id, sql, maxRows, confirmed, paged: true, ...(params ? { params } : {}), ...(confirmName ? { confirmName } : {}) })
        patch(tab.id, { outputs: [{ id: 's0', label: text.replace(/\s+/g, ' ').slice(0, 40), start: base, text, result }], outputIndex: 0 })
        // New or dropped tables and columns must show up in suggestions without reconnecting.
        if (/^(CREATE|ALTER|DROP)/i.test(result.command ?? '')) cacheFor(connection).clear()
      }
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setPending({ text, base, reasons: cause.reasons, typed: safety.typedConfirmation, destructive: true })
      else if (cause instanceof OxeQueryClientError && cause.code === 'confirm-name') setPending({ text, base, reasons: cause.reasons, typed: true })
      else {
        patch(tab.id, { outputs: [{ id: 's0', label: text.replace(/\s+/g, ' ').slice(0, 40), start: base, text, error: outputError(cause, errorMessage(cause)) }], outputIndex: 0 })
        if (cause instanceof OxeQueryClientError && cause.position) markError(base + cause.position - 1, cause.message)
      }
    } finally { setRunning(false); setLibraryTick(value => value + 1); void refreshTx() }
  }, [clearMarkers, connection, lint, markError, maxRows, paramValues, patch, refreshTx, safety, t])

  /** Appends the next rows of a long SELECT; the server keeps its cursor until they run out or another statement runs. */
  const loadMore = useCallback(async (): Promise<void> => {
    const tab = activeRef.current
    const index = Math.min(tab.outputIndex, Math.max(0, tab.outputs.length - 1))
    const current = tab.outputs[index]?.result
    if (!current?.pageId) return
    setRunning(true); setNotice('')
    try {
      const next = await oq('sql.more', { connectionId: connection.id, pageId: current.pageId, maxRows })
      const merged: SqlResult = { ...current, rows: [...current.rows, ...next.rows], rowCount: current.rowCount + next.rowCount, truncated: next.truncated,
        durationMs: current.durationMs + next.durationMs, limitedBy: next.limitedBy, pageId: next.pageId }
      // The grid keeps everything in memory; past this point the rest of the result belongs in an export.
      if (merged.rowCount >= MAX_GRID_ROWS) delete merged.pageId
      patch(tab.id, { outputs: tab.outputs.map((entry, at) => at === index ? { ...entry, result: merged } : entry) })
    } catch (cause) {
      // The rows already shown stay; only the open page is gone.
      patch(tab.id, { outputs: tab.outputs.map((entry, at) => at === index && entry.result ? { ...entry, result: { ...entry.result, pageId: undefined } } : entry) })
      setNotice(errorMessage(cause))
    } finally { setRunning(false) }
  }, [connection, maxRows, patch])

  const explain = useCallback(async (analyze: boolean, confirmed = false, confirmName?: string): Promise<void> => {
    const tab = activeRef.current
    const target = pendingExplain.current ?? currentStatement()
    if (!target || !target.text.trim()) return
    setRunning(true); setPending(null)
    try {
      patch(tab.id, { explain: await oq('sql.explain', { connectionId: connection.id, sql: target.text, analyze, confirmed, ...(confirmName ? { confirmName } : {}) }), outputs: [], browse: null, details: null })
      pendingExplain.current = null
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && (cause.code === 'confirm' || cause.code === 'confirm-name')) { pendingExplain.current = target; setPending({ text: target.text, base: target.base, reasons: cause.reasons, explain: 'analyze', typed: safety.typedConfirmation }) }
      else patch(tab.id, { explain: null, outputs: [{ id: 's0', label: t('workbench.explain'), start: target.base, text: target.text, error: outputError(cause, errorMessage(cause)) }], outputIndex: 0 })
    } finally { setRunning(false) }
  }, [connection.id, currentStatement, patch, safety.typedConfirmation, t])

  /** Goes on with what the dialog holds, handing over the typed name when one was asked for. */
  const confirmPending = (): void => {
    if (!pending) return
    const name = pending.typed ? typedName.trim() : undefined
    setTypedName('')
    if (pending.explain) void explain(true, true, name)
    else void run(pending.text, pending.base, true, paramValues, name)
  }

  const runCurrent = useCallback((): void => { const target = currentStatement(); if (target) void run(target.text, target.base) }, [currentStatement, run])
  const runAll = useCallback((): void => {
    const sql = editor.current?.getValue() ?? activeRef.current.sql, selection = editor.current?.getSelection(), model = editor.current?.getModel()
    // A selection runs from where it starts, so markers and the confirmation's line numbers point at the editor's lines.
    if (selection && !selection.isEmpty() && model) void run(model.getValueInRange(selection), model.getOffsetAt(selection.getStartPosition()))
    else void run(sql, 0)
  }, [run])
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
    } catch (cause) { patch(tab.id, { outputs: [{ id: 's0', label: table.name, start: 0, text: '', error: outputError(cause, errorMessage(cause)) }], outputIndex: 0 }) } finally { setRunning(false) }
  }, [connection.id, patch])

  const addTab = (sql = ''): void => {
    // The tree and the definition panel open tabs too; at the limit they say so instead of doing nothing.
    if (tabs.length >= MAX_TABS) { toast({ title: t('workbench.tabLimit', { count: MAX_TABS }), intent: 'info' }); return }
    const tab = newTab(sql)
    setTabs(current => [...current, tab]); setActiveId(tab.id); setSelectedRow(null); setCell(null)
  }
  const closeTab = (id: string): void => {
    if (tabs.length === 1) { patch(id, { outputs: [], outputIndex: 0, browse: null, details: null, explain: null }); replaceText(id, ''); return }
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
  const copyAs = (format: CopyFormat): void => { if (result) copy(formatRows(format, columns, result.rows, qualified), t('workbench.copiedResults'), t('workbench.copiedResultsDone')) }
  const executedText = active.browse ? null : output?.text ?? null

  // The editor is as tall as it was dragged, but never so tall that the results lose their minimum height.
  const editorMax = Math.max(EDITOR_HEIGHT.min, mainHeight - RESULTS_MIN_HEIGHT - EDITOR_CHROME)
  const editorHeight = mainHeight ? Math.min(layout.editorHeight, editorMax) : layout.editorHeight
  return <div className="oq-workbench" style={{ '--oq-tree-width': `${layout.treeWidth}px` } as CSSProperties}>
    <SchemaTree connection={connection} pinned={pinned} onPinnedChange={setPinned} onOpen={table => void openTable(table)} onInsert={text => addTab(text)} />
    <Splitter orientation="vertical" label={t('workbench.treeWidth')} value={layout.treeWidth} min={TREE_WIDTH.min} max={TREE_WIDTH.max} defaultValue={TREE_WIDTH.default} onChange={treeWidth => layout.set({ treeWidth })} />
    <div className="oq-workbench-main" ref={main}>
      <div className="oq-qtabs" role="tablist" aria-label={t('workbench.queries')}>
        {tabs.map(tab => <span key={tab.id} className="oq-qtab" data-active={tab.id === active.id}>
          <button type="button" role="tab" aria-selected={tab.id === active.id} onClick={() => { setActiveId(tab.id); setSelectedRow(null); setCell(null) }}>{tab.title}</button>
          <button type="button" className="oq-tab-close" aria-label={t('view.closeTab', { name: tab.title })} onClick={() => closeTab(tab.id)}><X size={11} aria-hidden="true" /></button>
        </span>)}
        <button type="button" className="oq-qtab-add" data-oq-action="newQuery" aria-label={t('workbench.newQuery')} title={t('workbench.newQueryTitle')} disabled={tabs.length >= MAX_TABS} onClick={() => addTab('')}><Plus size={13} aria-hidden="true" /></button>
        <span className="oq-spacer" />
        <span className="oq-badge" data-environment={connection.environment}>{t(`environment.short.${connection.environment}`)}</span>
        <span className="oq-badge" data-readonly={safety.readOnly} data-policy={safety.readOnlyBy === 'policy' ? 'true' : undefined} title={safety.readOnlyBy === 'policy' ? t('workbench.readOnlyPolicyTitle') : safety.readOnly ? t('workbench.readOnlyTitle') : t('workbench.readWriteTitle')}>{safety.readOnlyBy === 'policy' ? t('workbench.readOnlyPolicy') : safety.readOnly ? t('common.readOnly') : t('common.readWrite')}</span>
      </div>
      <div className="oq-editor-toolbar">
        <div className="oq-tb-group" role="group" aria-label={t('common.run')}>
          <Button size="sm" variant="primary" icon={<Play size={13} aria-hidden="true" />} onClick={runCurrent} disabled={running} title={t('workbench.runTitle')}>{t('common.run')}</Button>
          <Button size="sm" data-oq-action="runAll" onClick={runAll} disabled={running} title={t('workbench.runAllTitle')}>{t('workbench.runAll')}</Button>
          {running && <Button size="sm" icon={<Square size={13} aria-hidden="true" />} onClick={cancel} title={t('workbench.cancelTitle')}>{t('common.cancel')}</Button>}
        </div>
        <div className="oq-tb-group" role="group" aria-label={t('workbench.planAndFormat')}>
          <Button size="sm" icon={<Gauge size={13} aria-hidden="true" />} onClick={() => { pendingExplain.current = null; void explain(false) }} disabled={running} title={t('workbench.explainTitle')}>{t('workbench.explain')}</Button>
          <Button size="sm" onClick={() => { pendingExplain.current = null; void explain(true) }} disabled={running} title={t('workbench.analyzeTitle')}>{t('workbench.analyze')}</Button>
          <Button size="sm" onClick={format} title={t('workbench.formatTitle')}>{t('workbench.format')}</Button>
        </div>
        <label className="oq-inline" title={safety.maxRowsCeiling < Math.max(...ROW_LIMITS) ? t('workbench.limitTitle', { formatted: formatNumber(safety.maxRowsCeiling) }) : undefined}>{t('workbench.limit')}<Select className="oq-select" value={maxRows} onChange={event => setMaxRows(Number(event.target.value))}>{[...new Set([...ROW_LIMITS, connection.maxRows, safety.maxRowsCeiling])].filter(value => value <= safety.maxRowsCeiling).sort((a, b) => a - b).map(value => <option key={value} value={value}>{t('common.rows', { count: value, formatted: formatNumber(value) })}</option>)}</Select></label>
        <span className="oq-badge" data-oq-timeout title={t('workbench.timeoutTitle', { seconds: formatNumber(Math.round(safety.statementTimeoutMs / 1000)) })}>{t('workbench.timeout', { seconds: formatNumber(Math.round(safety.statementTimeoutMs / 1000)) })}</span>
        <div className="oq-tb-group oq-tb-end">
        {!safety.readOnly && <TxBar state={tx} busy={running} onAction={action => void txAction(action)} />}
        <LibraryMenu connection={connection} currentSql={active.sql} refreshKey={libraryTick} onPick={sql => replaceText(active.id, sql)} />
        <AskAgent hasError={Boolean(error)} hasPlan={Boolean(active.explain)} context={{
          connectionName: connection.name, engine: 'postgres', environment: connection.environment, sql: active.sql,
          ...(error ? { errorMessage: error.message, ...(error.sqlState ? { sqlState: error.sqlState } : {}) } : {}), explain: active.explain,
          ...(active.browse && active.details ? { tables: [describeTable(active.browse.schema, active.browse.table, active.details.columns)] } : {})
        }} />
        </div>
      </div>
      {notice && <div className="oq-notice"><ErrorState compact title={notice} /></div>}
      {/* Ctrl+Shift+Enter is also a built-in Monaco chord (insert a line above) and some platforms resolve it before ours: taken here, in the capture phase, it always means "run all". */}
      <div className="oq-editor" style={{ height: editorHeight }} onKeyDownCapture={event => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); runAllRef.current() }
      }}><Editor key={active.id} height="100%" language="sql" theme={MONACO_THEME} defaultValue={active.sql} onChange={value => { patch(active.id, { sql: value ?? '' }); lint.schedule() }}
        onMount={(instance, monaco) => {
          editor.current = instance; monacoRef.current = monaco; bindCompletion(monaco, connection); registerSqlExtras(monaco); lint.mark()
          instance.onDidFocusEditorText(() => bindCompletion(monaco, connection))
          instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current())
          instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => runAllRef.current())
        }}
        options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, tabSize: 2, padding: { top: 8 }, formatOnPaste: false,
          // Space, `(` and `.` end a word in SQL; they must not also accept whatever suggestion is highlighted (Enter and Tab do).
          acceptSuggestionOnCommitCharacter: false }} /></div>
      <Splitter orientation="horizontal" label={t('workbench.editorHeight')} value={editorHeight} min={EDITOR_HEIGHT.min} max={editorMax} defaultValue={EDITOR_HEIGHT.default} onChange={height => layout.set({ editorHeight: height })} />
      {paramsAsk && <ParamsBar names={paramsAsk.names} values={paramValues}
        onChange={(name, value) => setParamValues(current => ({ ...current, [name]: value }))}
        onRun={() => { const ask = paramsAsk; setParamsAsk(null); void run(ask.text, ask.base, ask.confirmed) }} onCancel={() => setParamsAsk(null)} />}
      {pending && <ConfirmDialog danger title={pending.explain ? t('workbench.confirm.analyzeTitle') : pending.destructive ? t('workbench.confirm.destructiveTitle') : t('workbench.confirm.typedTitle')} testId="oxequery-confirm"
        confirmLabel={pending.explain ? t('workbench.confirm.analyzeAnyway') : pending.typed ? t('workbench.confirm.runOnProduction') : t('workbench.confirm.runAnyway')} cancelLabel={t('common.cancel')}
        confirmDisabled={pending.typed === true && !nameMatches(typedName, connection.name)}
        description={pending.typed ? t('workbench.confirm.typedHint') : connection.environment === 'prod' ? t('workbench.confirm.production') : t('workbench.confirm.check')}
        onCancel={() => { pendingExplain.current = null; setPending(null); setTypedName('') }}
        onConfirm={() => confirmPending()}>
        {pendingScript && <ConfirmStatements script={pendingScript} generalReasons={pending.reasons} />}
        {pending.typed && <TextField label={t('workbench.confirm.typeName', { name: connection.name })} value={typedName} autoComplete="off" spellCheck={false} mono
          onChange={event => setTypedName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && nameMatches(typedName, connection.name)) { event.preventDefault(); confirmPending() } }} />}
      </ConfirmDialog>}
      <div className="oq-results">
        {active.outputs.length > 1 && <div className="oq-output-tabs" role="tablist" aria-label={t('workbench.results')}>
          {active.outputs.map((entry, index) => <button key={entry.id} type="button" role="tab" aria-selected={index === active.outputIndex} data-error={entry.error ? 'true' : undefined}
            title={entry.text} onClick={() => { patch(active.id, { outputIndex: index }); setSelectedRow(null); setCell(null) }}>{index + 1}. {entry.error ? '✕ ' : ''}{entry.label}</button>)}
        </div>}
        <div className="oq-results-bar">
          {active.browse && <span className="oq-results-title"><Table2 size={13} aria-hidden="true" /> {active.browse.schema}.{active.browse.table}</span>}
          <span className="oq-muted">{running ? t('workbench.running') : result ? summary(result, active.browse) : error ? t('workbench.noResult') : t('workbench.resultsHere')}</span>
          <span className="oq-spacer" />
          {active.browse && <><button type="button" disabled={running || active.browse.offset === 0} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: Math.max(0, active.browse!.offset - PAGE) })}>{t('common.previous')}</button>
            <button type="button" disabled={running || !result?.truncated} onClick={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: active.browse!.offset + PAGE })}>{t('common.next')}</button></>}
          {!active.browse && result?.pageId && <button type="button" disabled={running} onClick={() => void loadMore()}>{t('workbench.loadMore', { count: maxRows, formatted: formatNumber(maxRows) })}</button>}
          {(active.browse || (result && columns.length > 0 && executedText?.trim())) && <ExportButton connection={connection}
            source={active.browse ? { kind: 'table', schema: active.browse.schema, table: active.browse.table } : { kind: 'sql', sql: executedText ?? '' }}
            label={active.browse ? t('export.table') : t('export.query')} />}
          {active.browse && <ImportButton connection={connection} target={{ kind: 'table', schema: active.browse.schema, table: active.browse.table }}
            onImported={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' })} />}
          {result && columns.length > 0 && <Select className="oq-select" aria-label={t('workbench.copyAs')} value="" onChange={event => { if (event.target.value) copyAs(event.target.value as CopyFormat) }}>
            <option value="">{t('workbench.copyAsPlaceholder')}</option>{COPY_FORMATS.map(format => <option key={format} value={format}>{t(`workbench.copyFormat.${format}`)}</option>)}</Select>}
        </div>
        {error && <QueryError error={error}>{looksLikeLostConnection(error.message) && <ReconnectBar connection={connection} />}</QueryError>}
        {result?.notices?.map(text => <p key={text} className="oq-muted oq-notice">{text}</p>)}
        {/* Structure, filter, definition and row editing sit in one wrapping row; an open one takes the full width. */}
        <div className="oq-extras">
        {active.details && <ColumnsPanel details={active.details} />}
        {active.browse && active.details && <FilterBar key={`${active.browse.schema}.${active.browse.table}:${JSON.stringify(active.browse.filters)}`} columns={active.details.columns} filters={active.browse.filters}
          onApply={filters => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: active.browse!.kind as SqlTable['kind'] }, { offset: 0, filters })} />}
        {active.browse && <DefinitionPanel connection={connection} schema={active.browse.schema} name={active.browse.table} kind={active.browse.kind} onOpen={text => addTab(text)} />}
        {active.browse && result && <TableEditor key={`${active.browse.schema}.${active.browse.table}`} connection={connection} schema={active.browse.schema} table={active.browse.table}
          result={result} selectedRow={selectedRow} onClearSelection={() => setSelectedRow(null)}
          onApplied={() => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: 'table' }, { offset: active.browse!.offset })} />}
        </div>
        <div className="oq-results-body">
          {active.explain ? <ExplainView explain={active.explain} onClose={() => patch(active.id, { explain: null })} />
            : result && columns.length > 0 ? <ResultGrid columns={columns} types={types} rows={result.rows} onCopy={copy} selected={selectedRow} tableName={qualified}
              onSelect={index => setSelectedRow(current => current === index ? null : index)} onOpenCell={setCell}
              {...(active.browse ? { sort: active.browse.sort, onSort: (sort: GridSort | null) => void openTable({ schema: active.browse!.schema, name: active.browse!.table, kind: active.browse!.kind as SqlTable['kind'] }, { offset: 0, sort }) } : {})} />
            : result && !error ? <div className="oq-placeholder"><EmptyState compact title={commandSummary(result)} /></div>
              : !error && <div className="oq-placeholder"><EmptyState compact title={<Trans t={t} i18nKey="workbench.emptyHint" components={{ kbd: <kbd /> }} />} /></div>}
          {cell && <CellViewer cell={cell} onCopy={copy} onClose={() => setCell(null)} />}
          {row && !cell && <aside className="oq-row-detail" aria-label={t('workbench.rowDetails')}>
            <header><strong>{t('workbench.row', { number: selectedRow! + 1 })}</strong><button type="button" aria-label={t('workbench.closeRowDetails')} onClick={() => setSelectedRow(null)}><X size={13} aria-hidden="true" /></button></header>
            <dl>{columns.map((name, index) => <div key={`${name}:${index}`}><dt>{name}<small>{types[index]}</small></dt><dd className={row[index] === null ? 'is-null' : undefined} onDoubleClick={() => copy(displayCell(row[index]))} title={t('workbench.doubleClickCopy')}>{displayCell(row[index])}</dd></div>)}</dl>
          </aside>}
        </div>
      </div>
    </div>
  </div>
}

const COPY_FORMATS: CopyFormat[] = ['csv', 'tsv', 'json', 'markdown', 'insert']

/** What a statement without rows did: its command tag and the rows it touched. */
function commandSummary(result: SqlResult): string {
  const command = result.command ?? tq('workbench.done')
  return result.affectedRows === undefined ? command : `${command} · ${tq('workbench.affected', { count: result.affectedRows, formatted: formatNumber(result.affectedRows) })}`
}

function summary(result: SqlResult, browse: Browse | null): string {
  const took = formatMs(result.durationMs)
  if (browse) {
    const range = tq('workbench.range', { from: formatNumber(browse.offset + 1), to: formatNumber(browse.offset + result.rowCount) })
    return `${result.totalRows !== undefined ? tq('workbench.rangeOf', { range, total: formatNumber(result.totalRows) }) : range} · ${took}`
  }
  if (result.columns.length === 0) return `${commandSummary(result)} · ${took}`
  const rows = tq('common.rows', { count: result.rowCount, formatted: formatNumber(result.rowCount) })
  const more = !result.truncated ? '' : result.limitedBy === 'bytes' ? ` ${tq('workbench.cutBytes')}`
    : result.pageId ? ` · ${tq('workbench.moreAvailable')}` : result.rowCount >= MAX_GRID_ROWS ? ` ${tq('workbench.gridFull', { max: formatNumber(MAX_GRID_ROWS) })}` : ` ${tq('workbench.limited')}`
  return `${rows}${more} · ${took}`
}

function DefinitionPanel({ connection, schema, name, kind, onOpen }: { connection: OxeQueryConnection; schema: string; name: string; kind?: string; onOpen: (sql: string) => void }): ReactElement {
  const { t } = useTranslation('oxequery')
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
  return <section className="oq-columns" aria-label={t('definition.label')}>
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{t('definition.title')}</button>
    {open && <div className="oq-columns-grid">
      {error ? <ErrorState compact title={t('definition.failed')} message={error} /> : text === null ? <LoadingState label={t('definition.loading')} />
        : <><pre className="oq-sql-preview">{text}</pre>
          <div className="oq-staged-actions"><button type="button" onClick={() => copy(text, t('definition.copied'), t('definition.copiedDone'))}>{t('common.copy')}</button><button type="button" onClick={() => onOpen(text)}>{t('definition.openInTab')}</button></div></>}
    </div>}
  </section>
}

function ColumnsPanel({ details }: { details: SqlTableDetails }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [open, setOpen] = useState(false)
  return <section className="oq-columns" aria-label={t('columns.label')}>
    <button type="button" className="oq-disclosure" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{t('columns.title', { columns: t('columns.columns', { count: details.columns.length }), indexes: t('columns.indexes', { count: details.indexes.length }) })}</button>
    {open && <div className="oq-columns-grid">
      <table><thead><tr><th>{t('columns.column')}</th><th>{t('columns.type')}</th><th>{SQL_NULL}</th><th>{t('columns.default')}</th></tr></thead>
        <tbody>{details.columns.map(column => <tr key={column.name}><td>{column.primaryKey ? '🔑 ' : ''}{column.name}</td><td>{column.type}</td><td>{column.nullable ? t('common.yes') : t('common.no')}</td><td>{column.default ?? ''}</td></tr>)}</tbody></table>
      {details.indexes.length > 0 && <ul>{details.indexes.map(index => <li key={index.name} title={index.definition}>{index.name}{index.primary ? ` · ${t('columns.primary')}` : index.unique ? ` · ${t('columns.unique')}` : ''}</li>)}</ul>}
    </div>}
  </section>
}
