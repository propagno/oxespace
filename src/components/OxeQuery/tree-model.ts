import type { SqlExtensionInfo, SqlFunctionInfo, SqlObjects, SqlSearchHit, SqlSequenceInfo, SqlTable, SqlTriggerInfo, SqlTypeInfo, WorkspaceState } from '../../../shared/types/oxequery'
import { tq } from './catalog'

export type Category = 'tables' | 'views' | 'matviews' | 'foreign' | 'functions' | 'sequences' | 'types' | 'triggers'

/** What a category is called in the tree, in the language on screen. */
export const categoryLabel = (category: Category): string => tq(`tree.category.${category}`)
const CATEGORY_ORDER: Category[] = ['tables', 'views', 'matviews', 'foreign', 'functions', 'sequences', 'types', 'triggers']

export interface SchemaData {
  tables: SqlTable[]
  /** How many relations the schema has, which can be more than were listed. */
  total: number
  functions: SqlFunctionInfo[]
  objects: SqlObjects
}

export type TreeItem =
  | { kind: 'relation'; table: SqlTable }
  | { kind: 'function'; fn: SqlFunctionInfo; schema: string }
  | { kind: 'sequence'; sequence: SqlSequenceInfo; schema: string }
  | { kind: 'type'; type: SqlTypeInfo; schema: string }
  | { kind: 'trigger'; trigger: SqlTriggerInfo; schema: string }

export interface TreeRow {
  id: string
  /** 1 for the top level, as `aria-level` wants. */
  level: number
  type: 'schema' | 'category' | 'item' | 'note' | 'extensions' | 'extension' | 'pinned'
  label: string
  expanded?: boolean
  count?: number
  schema?: string
  category?: Category
  item?: TreeItem
  extension?: SqlExtensionInfo
}

export const categoryOfTable = (table: SqlTable): Category =>
  table.kind === 'view' ? 'views' : table.kind === 'materialized view' ? 'matviews' : table.kind === 'foreign table' ? 'foreign' : 'tables'

export const pinKey = (schema: string, name: string): string => `${schema}\u0000${name}`

function itemsOf(schema: string, data: SchemaData, category: Category): TreeRow[] {
  const row = (id: string, label: string, item: TreeItem): TreeRow => ({ id: `${schema}/${category}/${id}`, level: 3, type: 'item', label, schema, category, item })
  switch (category) {
    case 'functions': return data.functions.map(fn => row(`${fn.oid}`, `${fn.name}(${fn.args})`, { kind: 'function', fn, schema }))
    case 'sequences': return data.objects.sequences.map(sequence => row(sequence.name, sequence.name, { kind: 'sequence', sequence, schema }))
    case 'types': return data.objects.types.map(type => row(`${type.oid}`, type.name, { kind: 'type', type, schema }))
    case 'triggers': return data.objects.triggers.map(trigger => row(`${trigger.oid}`, tq('tree.triggerOn', { name: trigger.name, table: trigger.table }), { kind: 'trigger', trigger, schema }))
    default: return data.tables.filter(table => categoryOfTable(table) === category).map(table => row(table.name, table.name, { kind: 'relation', table }))
  }
}

/** What each category of a schema holds, in the order shown; empty categories (other than Tables) are left out. */
export function categoriesOf(schema: string, data: SchemaData): Array<{ category: Category; items: TreeRow[] }> {
  return CATEGORY_ORDER.map(category => ({ category, items: itemsOf(schema, data, category) })).filter(entry => entry.category === 'tables' || entry.items.length > 0)
}

export interface BuildInput {
  schemas: string[]
  data: Record<string, SchemaData | undefined>
  expanded: ReadonlySet<string>
  pinned: NonNullable<WorkspaceState['pinned']>
  extensions: SqlExtensionInfo[] | null
  /** The relation list of a schema is truncated: say so after Tables. */
  loading?: ReadonlySet<string>
}

