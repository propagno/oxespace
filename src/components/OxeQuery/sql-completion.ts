import type { OnMount } from '@monaco-editor/react'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { oq } from './client'

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT',
  'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS', 'DISTINCT', 'UNION', 'UNION ALL', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT(*)',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'RETURNING', 'EXPLAIN', 'ASC', 'DESC', 'NULLS FIRST', 'NULLS LAST', 'CAST', 'COALESCE'
]

export interface SqlContext {
  /** The text before the cursor was `qualifier.` — suggest that relation's columns. */
  qualifier?: string
  /** Text typed after the qualifier (or the word being typed). */
  prefix: string
}

/** What the cursor is completing: `alias.col|` or a bare word. */
export function analyzeContext(textBeforeCursor: string): SqlContext {
  const qualified = /(?:"([^"]+)"|([A-Za-z_][\w$]*))\.(?:"?([\w$]*))$/.exec(textBeforeCursor)
  if (qualified) return { qualifier: qualified[1] ?? qualified[2], prefix: qualified[3] ?? '' }
  const word = /([A-Za-z_][\w$]*)$/.exec(textBeforeCursor)
  return { prefix: word?.[1] ?? '' }
}

const RESERVED_AFTER_TABLE = new Set(['WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION', 'SET', 'USING', 'RETURNING', 'AS', 'NATURAL', 'WINDOW'])

/** alias (or bare table name) → `schema.table` for every FROM/JOIN/UPDATE/INTO in the text. */
export function collectAliases(sql: string, defaultSchema = 'public'): Map<string, { schema: string; table: string }> {
  const map = new Map<string, { schema: string; table: string }>()
  const pattern = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))(?:\.(?:"([^"]+)"|([A-Za-z_][\w$]*)))?(?:\s+(?:AS\s+)?(?:"([^"]+)"|([A-Za-z_][\w$]*)))?/gi
  for (const match of sql.matchAll(pattern)) {
    const hasSchema = match[3] !== undefined || match[4] !== undefined
    const schema = hasSchema ? (match[1] ?? match[2]) : defaultSchema
    const table = hasSchema ? (match[3] ?? match[4]) : (match[1] ?? match[2])
    const alias = match[5] ?? match[6]
    const entry = { schema, table }
    map.set(table.toLowerCase(), entry)
    if (alias && !RESERVED_AFTER_TABLE.has(alias.toUpperCase())) map.set(alias.toLowerCase(), entry)
  }
  return map
}

/** Per-connection cache of what the editor can suggest; loaded lazily and never blocks typing. */
export class SchemaCache {
  private schemas: string[] | null = null
  private readonly tables = new Map<string, { name: string; kind: string }[]>()
  private readonly columns = new Map<string, { name: string; type: string }[]>()
  private readonly inflight = new Map<string, Promise<void>>()
  constructor(private readonly connectionId: string) {}

  private once(key: string, load: () => Promise<void>): void {
    if (this.inflight.has(key)) return
    this.inflight.set(key, load().catch(() => undefined))
  }

  schemaNames(): string[] {
    if (!this.schemas) this.once('schemas', async () => { this.schemas = await oq('sql.schemas', { connectionId: this.connectionId }) })
    return this.schemas ?? []
  }
  tablesOf(schema: string): { name: string; kind: string }[] {
    if (!this.tables.has(schema)) this.once(`t:${schema}`, async () => {
      const list = await oq('sql.tables', { connectionId: this.connectionId, schema })
      this.tables.set(schema, list.map(table => ({ name: table.name, kind: table.kind })))
    })
    return this.tables.get(schema) ?? []
  }
  columnsOf(schema: string, table: string): { name: string; type: string }[] {
    const key = `${schema}.${table}`
    if (!this.columns.has(key)) this.once(`c:${key}`, async () => {
      const details = await oq('sql.table', { connectionId: this.connectionId, schema, table })
      this.columns.set(key, details.columns.map(column => ({ name: column.name, type: column.type })))
    })
    return this.columns.get(key) ?? []
  }
  /** Fills the cache without asking the server (tests, and warm starts). */
  seed(data: { schemas: string[]; tables: Record<string, { name: string; kind: string }[]>; columns: Record<string, { name: string; type: string }[]> }): void {
    this.schemas = data.schemas
    for (const [schema, list] of Object.entries(data.tables)) { this.tables.set(schema, list); this.inflight.set(`t:${schema}`, Promise.resolve()) }
    for (const [key, list] of Object.entries(data.columns)) { this.columns.set(key, list); this.inflight.set(`c:${key}`, Promise.resolve()) }
    this.inflight.set('schemas', Promise.resolve())
  }
  /** Forget everything, e.g. after DDL or a refresh. */
  clear(): void { this.schemas = null; this.tables.clear(); this.columns.clear(); this.inflight.clear() }
}

