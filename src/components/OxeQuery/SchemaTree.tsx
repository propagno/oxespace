import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Pin, PinOff, Plus, RefreshCw, Search, Server } from 'lucide-react'
import type { OxeQueryConnection, SqlDefinitionTarget, SqlExtensionInfo, SqlSearchHit, SqlTable, WorkspaceState } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import type { StructureOutcome } from './StructureEditor'
import { ROW_HEIGHT, buildRows, keyMove, pinKey, rowsFromHits, windowOf, type SchemaData, type TreeItem, type TreeKey, type TreeRow } from './tree-model'
import { toast } from '../../ui/Toast'

// Dialogs are only needed when opened: they load on first use and stay out of the tree's own chunk.
const ServerPanel = lazy(() => import('./ServerPanel').then(module => ({ default: module.ServerPanel })))
const StructureEditor = lazy(() => import('./StructureEditor').then(module => ({ default: module.StructureEditor })))

type Pinned = NonNullable<WorkspaceState['pinned']>

interface Props {
  connection: OxeQueryConnection
  pinned: Pinned
  onPinnedChange: (next: Pinned) => void
  onOpen: (table: SqlTable) => void
  onInsert: (sql: string) => void
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`
const FALLBACK_VIEWPORT = 400
const SEARCH_DELAY_MS = 250
const KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'])

function definitionTarget(item: TreeItem): SqlDefinitionTarget | null {
  switch (item.kind) {
    case 'function': return item.fn.oid > 0 ? { kind: 'function', oid: item.fn.oid } : null
    case 'type': return item.type.oid > 0 ? { kind: 'type', oid: item.type.oid } : null
    case 'trigger': return { kind: 'trigger', oid: item.trigger.oid }
    case 'sequence': return { kind: 'sequence', schema: item.schema, name: item.sequence.name }
    default: return null
  }
}

const describeItem = (item: TreeItem): string => {
  switch (item.kind) {
    case 'relation': return item.table.kind === 'table' ? '' : item.table.kind
    case 'function': return item.fn.kind
    case 'sequence': return item.sequence.lastValue === null ? 'sequence' : `last ${item.sequence.lastValue}`
    case 'type': return item.type.kind
    case 'trigger': return 'trigger'
  }
}

/**
 * The schema tree: every kind of object in its own category, a search across all schemas, pinned
 * tables, and rows that are only rendered while they are on screen (a schema can have thousands).
 * It is a WAI-ARIA tree: arrow keys move, open and close; Enter opens the object.
 */
export function SchemaTree({ connection, pinned, onPinnedChange, onOpen, onInsert }: Props): ReactElement {
  const [schemas, setSchemas] = useState<string[]>([])
  const [data, setData] = useState<Record<string, SchemaData | undefined>>({})
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set())
  const [extensions, setExtensions] = useState<SqlExtensionInfo[] | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(['schema/public', 'schema/public/tables', 'pinned']))
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<{ query: string; hits: SqlSearchHit[]; truncated: boolean } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [focusIndex, setFocusIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT)
  const [structure, setStructure] = useState<{ schema: string; table: string | null } | null>(null)
  const [server, setServer] = useState(false)
  const scroller = useRef<HTMLDivElement | null>(null)
  const generation = useRef(0)

  const loadSchema = useCallback(async (schema: string): Promise<void> => {
    const mine = generation.current
    setLoading(current => new Set(current).add(schema))
    try {
      const [tables, functions, objects] = await Promise.all([
        oq('sql.tables', { connectionId: connection.id, schema }),
        oq('sql.functions', { connectionId: connection.id, schema }),
        oq('sql.objects', { connectionId: connection.id, schema })
      ])
      if (mine === generation.current) setData(current => ({ ...current, [schema]: { tables: tables.tables, total: tables.total, functions, objects } }))
    } catch (cause) { if (mine === generation.current) setError(errorMessage(cause)) } finally {
      setLoading(current => { const next = new Set(current); next.delete(schema); return next })
    }
  }, [connection.id])

  const loadExtensions = useCallback(async (): Promise<void> => {
    try { setExtensions(await oq('sql.extensions', { connectionId: connection.id })) } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id])

  const reload = useCallback((): void => {
    generation.current++
    setError(''); setData({})
    oq('sql.schemas', { connectionId: connection.id }).then(list => {
      setSchemas(list)
      for (const schema of list) if (expanded.has(`schema/${schema}`)) void loadSchema(schema)
    }, cause => setError(errorMessage(cause)))
    if (expanded.has('extensions')) void loadExtensions()
    // `expanded` is read once, at the moment of the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, loadSchema, loadExtensions])

  useEffect(() => { reload() }, [reload])

  // One search across every schema, after a pause in typing.
  useEffect(() => {
    const query = filter.trim()
    if (!query) { setHits(null); return }
    let alive = true
    const timer = window.setTimeout(() => {
      oq('sql.search', { connectionId: connection.id, query }).then(
        result => { if (alive) setHits({ query, hits: result.hits, truncated: result.truncated }) },
        cause => { if (alive) setError(errorMessage(cause)) })
    }, SEARCH_DELAY_MS)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [filter, connection.id])

  const searching = filter.trim() !== ''
  const rows = useMemo<TreeRow[]>(() => searching
    ? (hits ? rowsFromHits(hits.hits) : [])
    : buildRows({ schemas, data, expanded, pinned, extensions: extensions ?? [], loading }),
  [searching, hits, schemas, data, expanded, pinned, extensions, loading])
  const rowCount = rows.length

  useEffect(() => { setFocusIndex(current => Math.min(current, Math.max(0, rowCount - 1))) }, [rowCount])
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = (): void => setViewport(element.clientHeight || FALLBACK_VIEWPORT)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const toggle = useCallback((id: string, schema?: string): void => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else {
        next.add(id)
        if (id.startsWith('schema/') && schema && id === `schema/${schema}`) { if (!data[schema]) void loadSchema(schema); next.add(`schema/${schema}/tables`) }
        if (id === 'extensions' && !extensions) void loadExtensions()
      }
      return next
    })
  }, [data, extensions, loadSchema, loadExtensions])

  const openDefinition = useCallback(async (item: TreeItem): Promise<void> => {
    const target = definitionTarget(item)
    if (!target) return
    try { onInsert((await oq('sql.definition', { connectionId: connection.id, ...target })).text) } catch (cause) { setError(errorMessage(cause)) }
  }, [connection.id, onInsert])

  const activate = useCallback((row: TreeRow): void => {
    if (row.type === 'schema' || row.type === 'category' || row.type === 'extensions' || row.type === 'pinned') { toggle(row.id, row.schema); return }
    if (!row.item) return
    if (row.item.kind === 'relation') onOpen(row.item.table)
    else void openDefinition(row.item)
  }, [onOpen, openDefinition, toggle])

  const isPinned = (table: SqlTable): boolean => pinned.some(pin => pinKey(pin.schema, pin.name) === pinKey(table.schema, table.name))
  const togglePin = (table: SqlTable): void => onPinnedChange(isPinned(table)
    ? pinned.filter(pin => pinKey(pin.schema, pin.name) !== pinKey(table.schema, table.name))
    : [...pinned, { schema: table.schema, name: table.name, kind: table.kind }])

  const refreshView = async (table: SqlTable): Promise<void> => {
    setError(''); setNotice('')
    try {
      await oq('sql.run', { connectionId: connection.id, sql: `REFRESH MATERIALIZED VIEW ${quote(table.schema)}.${quote(table.name)}` })
      toast({ title: `Refreshed ${table.schema}.${table.name}`, intent: 'success', duration: 2000 })
    } catch (cause) { setError(errorMessage(cause)) }
  }

  const focusRow = (index: number): void => {
    setFocusIndex(index)
    const element = scroller.current
    if (!element) return
    const top = index * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight
    requestAnimationFrame(() => element.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true }))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) return
    if (event.key === 'Enter' || event.key === ' ') {
      const row = rows[focusIndex]
      if (row) { event.preventDefault(); activate(row) }
      return
    }
    if (!KEYS.has(event.key)) return
    event.preventDefault()
    const move = keyMove(rows, focusIndex, event.key as TreeKey)
    if (!move) return
    if ('focus' in move) focusRow(move.focus)
    else if ('expand' in move || 'collapse' in move) { const row = rows[focusIndex]; if (row) toggle(row.id, row.schema) }
  }

  const range = windowOf(rowCount, scrollTop, viewport)
  const visible = rows.slice(range.start, range.end)

  const actions = (row: TreeRow): ReactElement | null => {
    if (row.item?.kind !== 'relation') return null
    const table = row.item.table
    const name = table.name
    return <span className="oq-tree-actions">
      <button type="button" tabIndex={-1} aria-label={`Write a query for ${name}`} title="Open a new query for this table" onClick={event => { event.stopPropagation(); onInsert(`SELECT *\nFROM ${quote(table.schema)}.${quote(name)}\nLIMIT 100;`) }}>Query</button>
      {table.kind === 'table' && !connection.readOnly && <button type="button" tabIndex={-1} aria-label={`Structure of ${name}`} title="View or change columns, keys and indexes" onClick={event => { event.stopPropagation(); setStructure({ schema: table.schema, table: name }) }}>Structure</button>}
      {table.kind === 'materialized view' && !connection.readOnly && <button type="button" tabIndex={-1} aria-label={`Refresh ${name}`} title="Refresh the materialized view" onClick={event => { event.stopPropagation(); void refreshView(table) }}><RefreshCw size={12} aria-hidden="true" /></button>}
      <button type="button" tabIndex={-1} aria-label={`${isPinned(table) ? 'Unpin' : 'Pin'} ${name}`} title={isPinned(table) ? 'Unpin' : 'Pin to the top'} onClick={event => { event.stopPropagation(); togglePin(table) }}>
        {isPinned(table) ? <PinOff size={12} aria-hidden="true" /> : <Pin size={12} aria-hidden="true" />}</button>
    </span>
  }

  const renderRow = (row: TreeRow, index: number): ReactElement => {
    const style = { top: index * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: 6 + (row.level - 1) * 14 }
    if (row.type === 'note') return <div key={row.id} className="oq-tree-row oq-muted" role="none" style={style}>{row.label}</div>
    const branch = row.expanded !== undefined
    const name = row.item && row.item.kind !== 'relation' ? `${row.label} (${describeItem(row.item)})` : row.label
    return <div key={row.id} role="treeitem" className="oq-tree-row" data-index={index} data-kind={row.type} style={style} tabIndex={index === focusIndex ? 0 : -1}
      aria-level={row.level} aria-expanded={branch ? row.expanded : undefined} aria-label={name} aria-selected={index === focusIndex}
      onClick={() => { setFocusIndex(index); activate(row) }} onFocus={() => setFocusIndex(index)}
      title={row.item?.kind === 'relation' ? `Browse ${row.item.table.schema}.${row.item.table.name}` : undefined}>
      {branch ? (row.expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />) : <span className="oq-tree-spacer" aria-hidden="true" />}
      <span className="oq-tree-label">{row.label}</span>
      {row.count !== undefined && <small>{row.count}</small>}
      {row.item && describeItem(row.item) && <small>{describeItem(row.item)}</small>}
      {row.type === 'schema' && !connection.readOnly && row.expanded && <button type="button" tabIndex={-1} className="oq-tree-new" aria-label={`New table in ${row.schema}`} title="Create a table" onClick={event => { event.stopPropagation(); setStructure({ schema: row.schema!, table: null }) }}><Plus size={12} aria-hidden="true" /> New table</button>}
      {actions(row)}
    </div>
  }

  return <nav className="oq-tree" aria-label="Schema">
    <div className="oq-tree-head">
      <label className="oq-tree-search"><Search size={12} aria-hidden="true" />
        <input type="search" aria-label="Search objects" placeholder="Search all schemas" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <button type="button" className="oq-icon" aria-label="Refresh schema" title="Refresh" onClick={reload}><RefreshCw size={13} aria-hidden="true" /></button>
      <button type="button" className="oq-icon" aria-label="Server: databases and roles" title="Databases and roles" onClick={() => setServer(true)}><Server size={13} aria-hidden="true" /></button>
    </div>
    {error && <p role="alert" className="oq-error">{error}</p>}
    {notice && <p role="status" className="oq-ok">{notice}</p>}
    {searching && hits && hits.hits.length === 0 && <p className="oq-muted" role="status">Nothing matches “{hits.query}”.</p>}
    {searching && hits?.truncated && <p className="oq-muted" role="note">Showing the first {hits.hits.length}. Type more to narrow it down.</p>}
    <div ref={scroller} className="oq-tree-scroll" role="tree" aria-label="Schema objects" onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div className="oq-tree-inner" style={{ height: rowCount * ROW_HEIGHT }}>
        {visible.map((row, offset) => renderRow(row, range.start + offset))}
      </div>
    </div>
    <Suspense fallback={null}>
    {server && <ServerPanel connection={connection} onClose={() => setServer(false)} />}
    {structure && <StructureEditor connection={connection} schema={structure.schema} table={structure.table} onClose={() => setStructure(null)}
      onChanged={(outcome: StructureOutcome) => { void loadSchema(structure.schema); if (outcome.kind === 'created' || outcome.kind === 'altered') onOpen({ schema: structure.schema, name: outcome.table, kind: 'table' }) }} />}
    </Suspense>
  </nav>
}
