/**
 * The schema-aware parts of completion: join targets and ON conditions derived from foreign keys, CTE names,
 * and the PostgreSQL functions worth typing. Everything here works from the catalog cache and the statement
 * text; no query is ever run and no row data is involved.
 */
import { parseForeignKey, type ForeignKeyRef, type ParsedStatement, type SqlSource } from './sql-statement'

export interface ExtraSuggestion { label: string; kind: 'function' | 'cte' | 'join'; detail?: string; insert: string }

/** The slice of the schema cache these helpers need (SchemaCache satisfies it). */
export interface CatalogView {
  tablesOf(schema: string): { name: string }[]
  foreignKeysOf(schema: string, table: string): ForeignKeyRef[]
}

const quote = (name: string): string => /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`

/** PostgreSQL built-ins people reach for, with the shape of the call. */
export const PG_FUNCTIONS: readonly [name: string, signature: string][] = [
  ['count', 'count(*) → bigint'], ['sum', 'sum(expr)'], ['avg', 'avg(expr)'], ['min', 'min(expr)'], ['max', 'max(expr)'],
  ['array_agg', 'array_agg(expr)'], ['string_agg', 'string_agg(expr, delimiter)'], ['json_agg', 'json_agg(expr)'], ['jsonb_agg', 'jsonb_agg(expr)'],
  ['json_build_object', 'json_build_object(key, value, …)'], ['jsonb_build_object', 'jsonb_build_object(key, value, …)'], ['jsonb_each', 'jsonb_each(jsonb)'],
  ['jsonb_array_elements', 'jsonb_array_elements(jsonb)'], ['jsonb_extract_path_text', 'jsonb_extract_path_text(jsonb, path…)'], ['jsonb_set', 'jsonb_set(target, path, value)'],
  ['coalesce', 'coalesce(a, b, …)'], ['nullif', 'nullif(a, b)'], ['greatest', 'greatest(a, b, …)'], ['least', 'least(a, b, …)'],
  ['now', 'now() → timestamptz'], ['current_date', 'current_date'], ['current_timestamp', 'current_timestamp'], ['date_trunc', "date_trunc('day', ts)"], ['date_part', "date_part('year', ts)"],
  ['extract', 'extract(field FROM ts)'], ['age', 'age(ts, ts)'], ['to_char', 'to_char(value, format)'], ['to_date', 'to_date(text, format)'], ['to_timestamp', 'to_timestamp(text, format)'],
  ['generate_series', 'generate_series(start, stop, step)'], ['unnest', 'unnest(array)'], ['array_length', 'array_length(array, dim)'], ['cardinality', 'cardinality(array)'],
  ['lower', 'lower(text)'], ['upper', 'upper(text)'], ['length', 'length(text)'], ['substring', 'substring(text FROM start FOR count)'], ['trim', 'trim(text)'],
  ['replace', 'replace(text, from, to)'], ['split_part', 'split_part(text, delimiter, n)'], ['regexp_replace', 'regexp_replace(text, pattern, replacement)'], ['regexp_matches', 'regexp_matches(text, pattern)'],
  ['concat', 'concat(a, b, …)'], ['concat_ws', 'concat_ws(separator, a, b, …)'], ['left', 'left(text, n)'], ['right', 'right(text, n)'], ['position', 'position(sub IN text)'],
  ['round', 'round(numeric, digits)'], ['floor', 'floor(numeric)'], ['ceil', 'ceil(numeric)'], ['abs', 'abs(numeric)'], ['random', 'random() → double precision'],
  ['row_number', 'row_number() OVER (…)'], ['rank', 'rank() OVER (…)'], ['dense_rank', 'dense_rank() OVER (…)'], ['lag', 'lag(expr, offset) OVER (…)'], ['lead', 'lead(expr, offset) OVER (…)'],
  ['first_value', 'first_value(expr) OVER (…)'], ['last_value', 'last_value(expr) OVER (…)'], ['ntile', 'ntile(n) OVER (…)'],
  ['gen_random_uuid', 'gen_random_uuid() → uuid'], ['md5', 'md5(text)'], ['pg_size_pretty', 'pg_size_pretty(bigint)'], ['pg_total_relation_size', 'pg_total_relation_size(regclass)'],
  ['exists', 'EXISTS (subquery)'], ['cast', 'CAST(expr AS type)']
]

/** Functions whose name starts with what was typed. Requires at least one character: an empty prefix would flood the list. */
export function functionSuggestions(prefix: string): ExtraSuggestion[] {
  const needle = prefix.toLowerCase()
  if (needle.length === 0) return []
  return PG_FUNCTIONS.filter(([name]) => name.startsWith(needle)).map(([name, signature]) => ({ label: name, kind: 'function' as const, detail: signature, insert: `${name}(` }))
}

export function cteSuggestions(parsed: ParsedStatement, prefix: string): ExtraSuggestion[] {
  const needle = prefix.toLowerCase()
  return parsed.ctes.filter(cte => !needle || cte.name.toLowerCase().startsWith(needle))
    .map(cte => ({ label: cte.name, kind: 'cte' as const, detail: 'CTE', insert: quote(cte.name) }))
}

/** Where the cursor is relative to a JOIN: choosing the target, or writing its ON condition. */
export type JoinPosition = { kind: 'target'; prefix: string } | { kind: 'on'; target: string; prefix: string } | null

export function joinPosition(textBeforeCursor: string): JoinPosition {
  const on = /\bJOIN\s+(?:"[^"]+"|[\w$.]+)(?:\s+(?:AS\s+)?("[^"]+"|(?!ON\b)[A-Za-z_][\w$]*))?\s+ON\s+([\w$.]*)$/i.exec(textBeforeCursor)
  if (on) {
    const joined = /\bJOIN\s+("[^"]+"|[\w$]+(?:\.(?:"[^"]+"|[\w$]+))?)/gi
    let last = ''
    for (const match of textBeforeCursor.matchAll(joined)) last = match[1]
    const alias = on[1]?.replace(/^"|"$/g, '')
    const name = last.split('.').pop()!.replace(/^"|"$/g, '')
    return { kind: 'on', target: (alias ?? name).toLowerCase(), prefix: on[2] }
  }
  const target = /\bJOIN\s+([\w$]*)$/i.exec(textBeforeCursor)
  return target ? { kind: 'target', prefix: target[1] } : null
}

const sameRelation = (source: SqlSource, schema: string | undefined, table: string): boolean =>
  source.kind === 'table' && source.table?.toLowerCase() === table.toLowerCase() && (!schema || (source.schema ?? 'public').toLowerCase() === schema.toLowerCase())

const shortAlias = (table: string, taken: Set<string>): string => {
  const base = table.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(word => word[0]).join('').toLowerCase() || 't'
  let candidate = base
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}${n}`
  return candidate
}

