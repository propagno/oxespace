PATH = 'src/components/OxeQuery/SqlWorkbench.tsx'
R = [
("import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'\n",
 "import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'\nimport { Trans, useTranslation } from 'react-i18next'\n"),
("import { copyText } from '../../ui/clipboard'\n", "import { EmptyState, ErrorState, LoadingState } from '../../ui/Display'\nimport { copyText, formatMs, tq } from './catalog'\n"),
("import { displayCell, formatRows, type CopyFormat } from './grid-format'", "import { SQL_NULL, displayCell, formatRows, type CopyFormat } from './grid-format'"),
("function copy(text: string, what = 'Text'): void {\n  void copyText(text, what)\n}", "function copy(text: string, what = tq('workbench.copiedText')): void {\n  void copyText(text, what)\n}"),
("  const layout = useOxeQueryLayout()\n  const main = useRef<HTMLDivElement>(null)\n  const mainHeight = useHeight(main)\n  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab('SELECT now();', 'Query 1')])",
 "  const { t } = useTranslation('oxequery')\n  const layout = useOxeQueryLayout()\n  const main = useRef<HTMLDivElement>(null)\n  const mainHeight = useHeight(main)\n  const [tabs, setTabs] = useState<QueryTab[]>(() => [newTab('SELECT now();', tq('workbench.queryTitle', { number: 1 }))])"),
("outputs: [{ id: 's0', label: 'Parameters', start: base, text, error: { message: 'Parameters work with one statement at a time. Run a single statement, or remove the parameters.' } }]",
 "outputs: [{ id: 's0', label: t('params.title'), start: base, text, error: { message: t('params.oneStatement') } }]"),
("  }, [clearMarkers, connection, markError, maxRows, paramValues, patch, refreshTx])", "  }, [clearMarkers, connection, markError, maxRows, paramValues, patch, refreshTx, t])"),
("outputs: [{ id: 's0', label: 'Explain', start: target.base,", "outputs: [{ id: 's0', label: t('workbench.explain'), start: target.base,"),
("  }, [connection.id, currentStatement, patch])\n\n  const runCurrent", "  }, [connection.id, currentStatement, patch, t])\n\n  const runCurrent"),
("const copyAs = (format: CopyFormat): void => { if (result) copy(formatRows(format, columns, result.rows, qualified), 'Results') }",
 "const copyAs = (format: CopyFormat): void => { if (result) copy(formatRows(format, columns, result.rows, qualified), t('workbench.copiedResults')) }"),
('<Splitter orientation="vertical" label="Table list width"', "<Splitter orientation=\"vertical\" label={t('workbench.treeWidth')}"),
('<div className="oq-qtabs" role="tablist" aria-label="Queries">', "<div className=\"oq-qtabs\" role=\"tablist\" aria-label={t('workbench.queries')}>"),
("aria-label={`Close ${tab.title}`} onClick={() => closeTab(tab.id)}", "aria-label={t('view.closeTab', { name: tab.title })} onClick={() => closeTab(tab.id)}"),
('<button type="button" className="oq-qtab-add" aria-label="New query" title="New query tab"', "<button type=\"button\" className=\"oq-qtab-add\" data-oq-action=\"newQuery\" aria-label={t('workbench.newQuery')} title={t('workbench.newQueryTitle')}"),
('<span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>', '<span className="oq-badge" data-environment={connection.environment}>{t(`environment.short.${connection.environment}`)}</span>'),
("title={connection.readOnly ? 'The server refuses statements that change data' : 'This connection can change data'}>{connection.readOnly ? 'read-only' : 'read-write'}</span>",
 "title={connection.readOnly ? t('workbench.readOnlyTitle') : t('workbench.readWriteTitle')}>{connection.readOnly ? t('common.readOnly') : t('common.readWrite')}</span>"),
('<div className="oq-tb-group" role="group" aria-label="Run">', "<div className=\"oq-tb-group\" role=\"group\" aria-label={t('common.run')}>"),
('onClick={runCurrent} disabled={running} title="Run the selection, or the statement the cursor is in (Ctrl+Enter)">Run</Button>', "onClick={runCurrent} disabled={running} title={t('workbench.runTitle')}>{t('common.run')}</Button>"),
('<Button size="sm" onClick={runAll} disabled={running} title="Run every statement, one after the other (Ctrl+Shift+Enter)">Run all</Button>', "<Button size=\"sm\" data-oq-action=\"runAll\" onClick={runAll} disabled={running} title={t('workbench.runAllTitle')}>{t('workbench.runAll')}</Button>"),
('onClick={cancel} title="Cancel the running statement">Cancel</Button>', "onClick={cancel} title={t('workbench.cancelTitle')}>{t('common.cancel')}</Button>"),
('<div className="oq-tb-group" role="group" aria-label="Plan and format">', "<div className=\"oq-tb-group\" role=\"group\" aria-label={t('workbench.planAndFormat')}>"),
('disabled={running} title="Show the execution plan without running the statement">Explain</Button>', "disabled={running} title={t('workbench.explainTitle')}>{t('workbench.explain')}</Button>"),
('disabled={running} title="Run the statement and show real timings. A statement that changes data is rolled back.">Analyze</Button>', "disabled={running} title={t('workbench.analyzeTitle')}>{t('workbench.analyze')}</Button>"),
('<Button size="sm" onClick={format} title="Format the SQL (Shift+Alt+F)">Format</Button>', "<Button size=\"sm\" onClick={format} title={t('workbench.formatTitle')}>{t('workbench.format')}</Button>"),
('<label className="oq-inline">Limit<Select', "<label className=\"oq-inline\">{t('workbench.limit')}<Select"),
('<option key={value} value={value}>{formatNumber(value)} rows</option>', "<option key={value} value={value}>{t('common.rows', { count: value, formatted: formatNumber(value) })}</option>"),
('{notice && <p role="alert" className="oq-error oq-notice">{notice}</p>}', '{notice && <div className="oq-notice"><ErrorState compact title={notice} /></div>}'),
('<Splitter orientation="horizontal" label="Query editor height"', "<Splitter orientation=\"horizontal\" label={t('workbench.editorHeight')}"),
("{pending && <ConfirmDialog danger title={pending.explain ? 'Analyze runs this statement' : 'This statement is destructive'}\n        confirmLabel={pending.explain ? 'Analyze anyway' : 'Run anyway'}\n        description={connection.environment === 'prod' ? 'This is a production connection.' : 'Check these before it runs.'}",
 "{pending && <ConfirmDialog danger title={pending.explain ? t('workbench.confirm.analyzeTitle') : t('workbench.confirm.destructiveTitle')}\n        confirmLabel={pending.explain ? t('workbench.confirm.analyzeAnyway') : t('workbench.confirm.runAnyway')} cancelLabel={t('common.cancel')}\n        description={connection.environment === 'prod' ? t('workbench.confirm.production') : t('workbench.confirm.check')}"),
('<div className="oq-output-tabs" role="tablist" aria-label="Results">', "<div className=\"oq-output-tabs\" role=\"tablist\" aria-label={t('workbench.results')}>"),
("<span className=\"oq-muted\">{running ? 'Running…' : result ? summary(result, active.browse) : error ? 'No result' : 'Results appear here.'}</span>",
 "<span className=\"oq-muted\">{running ? t('workbench.running') : result ? summary(result, active.browse) : error ? t('workbench.noResult') : t('workbench.resultsHere')}</span>"),
("{ offset: Math.max(0, active.browse!.offset - PAGE) })}>Previous</button>", "{ offset: Math.max(0, active.browse!.offset - PAGE) })}>{t('common.previous')}</button>"),
("{ offset: active.browse!.offset + PAGE })}>Next</button></>}", "{ offset: active.browse!.offset + PAGE })}>{t('common.next')}</button></>}"),
("onClick={() => void loadMore()}>Load {formatNumber(maxRows)} more</button>}", "onClick={() => void loadMore()}>{t('workbench.loadMore', { count: maxRows, formatted: formatNumber(maxRows) })}</button>}"),
("label={active.browse ? 'Export table' : 'Export query'} />}", "label={active.browse ? t('export.table') : t('export.query')} />}"),
('<Select className="oq-select" aria-label="Copy results as" value=""', "<Select className=\"oq-select\" aria-label={t('workbench.copyAs')} value=\"\""),
('<option value="">Copy as…</option><option value="csv">CSV</option><option value="tsv">TSV (spreadsheet)</option><option value="json">JSON</option><option value="markdown">Markdown table</option><option value="insert">INSERT statements</option></Select>}',
 "<option value=\"\">{t('workbench.copyAsPlaceholder')}</option>{COPY_FORMATS.map(format => <option key={format} value={format}>{t(`workbench.copyFormat.${format}`)}</option>)}</Select>}"),
(": result && !error ? <div className=\"oq-empty\"><p>{result.command ?? 'Done'}{result.affectedRows !== undefined ? ` · ${result.affectedRows} row${result.affectedRows === 1 ? '' : 's'} affected` : ''}</p></div>\n              : !error && <div className=\"oq-empty\"><p>Write a query and press <kbd>Ctrl ↵</kbd> to run the statement you are in, <kbd>Ctrl ⇧ ↵</kbd> to run them all, or pick a table on the left.</p></div>}",
 ": result && !error ? <div className=\"oq-placeholder\"><EmptyState compact title={commandSummary(result)} /></div>\n              : !error && <div className=\"oq-placeholder\"><EmptyState compact title={<Trans t={t} i18nKey=\"workbench.emptyHint\" components={{ kbd: <kbd /> }} />} /></div>}"),
('{row && !cell && <aside className="oq-row-detail" aria-label="Row details">', "{row && !cell && <aside className=\"oq-row-detail\" aria-label={t('workbench.rowDetails')}>"),
('<header><strong>Row {selectedRow! + 1}</strong><button type="button" aria-label="Close row details"', "<header><strong>{t('workbench.row', { number: selectedRow! + 1 })}</strong><button type=\"button\" aria-label={t('workbench.closeRowDetails')}"),
('onDoubleClick={() => copy(displayCell(row[index]))} title="Double-click to copy">', "onDoubleClick={() => copy(displayCell(row[index]))} title={t('workbench.doubleClickCopy')}>"),
("function DefinitionPanel({ connection, schema, name, kind, onOpen }: { connection: OxeQueryConnection; schema: string; name: string; kind?: string; onOpen: (sql: string) => void }): ReactElement {\n",
 "function DefinitionPanel({ connection, schema, name, kind, onOpen }: { connection: OxeQueryConnection; schema: string; name: string; kind?: string; onOpen: (sql: string) => void }): ReactElement {\n  const { t } = useTranslation('oxequery')\n"),
('<section className="oq-columns" aria-label="Definition">', "<section className=\"oq-columns\" aria-label={t('definition.label')}>"),
("<ChevronRight size={13} aria-hidden=\"true\" />}Definition (DDL)</button>", "<ChevronRight size={13} aria-hidden=\"true\" />}{t('definition.title')}</button>"),
("{error ? <p role=\"alert\" className=\"oq-error\">{error}</p> : text === null ? <p className=\"oq-muted\" aria-busy=\"true\">Reading the catalog…</p>",
 "{error ? <ErrorState compact title={t('definition.failed')} message={error} /> : text === null ? <LoadingState label={t('definition.loading')} />"),
('<div className="oq-staged-actions"><button type="button" onClick={() => copy(text)}>Copy</button><button type="button" onClick={() => onOpen(text)}>Open in a new tab</button></div></>}',
 "<div className=\"oq-staged-actions\"><button type=\"button\" onClick={() => copy(text, t('definition.copied'))}>{t('common.copy')}</button><button type=\"button\" onClick={() => onOpen(text)}>{t('definition.openInTab')}</button></div></>}"),
("function ColumnsPanel({ details }: { details: SqlTableDetails }): ReactElement {\n", "function ColumnsPanel({ details }: { details: SqlTableDetails }): ReactElement {\n  const { t } = useTranslation('oxequery')\n"),
('<section className="oq-columns" aria-label="Table structure">', "<section className=\"oq-columns\" aria-label={t('columns.label')}>"),
("<ChevronRight size={13} aria-hidden=\"true\" />}Structure · {details.columns.length} columns · {details.indexes.length} indexes</button>",
 "<ChevronRight size={13} aria-hidden=\"true\" />}{t('columns.title', { columns: t('columns.columns', { count: details.columns.length }), indexes: t('columns.indexes', { count: details.indexes.length }) })}</button>"),
("<table><thead><tr><th>Column</th><th>Type</th><th>Null</th><th>Default</th></tr></thead>", "<table><thead><tr><th>{t('columns.column')}</th><th>{t('columns.type')}</th><th>{SQL_NULL}</th><th>{t('columns.default')}</th></tr></thead>"),
("<td>{column.nullable ? 'yes' : 'no'}</td>", "<td>{column.nullable ? t('common.yes') : t('common.no')}</td>"),
("{index.name}{index.primary ? ' · primary' : index.unique ? ' · unique' : ''}</li>", "{index.name}{index.primary ? ` · ${t('columns.primary')}` : index.unique ? ` · ${t('columns.unique')}` : ''}</li>"),
]

NEW_SUMMARY = '''const COPY_FORMATS: CopyFormat[] = ['csv', 'tsv', 'json', 'markdown', 'insert']

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

'''

def POST(s):
    start = s.index('function summary(result: SqlResult, browse: Browse | null): string {')
    end = s.index('function DefinitionPanel(')
    return s[:start] + NEW_SUMMARY + s[end:]