const caches = new Map<string, SchemaCache>()
export function cacheFor(connection: OxeQueryConnection): SchemaCache {
  let cache = caches.get(connection.id)
  if (!cache) { cache = new SchemaCache(connection.id); caches.set(connection.id, cache) }
  return cache
}

export interface Suggestion { label: string; kind: 'keyword' | 'table' | 'column' | 'schema'; detail?: string; insert: string }

const quote = (name: string): string => /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`

/** The suggestions for a cursor position. Pure given a populated cache, so it can be tested without Monaco. */
export function suggest(cache: SchemaCache, fullText: string, textBeforeCursor: string): Suggestion[] {
  const context = analyzeContext(textBeforeCursor)
  const needle = context.prefix.toLowerCase()
  const matches = (label: string): boolean => !needle || label.toLowerCase().startsWith(needle)
  if (context.qualifier) {
    const qualifier = context.qualifier.toLowerCase()
    const aliases = collectAliases(fullText)
    const found = aliases.get(qualifier)
    // `FROM audit.` names a schema, not a table called audit.
    const isSchema = cache.schemaNames().some(name => name.toLowerCase() === qualifier)
    const target = found && !(isSchema && found.table.toLowerCase() === qualifier) ? found : undefined
    if (target) {
      return cache.columnsOf(target.schema, target.table).filter(column => matches(column.name))
        .map(column => ({ label: column.name, kind: 'column' as const, detail: column.type, insert: quote(column.name) }))
    }
    // `schema.` → its tables
    if (cache.schemaNames().some(name => name.toLowerCase() === qualifier)) {
      const real = cache.schemaNames().find(name => name.toLowerCase() === qualifier)!
      return cache.tablesOf(real).filter(table => matches(table.name)).map(table => ({ label: table.name, kind: 'table' as const, detail: table.kind, insert: quote(table.name) }))
    }
    // An unaliased table in the default schema.
    return cache.columnsOf('public', context.qualifier).filter(column => matches(column.name))
      .map(column => ({ label: column.name, kind: 'column' as const, detail: column.type, insert: quote(column.name) }))
  }
  if (needle.length === 0 && !/\s$/.test(textBeforeCursor) && textBeforeCursor.length > 0) return []
  const result: Suggestion[] = []
  for (const table of cache.tablesOf('public')) if (matches(table.name)) result.push({ label: table.name, kind: 'table', detail: table.kind, insert: quote(table.name) })
  for (const schema of cache.schemaNames()) if (matches(schema)) result.push({ label: schema, kind: 'schema', insert: quote(schema) })
  // Columns of the tables already named in the statement.
  const seen = new Set<string>()
  for (const target of collectAliases(fullText).values()) {
    const key = `${target.schema}.${target.table}`
    if (seen.has(key)) continue
    seen.add(key)
    for (const column of cache.columnsOf(target.schema, target.table)) if (matches(column.name)) result.push({ label: column.name, kind: 'column', detail: `${target.table}.${column.type}`, insert: quote(column.name) })
  }
  for (const keyword of KEYWORDS) if (matches(keyword)) result.push({ label: keyword, kind: 'keyword', insert: keyword })
  return result.slice(0, 200)
}

type Monaco = Parameters<OnMount>[1]
const KIND = { keyword: 17, table: 7, column: 4, schema: 8 } as const // monaco CompletionItemKind: Keyword, Class, Field, Module

let provider: { dispose(): void } | null = null
let active: SchemaCache | null = null

/** Makes the editor complete from this connection's schema. Registers Monaco's provider once for the whole app. */
export function bindCompletion(monaco: Monaco, connection: OxeQueryConnection): void {
  active = cacheFor(connection)
  if (provider) return
  provider = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '"'],
    provideCompletionItems(model: { getValueInRange(range: object): string; getWordUntilPosition(position: object): { startColumn: number; endColumn: number }; getValue(): string }, position: { lineNumber: number; column: number }) {
      if (!active) return { suggestions: [] }
      const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
      const word = model.getWordUntilPosition(position)
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
      return {
        suggestions: suggest(active, model.getValue(), before).map((item, index) => ({
          label: item.label, kind: KIND[item.kind], insertText: item.insert, detail: item.detail, range,
          // Columns first, then tables, then keywords.
          sortText: `${item.kind === 'column' ? '0' : item.kind === 'table' ? '1' : item.kind === 'schema' ? '2' : '3'}${String(index).padStart(4, '0')}`
        }))
      }
    }
  })
}