/**
 * Tables worth joining to what the statement already names: those a foreign key points at, and those whose
 * foreign key points back. Each insert carries an alias and the ON condition, e.g. `orders o ON o.user_id = u.id`.
 * Incoming keys are only known for tables whose keys are already cached, so they appear as the catalog warms up.
 */
export function joinTargetSuggestions(catalog: CatalogView, parsed: ParsedStatement, prefix: string): ExtraSuggestion[] {
  const needle = prefix.toLowerCase()
  const taken = new Set(parsed.sources.map(source => source.key))
  const out: ExtraSuggestion[] = []
  const seen = new Set<string>()
  const push = (table: string, schema: string, onLeft: (alias: string) => string, detail: string): void => {
    if (needle && !table.toLowerCase().startsWith(needle)) return
    const alias = shortAlias(table, taken)
    const key = `${schema}.${table}:${detail}`
    if (seen.has(key)) return
    seen.add(key)
    const qualified = schema === 'public' ? quote(table) : `${quote(schema)}.${quote(table)}`
    out.push({ label: table, kind: 'join', detail, insert: `${qualified} ${alias} ON ${onLeft(alias)}` })
  }
  for (const source of parsed.sources) {
    if (source.kind !== 'table' || !source.table) continue
    const schema = source.schema ?? 'public'
    for (const fk of catalog.foreignKeysOf(schema, source.table)) {
      const refSchema = fk.schema ?? schema
      const condition = (alias: string): string => fk.columns.map((column, index) => `${alias}.${quote(fk.refColumns[index] ?? 'id')} = ${source.key}.${quote(column)}`).join(' AND ')
      if (!parsed.sources.some(other => sameRelation(other, refSchema, fk.table))) push(fk.table, refSchema, condition, `FK ${source.key}.${fk.columns.join(', ')}`)
    }
    // Tables elsewhere in the schema that reference this one.
    for (const candidate of catalog.tablesOf(schema)) {
      if (parsed.sources.some(other => sameRelation(other, schema, candidate.name))) continue
      for (const fk of catalog.foreignKeysOf(schema, candidate.name)) {
        if ((fk.schema ?? schema).toLowerCase() !== schema.toLowerCase() || fk.table.toLowerCase() !== source.table.toLowerCase()) continue
        const condition = (alias: string): string => fk.columns.map((column, index) => `${alias}.${quote(column)} = ${source.key}.${quote(fk.refColumns[index] ?? 'id')}`).join(' AND ')
        push(candidate.name, schema, condition, `FK ${candidate.name}.${fk.columns.join(', ')}`)
      }
    }
  }
  return out
}

/** `a.x = b.y` conditions between the table just joined and the ones before it, from foreign keys in either direction. */
export function joinConditionSuggestions(catalog: CatalogView, parsed: ParsedStatement, targetKey: string, prefix: string): ExtraSuggestion[] {
  const target = parsed.sources.find(source => source.key === targetKey)
  if (!target || target.kind !== 'table' || !target.table) return []
  const needle = prefix.toLowerCase()
  const out: ExtraSuggestion[] = []
  const targetSchema = target.schema ?? 'public'
  const add = (text: string): void => { if (!needle || text.toLowerCase().startsWith(needle)) out.push({ label: text, kind: 'join', detail: 'FK', insert: text }) }
  for (const other of parsed.sources) {
    if (other.key === target.key || other.kind !== 'table' || !other.table) continue
    const otherSchema = other.schema ?? 'public'
    for (const fk of catalog.foreignKeysOf(targetSchema, target.table)) {
      if (fk.table.toLowerCase() !== other.table.toLowerCase() || (fk.schema ?? targetSchema).toLowerCase() !== otherSchema.toLowerCase()) continue
      add(fk.columns.map((column, index) => `${target.key}.${quote(column)} = ${other.key}.${quote(fk.refColumns[index] ?? 'id')}`).join(' AND '))
    }
    for (const fk of catalog.foreignKeysOf(otherSchema, other.table)) {
      if (fk.table.toLowerCase() !== target.table.toLowerCase() || (fk.schema ?? otherSchema).toLowerCase() !== targetSchema.toLowerCase()) continue
      add(fk.columns.map((column, index) => `${other.key}.${quote(column)} = ${target.key}.${quote(fk.refColumns[index] ?? 'id')}`).join(' AND '))
    }
  }
  return out
}

/** Turns the catalog's `{ name, definition }` foreign keys into references, dropping any that do not parse. */
export function parseForeignKeys(list: { name: string; definition: string }[]): ForeignKeyRef[] {
  const refs: ForeignKeyRef[] = []
  for (const entry of list) { const ref = parseForeignKey(entry.definition); if (ref) refs.push(ref) }
  return refs
}
