import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Copy, Database, Pencil, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { MongoCollectionInfo, MongoDatabaseInfo, MongoExplainSummary, MongoResult, OxeQueryConnection } from '../../../shared/types/oxequery'
import { describeMongoQuery, parseMongoQuery, stringifyMongoQuery } from '../../../shared/mongoQueryText'
import { OxeQueryClientError, errorMessage, oq } from './client'
import { ExportButton } from './TableEditor'
import { ImportButton } from './ImportDialog'
import { LibraryMenu } from './LibraryMenu'
import { ReconnectBar } from './ReconnectBar'
import { AskAgent } from './AskAgent'
import { QueryError } from './QueryError'
import { looksLikeLostConnection } from './workbench-model'
import { MongoInsights } from './MongoInsights'
import { DocumentTree, ExplainCard } from './MongoPanels'
import { PAGE_SIZES, cloneDocument, documentLabel, jsonProblem, prettyDocument } from './mongo-model'
import { flattenDocuments } from './mongo-view'
import { ResultGrid } from './ResultGrid'
import { Select, TextArea } from '../../ui/Field'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Splitter } from '../../ui/Splitter'
import { MONGO_INPUTS_HEIGHT, RESULTS_MIN_HEIGHT, TREE_WIDTH, useHeight, useOxeQueryLayout } from './oxequery-layout.store'
import { Dialog } from '../../ui/Overlay'
import { copyText } from '../../ui/clipboard'
import { EmptyState } from '../../ui/Display'

// Dialogs are only needed when opened: they load on first use and stay out of the workbench's own chunk.
const BulkPanel = lazy(() => import('./MongoDialogs').then(module => ({ default: module.BulkPanel })))
const CollectionDialog = lazy(() => import('./MongoDialogs').then(module => ({ default: module.CollectionDialog })))

type Mode = 'find' | 'aggregate'
type View = 'documents' | 'tree' | 'table'
type Target = { database: string; collection: string }
type CollectionDialogState = { kind: 'create'; database: string } | { kind: 'rename'; database: string; collection: string } | { kind: 'drop'; database: string; collection: string }

function copy(text: string, what = 'Text'): void {
  void copyText(text, what)
}

/** The toolbar above the query fields, which their height does not include. */
const INPUTS_CHROME = 50

