PATH = 'src/components/OxeQuery/MongoWorkbench.tsx'
R = [
("import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'\n",
 "import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'\nimport { useTranslation } from 'react-i18next'\n"),
("import { copyText } from '../../ui/clipboard'\nimport { EmptyState } from '../../ui/Display'\n", "import { EmptyState, ErrorState } from '../../ui/Display'\nimport { copyText, formatMs, tq } from './catalog'\nimport { formatNumber } from '../../utils/formatTime'\n"),
("function copy(text: string, what = 'Text'): void {", "function copy(text: string, what = tq('workbench.copiedText')): void {"),
("export function MongoWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {\n", "export function MongoWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {\n  const { t } = useTranslation('oxequery')\n"),
("cause.code === 'cancelled' ? 'The query was cancelled.' : errorMessage(cause))", "cause.code === 'cancelled' ? t('mongo.cancelled') : errorMessage(cause))"),
("  }, [connection.id, filter, limit, mode, pipeline, projection, sort, target])", "  }, [connection.id, filter, limit, mode, pipeline, projection, sort, target, t])"),
("setError('The server could not stop the query (it may have just finished, or this user cannot stop operations).')", "setError(t('mongo.cancelFailed'))"),
("`${cause.message} Run the query again to see the current document.`", "`${cause.message} ${t('mongo.conflict')}`"),
('<nav className="oq-tree oq-mtree" aria-label="Databases">', "<nav className=\"oq-tree oq-mtree\" aria-label={t('server.databases')}>"),
('<input type="search" aria-label="Filter collections" placeholder="Filter collections"', "<input type=\"search\" data-oq-action=\"searchObjects\" aria-label={t('mongo.filterCollections')} placeholder={t('mongo.filterCollections')}"),
('aria-label="Refresh databases" title="Refresh"', "aria-label={t('mongo.refresh')} title={t('common.refresh')}"),
("aria-label={`New collection in ${database.name}`} title=\"New collection\"", "aria-label={t('mongo.newCollectionIn', { database: database.name })} title={t('mongo.newCollection')}"),
("aria-label={`Rename ${collection.name}`} title=\"Rename\"", "aria-label={t('mongo.renameNamed', { name: collection.name })} title={t('common.rename')}"),
("aria-label={`Drop ${collection.name}`} title=\"Drop\"", "aria-label={t('mongo.dropNamed', { name: collection.name })} title={t('mongo.drop')}"),
("{databases.length === 0 && !error && <p className=\"oq-muted\">No databases visible.</p>}", "{databases.length === 0 && !error && <EmptyState compact title={t('mongo.noDatabases')} />}"),
('<Splitter orientation="vertical" label="Collection list width"', "<Splitter orientation=\"vertical\" label={t('mongo.treeWidth')}"),
("{!target ? <div className=\"oq-empty\"><EmptyState icon={<Database size={20} />} title=\"Pick a collection\">Choose one in the list on the left to find, aggregate or edit its documents.</EmptyState>{error && <QueryError error={{ message: error }} />}</div> : <>",
 "{!target ? <div className=\"oq-placeholder\"><EmptyState icon={<Database size={20} />} title={t('mongo.pickTitle')}>{t('mongo.pickText')}</EmptyState>{error && <QueryError error={{ message: error }} />}</div> : <>"),
("<div role=\"group\" aria-label=\"Query type\" className=\"oq-segment\"><button type=\"button\" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>Find</button><button type=\"button\" aria-pressed={mode === 'aggregate'} onClick={() => setMode('aggregate')}>Aggregate</button></div>",
 "<div role=\"group\" aria-label={t('mongo.queryType')} className=\"oq-segment\"><button type=\"button\" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>{t('mongo.find')}</button><button type=\"button\" aria-pressed={mode === 'aggregate'} onClick={() => setMode('aggregate')}>{t('mongo.aggregate')}</button></div>"),
("<span className=\"oq-badge\" data-environment={connection.environment}>{connection.environment}</span>\n          <span className=\"oq-badge\" data-readonly={connection.readOnly}>{connection.readOnly ? 'read-only' : 'read-write'}</span>",
 "<span className=\"oq-badge\" data-environment={connection.environment}>{t(`environment.short.${connection.environment}`)}</span>\n          <span className=\"oq-badge\" data-readonly={connection.readOnly} title={connection.readOnly ? t('workbench.readOnlyTitle') : t('workbench.readWriteTitle')}>{connection.readOnly ? t('common.readOnly') : t('common.readWrite')}</span>"),
("<label className=\"oq-inline\">Limit <Select className=\"oq-select\" aria-label=\"Documents per page\"", "<label className=\"oq-inline\">{t('workbench.limit')} <Select className=\"oq-select\" aria-label={t('mongo.perPage')}"),
("onClick={() => void explainQuery()}>Explain</button>", "title={t('mongo.explainTitle')} onClick={() => void explainQuery()}>{t('workbench.explain')}</button>"),
("<Square size={13} aria-hidden=\"true\" />Cancel</button>", "<Square size={13} aria-hidden=\"true\" />{t('common.cancel')}</button>"),
("<Play size={13} aria-hidden=\"true\" />Run</button>}", "<Play size={13} aria-hidden=\"true\" />{t('common.run')}</button>}"),
("<label>Filter<textarea aria-label=\"Filter\"", "<label>{t('mongo.filter')}<textarea aria-label={t('mongo.filter')}"),
("<label>Projection<textarea aria-label=\"Projection\"", "<label>{t('mongo.projection')}<textarea aria-label={t('mongo.projection')}"),
("<label>Sort<textarea aria-label=\"Sort\"", "<label>{t('mongo.sort')}<textarea aria-label={t('mongo.sort')}"),
("<label className=\"oq-mongo-wide\">Pipeline<textarea aria-label=\"Pipeline\"", "<label className=\"oq-mongo-wide\">{t('mongo.pipeline')}<textarea aria-label={t('mongo.pipeline')}"),
('<Splitter orientation="horizontal" label="Query fields height"', "<Splitter orientation=\"horizontal\" label={t('mongo.inputsHeight')}"),
("{result ? <span>{skip > 0 ? `${skip + 1}–${skip + result.documents.length}` : result.documents.length} document{result.documents.length === 1 ? '' : 's'}{result.total !== undefined ? ` of ${result.total}` : ''}{more ? ' (more available)' : ''} · {result.durationMs} ms</span> : <span className=\"oq-muted\">{running ? 'Running…' : 'Results appear here.'}</span>}",
 "{result ? <span>{documentsSummary(result, skip, more)}</span> : <span className=\"oq-muted\">{running ? t('workbench.running') : t('workbench.resultsHere')}</span>}"),
("onClick={() => void run(Math.max(0, skip - limit))}>Previous</button>", "onClick={() => void run(Math.max(0, skip - limit))}>{t('common.previous')}</button>"),
("onClick={() => void run(skip + limit)}>Next</button>", "onClick={() => void run(skip + limit)}>{t('common.next')}</button>"),
("<div role=\"group\" aria-label=\"Result view\" className=\"oq-segment\">", "<div role=\"radiogroup\" aria-label={t('mongo.resultView')} className=\"oq-segment\">"),
("onClick={() => setView(name)}>{name === 'documents' ? 'Documents' : name === 'tree' ? 'Tree' : 'Table'}</button>)}", "onClick={() => setView(name)}>{t(`mongo.view.${name}`)}</button>)}"),
("{result && <button type=\"button\" onClick={() => copy(`[${result.documents.join(',\\n')}]`, 'Documents')}>Copy JSON</button>}", "{result && <button type=\"button\" onClick={() => copy(`[${result.documents.join(',\\n')}]`, t('mongo.copiedDocuments'))}>{t('mongo.copyJson')}</button>}"),
("<ExportButton connection={connection} label=\"Export collection\"", "<ExportButton connection={connection} label={t('export.collection')}"),
("<Plus size={13} aria-hidden=\"true\" />New document</button>}", "<Plus size={13} aria-hidden=\"true\" />{t('mongo.newDocument')}</button>}"),
("onClick={() => setBulk(true)}>Change many…</button>}", "onClick={() => setBulk(true)}>{t('mongo.changeMany')}</button>}"),
("{editing && <Dialog className=\"oq-scope\" size=\"lg\" onClose=", "{editing && <Dialog className=\"oq-scope\" size=\"lg\" closeLabel={t('common.close')} onClose="),
("title={editing.mode === 'delete' ? 'Delete this document?' : editing.original === null ? 'New document' : 'Edit document'}\n            description={editing.mode === 'delete' ? 'The document is removed from the collection. This cannot be undone.' : 'Extended JSON: types such as ObjectId, dates and Long keep their type when saved.'}",
 "title={editing.mode === 'delete' ? t('mongo.deleteTitle') : editing.original === null ? t('mongo.newDocument') : t('mongo.editDocument')}\n            description={editing.mode === 'delete' ? t('mongo.deleteDescription') : t('mongo.ejsonDescription')}"),
("setEditing(null); setConfirm(null); setWriteError('') }}>Cancel</Button>", "setEditing(null); setConfirm(null); setWriteError('') }}>{t('common.cancel')}</Button>"),
("{editing.mode === 'delete' ? 'Delete' : editing.original === null ? 'Insert' : 'Save'}</Button>", "{editing.mode === 'delete' ? t('common.delete') : editing.original === null ? t('mongo.insert') : t('common.save')}</Button>"),
("aria-label=\"Document (EJSON)\"", "aria-label={t('mongo.documentEjson')}"),
("{writeError && <p role=\"alert\" className=\"oq-error\">{writeError}</p>}", "{writeError && <ErrorState compact title={t('mongo.writeFailed')} message={writeError} />}"),
("{confirm && <ConfirmDialog danger title=\"Confirm this change\" confirmLabel=\"Confirm\" busy={writing}\n              description={connection.environment === 'prod' ? 'This is a production connection.' : 'Check these before it is written.'}",
 "{confirm && <ConfirmDialog danger title={t('mongo.confirmTitle')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} busy={writing}\n              description={connection.environment === 'prod' ? t('workbench.confirm.production') : t('mongo.confirmCheck')}"),
("aria-label=\"Edit document\"", "aria-label={t('mongo.editDocument')}"),
("aria-label=\"Clone document\"", "aria-label={t('mongo.cloneDocument')}"),
("aria-label=\"Delete document\"", "aria-label={t('mongo.deleteDocument')}"),
]

SUMMARY = '''
/** "1–50 documents of 120 (more available) · 4 ms" in the language on screen. */
function documentsSummary(result: MongoResult, skip: number, more: boolean): string {
  const shown = result.documents.length
  const count = skip > 0 ? tq('mongo.range', { from: formatNumber(skip + 1), to: formatNumber(skip + shown), count: shown }) : tq('mongo.documents', { count: shown, formatted: formatNumber(shown) })
  const total = result.total !== undefined ? ` ${tq('mongo.ofTotal', { total: formatNumber(result.total) })}` : ''
  return `${count}${total}${more ? ` ${tq('mongo.more')}` : ''} · ${formatMs(result.durationMs)}`
}
'''

def POST(s):
    return s.rstrip('\n') + '\n' + SUMMARY
