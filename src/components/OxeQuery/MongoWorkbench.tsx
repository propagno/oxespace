import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { MongoCollectionInfo, MongoDatabaseInfo, MongoResult, OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { flattenDocuments } from './mongo-view'
import { ResultGrid } from './ResultGrid'

const PAGE = 50
type Mode = 'find' | 'aggregate'

function copy(text: string): void {
  void window.oxe?.clipboard?.writeText(text).catch(() => undefined)
}

function pretty(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

export function MongoWorkbench({ connection }: { connection: OxeQueryConnection }): ReactElement {
  const [databases, setDatabases] = useState<MongoDatabaseInfo[]>([])
  const [collections, setCollections] = useState<Record<string, MongoCollectionInfo[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<{ database: string; collection: string } | null>(null)
  const [mode, setMode] = useState<Mode>('find')
  const [filter, setFilter] = useState('{}')
  const [projection, setProjection] = useState('')
  const [sort, setSort] = useState('')
  const [pipeline, setPipeline] = useState('[\n  { "$match": {} }\n]')
  const [skip, setSkip] = useState(0)
  const [result, setResult] = useState<MongoResult | null>(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [indexes, setIndexes] = useState('')
  const [view, setView] = useState<'documents' | 'table'>('documents')
  const table = view === 'table' && result ? flattenDocuments(result.documents) : null

  useEffect(() => {
    let active = true
    oq('mongo.databases', { connectionId: connection.id }).then(list => { if (active) setDatabases(list) }, cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [connection.id])

  const toggle = (database: string): void => {
    setOpen(current => {
      const next = new Set(current)
      if (next.has(database)) next.delete(database)
      else {
        next.add(database)
        if (!collections[database]) oq('mongo.collections', { connectionId: connection.id, database }).then(list => setCollections(value => ({ ...value, [database]: list })), cause => setError(errorMessage(cause)))
      }
      return next
    })
  }

  const run = useCallback(async (nextSkip = 0): Promise<void> => {
    if (!target) return
    setRunning(true); setError(''); setSkip(nextSkip)
    try {
      setResult(mode === 'find'
        ? await oq('mongo.find', { connectionId: connection.id, ...target, filter, projection, sort, limit: PAGE, skip: nextSkip })
        : await oq('mongo.aggregate', { connectionId: connection.id, ...target, pipeline, limit: PAGE }))
    } catch (cause) { setResult(null); setError(errorMessage(cause)) } finally { setRunning(false) }
  }, [connection.id, filter, mode, pipeline, projection, sort, target])

  const select = (database: string, collection: string): void => {
    setTarget({ database, collection }); setResult(null); setError(''); setSkip(0); setIndexes('')
    oq('mongo.indexes', { connectionId: connection.id, database, collection }).then(list => setIndexes(list.map(index => `${index.name}${index.unique ? ' (unique)' : ''}: ${index.keys}`).join('\n')), () => undefined)
  }

  useEffect(() => { if (target) void run(0) }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="oq-workbench">
    <nav className="oq-tree" aria-label="Databases">
      {databases.map(database => <div key={database.name}>
        <button type="button" className="oq-tree-node" aria-expanded={open.has(database.name)} onClick={() => toggle(database.name)}>
          {open.has(database.name) ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}{database.name}</button>
        {open.has(database.name) && (collections[database.name] ?? []).map(collection => <div key={collection.name} className="oq-tree-leaf">
          <button type="button" aria-pressed={target?.database === database.name && target.collection === collection.name} onClick={() => select(database.name, collection.name)}>{collection.name}<small>{collection.type === 'collection' ? '' : collection.type}</small></button>
        </div>)}
      </div>)}
      {databases.length === 0 && !error && <p className="oq-muted">No databases visible.</p>}
    </nav>
    <div className="oq-workbench-main">
      {!target ? <div className="oq-empty"><p>Select a collection.</p>{error && <p role="alert" className="oq-error">{error}</p>}</div> : <>
        <div className="oq-editor-toolbar">
          <strong>{target.database}.{target.collection}</strong>
          <div role="group" aria-label="Query type"><button type="button" aria-pressed={mode === 'find'} onClick={() => setMode('find')}>Find</button><button type="button" aria-pressed={mode === 'aggregate'} onClick={() => setMode('aggregate')}>Aggregate</button></div>
          <span className="oq-spacer" />
          <span className="oq-badge" data-environment={connection.environment}>{connection.environment}</span>
          <span className="oq-badge" data-readonly={connection.readOnly}>{connection.readOnly ? 'read-only' : 'read-write'}</span>
          <button type="button" className="oq-primary" disabled={running} onClick={() => void run(0)}><Play size={13} aria-hidden="true" />Run</button>
        </div>
        <div className="oq-mongo-inputs">
          {mode === 'find' ? <>
            <label>Filter<textarea aria-label="Filter" spellCheck={false} value={filter} onChange={event => setFilter(event.target.value)} rows={3} /></label>
            <label>Projection<textarea aria-label="Projection" spellCheck={false} value={projection} onChange={event => setProjection(event.target.value)} rows={2} placeholder='{ "field": 1 }' /></label>
            <label>Sort<textarea aria-label="Sort" spellCheck={false} value={sort} onChange={event => setSort(event.target.value)} rows={2} placeholder='{ "createdAt": -1 }' /></label>
          </> : <label className="oq-mongo-wide">Pipeline<textarea aria-label="Pipeline" spellCheck={false} value={pipeline} onChange={event => setPipeline(event.target.value)} rows={7} /></label>}
        </div>
        {error && <p role="alert" className="oq-error">{error}</p>}
        <div className="oq-results">
          <div className="oq-results-bar">
            {result ? <span>{result.documents.length} document{result.documents.length === 1 ? '' : 's'}{result.total !== undefined ? ` of ${result.total}` : ''}{result.truncated ? ' (more available)' : ''} · {result.durationMs} ms</span> : <span className="oq-muted">{running ? 'Running…' : 'Results appear here.'}</span>}
            <span className="oq-spacer" />
            {mode === 'find' && <><button type="button" disabled={running || skip === 0} onClick={() => void run(Math.max(0, skip - PAGE))}>Previous</button>
              <button type="button" disabled={running || !result?.truncated} onClick={() => void run(skip + PAGE)}>Next</button></>}
            <div role="group" aria-label="Result view" className="oq-segment"><button type="button" role="radio" aria-checked={view === 'documents'} data-selected={view === 'documents'} onClick={() => setView('documents')}>Documents</button>
              <button type="button" role="radio" aria-checked={view === 'table'} data-selected={view === 'table'} onClick={() => setView('table')}>Table</button></div>
            {result && <button type="button" onClick={() => copy(`[${result.documents.join(',\n')}]`)}>Copy JSON</button>}
          </div>
          {indexes && <details className="oq-columns"><summary>Indexes</summary><pre>{indexes}</pre></details>}
          {table ? <div className="oq-results-body"><ResultGrid columns={table.columns} rows={table.rows} onCopy={copy} /></div>
            : <div className="oq-documents">{result?.documents.map((document, index) => <details key={index} open={index < 3}>
              <summary>{summaryOf(document)}</summary><pre>{pretty(document)}</pre></details>)}</div>}
        </div>
      </>}
    </div>
  </div>
}

function summaryOf(document: string): string {
  try {
    const value = JSON.parse(document) as Record<string, unknown>
    const id = value._id
    const label = id && typeof id === 'object' ? String((id as Record<string, unknown>).$oid ?? JSON.stringify(id)) : String(id ?? '')
    return label ? `_id: ${label}` : document.slice(0, 80)
  } catch { return document.slice(0, 80) }
}