export function MongoWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const layout = useOxeQueryLayout()
  const main = useRef<HTMLDivElement>(null)
  const mainHeight = useHeight(main)
  const [databases, setDatabases] = useState<MongoDatabaseInfo[]>([])
  const [collections, setCollections] = useState<Record<string, MongoCollectionInfo[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<Target | null>(null)
  const [mode, setMode] = useState<Mode>('find')
  const [filter, setFilter] = useState('{}')
  const [projection, setProjection] = useState('')
  const [sort, setSort] = useState('')
  const [pipeline, setPipeline] = useState('[\n  { "$match": {} }\n]')
  const [limit, setLimit] = useState(50)
  const [skip, setSkip] = useState(0)
  const [result, setResult] = useState<MongoResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [view, setView] = useState<View>('documents')
  const [explain, setExplain] = useState<MongoExplainSummary | null>(null)
  const [libraryTick, setLibraryTick] = useState(0)
  const [bulk, setBulk] = useState(false)
  const [dialog, setDialog] = useState<CollectionDialogState | null>(null)
  const [search, setSearch] = useState('')
  const table = view === 'table' && result ? flattenDocuments(result.documents) : null
  // `original` is the document as it was read (null for a new one); it is sent back so a concurrent change is detected.
  const [editing, setEditing] = useState<{ original: string | null; text: string; mode: 'edit' | 'delete' } | null>(null)
  const [writeError, setWriteError] = useState('')
  const [confirm, setConfirm] = useState<string[] | null>(null)
  const [writing, setWriting] = useState(false)

  const problems = useMemo(() => mode === 'find'
    ? { filter: jsonProblem(filter, 'object', true), projection: jsonProblem(projection, 'object', true), sort: jsonProblem(sort, 'object', true), pipeline: null }
    : { filter: null, projection: null, sort: null, pipeline: jsonProblem(pipeline, 'array') }, [mode, filter, projection, sort, pipeline])
  const invalid = Object.values(problems).some(problem => problem !== null)

  const loadDatabases = useCallback(async (): Promise<void> => {
    try { setDatabases(await oq('mongo.databases', { connectionId: connection.id })) } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])
  useEffect(() => { void loadDatabases() }, [loadDatabases])

  const loadCollections = useCallback(async (database: string): Promise<void> => {
    try {
      const list = await oq('mongo.collections', { connectionId: connection.id, database })
      setCollections(value => ({ ...value, [database]: list }))
    } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])

  const toggle = (database: string): void => {
    setOpen(current => {
      const next = new Set(current)
      if (next.has(database)) next.delete(database)
      else { next.add(database); if (!collections[database]) void loadCollections(database) }
      return next
    })
  }

  const run = useCallback(async (nextSkip = 0): Promise<void> => {
    if (!target) return
    setRunning(true); setError(''); setSkip(nextSkip); setExplain(null)
    try {
      setResult(mode === 'find'
        ? await oq('mongo.find', { connectionId: connection.id, ...target, filter, projection, sort, limit, skip: nextSkip })
        : await oq('mongo.aggregate', { connectionId: connection.id, ...target, pipeline, limit, skip: nextSkip }))
      setLibraryTick(value => value + 1)
    } catch (cause) {
      setResult(null)
      setError(cause instanceof OxeQueryClientError && cause.code === 'cancelled' ? 'The query was cancelled.' : errorMessage(cause))
    } finally { setRunning(false) }
  }, [connection.id, filter, limit, mode, pipeline, projection, sort, target])

  const cancel = async (): Promise<void> => {
    try { if (!(await oq('mongo.cancel', { connectionId: connection.id })).cancelled) setError('The server could not stop the query (it may have just finished, or this user cannot stop operations).') } catch (cause) { setError(errorMessage(cause)) }
  }

  const explainQuery = async (): Promise<void> => {
    if (!target) return
    setRunning(true); setError('')
    try {
      setExplain(await oq('mongo.explain', { connectionId: connection.id, ...target, kind: mode, ...(mode === 'find' ? { filter, projection, sort } : { pipeline }), verbosity: 'executionStats' }))
    } catch (cause) { setError(errorMessage(cause)) } finally { setRunning(false) }
  }

  const select = (database: string, collection: string): void => {
    setTarget({ database, collection }); setResult(null); setError(''); setSkip(0); setExplain(null)
  }

  useEffect(() => { if (target) void run(0) }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const queryText = target ? stringifyMongoQuery({ kind: mode, ...target, ...(mode === 'find' ? { filter, projection, sort } : { pipeline }) }) : ''
  const pick = (text: string): void => {
    const query = parseMongoQuery(text)
    if (!query) return
    setMode(query.kind); setFilter(query.filter ?? '{}'); setProjection(query.projection ?? ''); setSort(query.sort ?? ''); setPipeline(query.pipeline ?? '[\n  { "$match": {} }\n]')
    if (target?.database !== query.database || target.collection !== query.collection) select(query.database, query.collection)
  }

  /** Opens the edit or delete form; a document too large to be listed is fetched whole first. */
  const openDocument = async (index: number, listed: string, kind: 'edit' | 'delete' | 'clone'): Promise<void> => {
    setWriteError(''); setConfirm(null)
    if (kind === 'clone') { setEditing({ original: null, text: cloneDocument(listed), mode: 'edit' }); return }
    let original = listed
    const large = result?.oversized?.find(entry => entry.index === index)
    if (large && target) {
      try { original = (await oq('mongo.document', { connectionId: connection.id, database: target.database, collection: target.collection, id: large.id })).text }
      catch (cause) { setError(errorMessage(cause)); return }
    }
    setEditing({ original, text: kind === 'edit' ? prettyDocument(original) : '', mode: kind })
  }

  const write = async (confirmed = false): Promise<void> => {
    if (!target || !editing) return
    setWriting(true); setWriteError('')
    try {
      const op = editing.mode === 'delete' ? 'delete' : editing.original === null ? 'insert' : 'replace'
      await oq('mongo.write', {
        connectionId: connection.id, ...target, op, confirmed,
        ...(op === 'delete' ? {} : { document: editing.text }),
        ...(editing.original !== null ? { expected: editing.original } : {})
      })
      setEditing(null); setConfirm(null)
      void run(skip)
    } catch (cause) {
      if (cause instanceof OxeQueryClientError && cause.code === 'confirm') setConfirm(cause.reasons)
      else setWriteError(cause instanceof OxeQueryClientError && cause.code === 'conflict' ? `${cause.message} Run the query again to see the current document.` : errorMessage(cause))
    } finally { setWriting(false) }
  }

  const needle = search.trim().toLowerCase()
  const more = result?.truncated === true
  // The query fields are as tall as they were dragged, but the results keep their minimum height.
  const inputsMax = Math.max(MONGO_INPUTS_HEIGHT.min, mainHeight - RESULTS_MIN_HEIGHT - INPUTS_CHROME)
  const inputsHeight = mainHeight ? Math.min(layout.mongoInputsHeight, inputsMax) : layout.mongoInputsHeight
  return <div className="oq-workbench" style={{ '--oq-tree-width': `${layout.treeWidth}px` } as CSSProperties}>
    <nav className="oq-tree oq-mtree" aria-label="Databases">
      <div className="oq-tree-head">
        <label className="oq-tree-search"><input type="search" aria-label="Filter collections" placeholder="Filter collections" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button type="button" className="oq-icon" aria-label="Refresh databases" title="Refresh" onClick={() => { setCollections({}); void loadDatabases(); for (const database of open) void loadCollections(database) }}><RefreshCw size={13} aria-hidden="true" /></button>
      </div>
      <div className="oq-mtree-body">
        {databases.map(database => {
          const list = (collections[database.name] ?? []).filter(collection => !needle || collection.name.toLowerCase().includes(needle))
          const expanded = open.has(database.name) || (needle !== '' && list.length > 0)
          return <div key={database.name}>
            <div className="oq-mnode-row">
              <button type="button" className="oq-mnode" aria-expanded={expanded} onClick={() => toggle(database.name)}>
                {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{database.name}</button>
              {!connection.readOnly && <button type="button" className="oq-icon" aria-label={`New collection in ${database.name}`} title="New collection" onClick={() => setDialog({ kind: 'create', database: database.name })}><Plus size={12} aria-hidden="true" /></button>}
            </div>
            {expanded && list.map(collection => <div key={collection.name} className="oq-mleaf">
              <button type="button" aria-pressed={target?.database === database.name && target.collection === collection.name} onClick={() => select(database.name, collection.name)}>{collection.name}<small>{collection.type === 'collection' ? '' : collection.type}</small></button>
              {!connection.readOnly && collection.type === 'collection' && <span className="oq-mleaf-actions">
                <button type="button" aria-label={`Rename ${collection.name}`} title="Rename" onClick={() => setDialog({ kind: 'rename', database: database.name, collection: collection.name })}><Pencil size={11} aria-hidden="true" /></button>
                <button type="button" aria-label={`Drop ${collection.name}`} title="Drop" onClick={() => setDialog({ kind: 'drop', database: database.name, collection: collection.name })}><Trash2 size={11} aria-hidden="true" /></button>
              </span>}
            </div>)}
          </div>
        })}
        {databases.length === 0 && !error && <p className="oq-muted">No databases visible.</p>}
      </div>
    </nav>
    <Splitter orientation="vertical" label="Collection list width" value={layout.treeWidth} min={TREE_WIDTH.min} max={TREE_WIDTH.max} defaultValue={TREE_WIDTH.default} onChange={treeWidth => layout.set({ treeWidth })} />
    <div className="oq-workbench-main" ref={main}>
      {!target ? <div className="oq-empty"><EmptyState icon={<Database size={20} />} title="Pick a collection">Choose one in the list on the left to find, aggregate or edit its documents.</EmptyState>{error && <QueryError error={{ message: error }} />}</div> : <>
        <div className="oq-editor-toolbar">
          <strong>{target.database}.{target.collection}</strong>
          <div role="group" aria-label="Query type" className="oq-segment"><button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>Find</button><button type="button" aria-pressed={mode === 'aggregate'} onClick={() => setMode('aggregate')}>Aggregate</button></div>
          <span className="oq-spacer" />
          <AskAgent hasError={Boolean(error)} hasPlan={false} context={{
            connectionName: connection.name, engine: 'mongodb', environment: connection.environment,
            sql: mode === 'find' ? `db.${target.collection}.find(${filter.trim() || '{}'}${projection.trim() ? `, ${projection.trim()}` : ''})${sort.trim() ? `.sort(${sort.trim()})` : ''}` : `db.${target.collection}.aggregate(${pipeline.trim()})`,
            ...(error ? { errorMessage: error } : {}), tables: [`${target.database}.${target.collection}`]
          }} />
          <LibraryMenu connection={connection} currentSql={queryText} refreshKey={libraryTick} onPick={pick} describe={describeMongoQuery} />
          <span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>
          <span className="oq-badge" data-readonly={connection.readOnly}>{connection.readOnly ? 'read-only' : 'read-write'}</span>
          <label className="oq-inline">Limit <Select className="oq-select" aria-label="Documents per page" value={limit} onChange={event => setLimit(Number(event.target.value))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</Select></label>
          <button type="button" disabled={running || invalid} onClick={() => void explainQuery()}>Explain</button>
          {running ? <button type="button" onClick={() => void cancel()}><Square size={13} aria-hidden="true" />Cancel</button>
            : <button type="button" className="oq-primary" disabled={invalid} onClick={() => void run(0)}><Play size={13} aria-hidden="true" />Run</button>}
        </div>
        <div className="oq-mongo-inputs" style={{ height: inputsHeight }}>
          {mode === 'find' ? <>
            <label>Filter<textarea aria-label="Filter" aria-invalid={problems.filter ? true : undefined} spellCheck={false} value={filter} onChange={event => setFilter(event.target.value)} rows={3} />{problems.filter && <small className="oq-field-error" role="alert">{problems.filter}</small>}</label>
            <label>Projection<textarea aria-label="Projection" aria-invalid={problems.projection ? true : undefined} spellCheck={false} value={projection} onChange={event => setProjection(event.target.value)} rows={3} placeholder='{ "field": 1 }' />{problems.projection && <small className="oq-field-error" role="alert">{problems.projection}</small>}</label>
            <label>Sort<textarea aria-label="Sort" aria-invalid={problems.sort ? true : undefined} spellCheck={false} value={sort} onChange={event => setSort(event.target.value)} rows={3} placeholder='{ "createdAt": -1 }' />{problems.sort && <small className="oq-field-error" role="alert">{problems.sort}</small>}</label>
          </> : <label className="oq-mongo-wide">Pipeline<textarea aria-label="Pipeline" aria-invalid={problems.pipeline ? true : undefined} spellCheck={false} value={pipeline} onChange={event => setPipeline(event.target.value)} rows={7} />{problems.pipeline && <small className="oq-field-error" role="alert">{problems.pipeline}</small>}</label>}
        </div>
        <Splitter orientation="horizontal" label="Query fields height" value={inputsHeight} min={MONGO_INPUTS_HEIGHT.min} max={inputsMax} defaultValue={MONGO_INPUTS_HEIGHT.default} onChange={height => layout.set({ mongoInputsHeight: height })} />
        {error && <QueryError error={{ message: error }}>{looksLikeLostConnection(error) && <ReconnectBar connection={connection} onReconnected={() => void run(0)} />}</QueryError>}
        {explain && <ExplainCard explain={explain} onClose={() => setExplain(null)} />}
        <div className="oq-results">
          <div className="oq-results-bar">
            {result ? <span>{skip > 0 ? `${skip + 1}–${skip + result.documents.length}` : result.documents.length} document{result.documents.length === 1 ? '' : 's'}{result.total !== undefined ? ` of ${result.total}` : ''}{more ? ' (more available)' : ''} · {result.durationMs} ms</span> : <span className="oq-muted">{running ? 'Running…' : 'Results appear here.'}</span>}
            <span className="oq-spacer" />
            <button type="button" disabled={running || skip === 0} onClick={() => void run(Math.max(0, skip - limit))}>Previous</button>
            <button type="button" disabled={running || !more} onClick={() => void run(skip + limit)}>Next</button>
            <div role="group" aria-label="Result view" className="oq-segment">
              {(['documents', 'tree', 'table'] as const).map(name => <button key={name} type="button" role="radio" aria-checked={view === name} data-selected={view === name} onClick={() => setView(name)}>{name === 'documents' ? 'Documents' : name === 'tree' ? 'Tree' : 'Table'}</button>)}
            </div>
            {result && <button type="button" onClick={() => copy(`[${result.documents.join(',\n')}]`, 'Documents')}>Copy JSON</button>}
            <ExportButton connection={connection} label="Export collection" source={{ kind: 'collection', ...target, ...(mode === 'find' && filter.trim() && filter.trim() !== '{}' && !problems.filter ? { filter } : {}) }} />
            <ImportButton connection={connection} target={{ kind: 'collection', ...target }} onImported={() => void run(0)} />
            {!connection.readOnly && <button type="button" onClick={() => { setWriteError(''); setConfirm(null); setEditing({ original: null, text: '{\n  \n}', mode: 'edit' }) }}><Plus size={13} aria-hidden="true" />New document</button>}
            {!connection.readOnly && mode === 'find' && <button type="button" onClick={() => setBulk(true)}>Change many…</button>}
          </div>
          <MongoInsights connection={connection} database={target.database} collection={target.collection} />
          {editing && <Dialog className="oq-scope" size="lg" onClose={() => { if (!writing) { setEditing(null); setConfirm(null); setWriteError('') } }}
            title={editing.mode === 'delete' ? 'Delete this document?' : editing.original === null ? 'New document' : 'Edit document'}
            description={editing.mode === 'delete' ? 'The document is removed from the collection. This cannot be undone.' : 'Extended JSON: types such as ObjectId, dates and Long keep their type when saved.'}
            footer={<>
              <Button disabled={writing} onClick={() => { setEditing(null); setConfirm(null); setWriteError('') }}>Cancel</Button>
              <Button variant={editing.mode === 'delete' ? 'danger' : 'primary'} loading={writing} onClick={() => void write(false)}>
                {editing.mode === 'delete' ? 'Delete' : editing.original === null ? 'Insert' : 'Save'}</Button>
            </>}>
            {editing.mode === 'edit' && <TextArea mono aria-label="Document (EJSON)" spellCheck={false} rows={14} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} />}
            {editing.mode === 'delete' && <pre className="oq-doc-preview">{prettyDocument(editing.original ?? '')}</pre>}
            {writeError && <p role="alert" className="oq-error">{writeError}</p>}
            {confirm && <ConfirmDialog danger title="Confirm this change" confirmLabel="Confirm" busy={writing}
              description={connection.environment === 'prod' ? 'This is a production connection.' : 'Check these before it is written.'}
              onCancel={() => setConfirm(null)} onConfirm={() => void write(true)}>
              <ul>{confirm.map(item => <li key={item}>{item}</li>)}</ul>
            </ConfirmDialog>}
          </Dialog>}
          {table ? <div className="oq-results-body"><ResultGrid columns={table.columns} rows={table.rows} onCopy={copy} /></div>
            : <div className="oq-documents">{result?.documents.map((document, index) => <details key={index} open={index < 3}>
              <summary>{documentLabel(document)}{!connection.readOnly && <span className="oq-doc-actions">
                <button type="button" aria-label="Edit document" onClick={event => { event.preventDefault(); void openDocument(index, document, 'edit') }}><Pencil size={12} aria-hidden="true" /></button>
                <button type="button" aria-label="Clone document" onClick={event => { event.preventDefault(); void openDocument(index, document, 'clone') }}><Copy size={12} aria-hidden="true" /></button>
                <button type="button" aria-label="Delete document" onClick={event => { event.preventDefault(); void openDocument(index, document, 'delete') }}><Trash2 size={12} aria-hidden="true" /></button>
              </span>}</summary>{view === 'tree' ? <DocumentTree text={document} /> : <pre>{prettyDocument(document)}</pre>}</details>)}</div>}
        </div>
      </>}
    </div>
    <Suspense fallback={null}>
    {bulk && target && <BulkPanel connection={connection} database={target.database} collection={target.collection} filter={filter} onClose={() => setBulk(false)} onDone={() => void run(0)} />}
    {dialog && <CollectionDialog connection={connection} mode={dialog} onClose={() => setDialog(null)} onDone={(name?: string) => {
      void loadCollections(dialog.database)
      if (dialog.kind === 'drop' && target?.database === dialog.database && target.collection === dialog.collection) { setTarget(null); setResult(null) }
      if (dialog.kind === 'create' && name) select(dialog.database, name)
      if (dialog.kind === 'rename' && name && target?.collection === dialog.collection) select(dialog.database, name)
    }} />}
    </Suspense>
  </div>
}