/** The visible rows of the tree, flattened so a long list can be windowed and walked with the arrow keys. */
export function buildRows({ schemas, data, expanded, pinned, extensions, loading }: BuildInput): TreeRow[] {
  const rows: TreeRow[] = []
  if (pinned.length > 0) {
    const open = expanded.has('pinned')
    rows.push({ id: 'pinned', level: 1, type: 'pinned', label: tq('tree.pinned'), expanded: open, count: pinned.length })
    if (open) for (const pin of pinned) {
      const table: SqlTable = { schema: pin.schema, name: pin.name, kind: pin.kind }
      rows.push({ id: `pinned/${pinKey(pin.schema, pin.name)}`, level: 2, type: 'item', label: [pin.schema, pin.name].join('.'), schema: pin.schema, category: categoryOfTable(table), item: { kind: 'relation', table } })
    }
  }
  for (const schema of schemas) {
    const open = expanded.has(`schema/${schema}`)
    rows.push({ id: `schema/${schema}`, level: 1, type: 'schema', label: schema, expanded: open, schema })
    if (!open) continue
    const loaded = data[schema]
    if (!loaded) { rows.push({ id: `schema/${schema}/loading`, level: 2, type: 'note', label: loading?.has(schema) ? tq('common.loading') : tq('tree.nothingLoaded'), schema }); continue }
    for (const { category, items } of categoriesOf(schema, loaded)) {
      const id = `schema/${schema}/${category}`
      const categoryOpen = expanded.has(id)
      rows.push({ id, level: 2, type: 'category', label: categoryLabel(category), expanded: categoryOpen, count: items.length, schema, category })
      if (!categoryOpen) continue
      rows.push(...items)
      if (category === 'tables' && loaded.total > loaded.tables.length) {
        rows.push({ id: `${id}/more`, level: 3, type: 'note', label: tq('tree.partial', { shown: loaded.tables.length, count: loaded.total }), schema, category })
      }
    }
  }
  if (extensions) {
    const open = expanded.has('extensions')
    rows.push({ id: 'extensions', level: 1, type: 'extensions', label: tq('tree.extensions'), expanded: open, count: extensions.length })
    if (open) for (const extension of extensions) rows.push({ id: `extensions/${extension.name}`, level: 2, type: 'extension', label: [extension.name, extension.version].join(' '), extension })
  }
  return rows
}

/** Search results as rows, grouped by nothing: a flat list ordered by the server (exact name first). */
export function rowsFromHits(hits: SqlSearchHit[]): TreeRow[] {
  return hits.map((hit, index): TreeRow => {
    const label = hit.args !== undefined ? `${hit.name}(${hit.args})` : hit.name
    const base = { id: `hit/${index}`, level: 1, type: 'item' as const, label, schema: hit.schema }
    if (hit.kind === 'function' || hit.kind === 'procedure') return { ...base, item: { kind: 'function', schema: hit.schema, fn: { oid: hit.oid ?? 0, name: hit.name, args: hit.args ?? '', kind: hit.kind } } }
    if (hit.kind === 'sequence') return { ...base, item: { kind: 'sequence', schema: hit.schema, sequence: { name: hit.name, dataType: '', lastValue: null } } }
    if (hit.kind === 'type') return { ...base, item: { kind: 'type', schema: hit.schema, type: { oid: hit.oid ?? 0, name: hit.name, kind: 'enum' } } }
    return { ...base, item: { kind: 'relation', table: { schema: hit.schema, name: hit.name, kind: hit.kind } } }
  })
}

export type TreeKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End'

export type TreeMove = { focus: number } | { expand: string } | { collapse: string } | null

/** What a key does in a tree: move focus, open a branch, close one, or go to the parent. */
export function keyMove(rows: TreeRow[], index: number, key: TreeKey): TreeMove {
  const row = rows[index]
  if (!row) return null
  switch (key) {
    case 'ArrowDown': return index < rows.length - 1 ? { focus: index + 1 } : null
    case 'ArrowUp': return index > 0 ? { focus: index - 1 } : null
    case 'Home': return { focus: 0 }
    case 'End': return { focus: rows.length - 1 }
    case 'ArrowRight':
      if (row.expanded === false) return { expand: row.id }
      return row.expanded === true && rows[index + 1] && rows[index + 1]!.level > row.level ? { focus: index + 1 } : null
    case 'ArrowLeft': {
      if (row.expanded === true) return { collapse: row.id }
      for (let at = index - 1; at >= 0; at--) if (rows[at]!.level < row.level) return { focus: at }
      return null
    }
  }
}

export const ROW_HEIGHT = 26

/** The rows to render for a scroll position: the visible ones plus a margin so a fast scroll does not show blanks. */
export function windowOf(total: number, scrollTop: number, viewport: number, overscan = 6): { start: number; end: number } {
  const first = Math.floor(scrollTop / ROW_HEIGHT)
  const visible = Math.ceil(viewport / ROW_HEIGHT)
  return { start: Math.max(0, first - overscan), end: Math.min(total, first + visible + overscan) }
}
