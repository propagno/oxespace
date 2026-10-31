/**
 * A small, forgiving reader for the one statement under the cursor: which relations it names (with their
 * aliases), which CTEs it defines and what columns they expose. Pure text in, plain objects out; it never
 * touches the database and only ever sees the SQL the user typed.
 */

export interface StatementSlice {
  /** The statement as typed. */
  text: string
  /** Same length as `text`, with comments and string bodies blanked so structure can be matched safely. */
  masked: string
  /** Offset of the cursor inside `text`. */
  cursor: number
}

export interface SqlSource {
  /** Lower-cased name the statement uses to refer to it: the alias, else the bare name. */
  key: string
  kind: 'table' | 'cte' | 'subquery'
  schema?: string
  table?: string
  /** Known up front for a CTE or subquery; tables get theirs from the catalog. */
  columns?: string[]
  /** True when it came after JOIN (as opposed to FROM, UPDATE, INTO or a comma). */
  joined: boolean
  /** Offset in the masked statement where the relation starts. */
  at: number
}

export interface SqlCte { name: string; columns: string[] }

export interface ParsedStatement { sources: SqlSource[]; ctes: SqlCte[] }

/** Blank out comments, string literals and dollar-quoted bodies, keeping every offset where it was. */
export function maskSql(sql: string): string {
  const out = sql.split('')
  const blank = (from: number, to: number): void => { for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ' }
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') { const end = sql.indexOf('\n', i); const stop = end < 0 ? sql.length : end; blank(i, stop); i = stop; continue }
    if (ch === '/' && next === '*') { const end = sql.indexOf('*/', i + 2); const stop = end < 0 ? sql.length : end + 2; blank(i, stop); i = stop; continue }
    if (ch === "'") {
      let j = i + 1
      while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue } break } j++ }
      blank(i + 1, j); i = j + 1; continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < sql.length) { if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue } break } j++ }
      i = j + 1; continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        const stop = end < 0 ? sql.length : end
        blank(i + tag[0].length, stop); i = end < 0 ? sql.length : end + tag[0].length; continue
      }
    }
    i++
  }
  return out.join('')
}

/** The statement the cursor is in: text between the nearest `;` before and after it (outside strings and comments). */
export function statementAt(sql: string, offset: number): StatementSlice {
  const masked = maskSql(sql)
  const at = Math.max(0, Math.min(offset, sql.length))
  const before = masked.lastIndexOf(';', at - 1)
  const start = before < 0 ? 0 : before + 1
  const after = masked.indexOf(';', at)
  const end = after < 0 ? sql.length : after
  return { text: sql.slice(start, end), masked: masked.slice(start, end), cursor: at - start }
}

const IDENT = String.raw`"(?:[^"]|"")+"|[A-Za-z_][\w$]*`
const unquote = (raw: string): string => raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw

const NOT_AN_ALIAS = new Set(['WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION', 'INTERSECT', 'EXCEPT', 'SET', 'USING', 'RETURNING', 'AS', 'NATURAL', 'WINDOW', 'FETCH', 'FOR', 'VALUES', 'SELECT', 'LATERAL', 'OUTER', 'TABLESAMPLE', 'WITH'])

/** Index of the `)` matching the `(` at `open`, or -1. Expects masked text so strings cannot confuse it. */
function matchParen(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') depth--
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1 }
  }
  parts.push(text.slice(from))
  return parts
}

/** The names a SELECT list exposes: `AS x`, else the last identifier of the expression. `*` cannot be known. */
export function selectColumns(body: string): string[] {
  const select = /\bSELECT\b(?:\s+DISTINCT(?:\s+ON\s*\([^)]*\))?)?/i.exec(body)
  if (!select) return []
  const rest = body.slice(select.index + select[0].length)
  let depth = 0
  let stop = rest.length
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '(') depth++
    else if (rest[i] === ')') { depth--; if (depth < 0) { stop = i; break } }
    else if (depth === 0 && /\b(?:FROM|WHERE|GROUP|ORDER|LIMIT|UNION|INTERSECT|EXCEPT|HAVING|WINDOW)\b/iy.test(rest.slice(i, i + 9)) && (i === 0 || /\W/.test(rest[i - 1]))) { stop = i; break }
  }
  const names: string[] = []
  for (const raw of splitTopLevel(rest.slice(0, stop))) {
    const item = raw.trim()
    if (!item || item === '*' || item.endsWith('*')) continue
    const aliased = new RegExp(String.raw`\bAS\s+(${IDENT})\s*$`, 'i').exec(item)
    if (aliased) { names.push(unquote(aliased[1])); continue }
    const bare = item.replace(/::[\w\s."\[\]()]+$/, '').trim()
    const implicit = new RegExp(String.raw`^(?:[^()]*\.)?(${IDENT})$`).exec(bare)
    const call = /^([A-Za-z_][\w$]*)\s*\(/.exec(bare)
    // A bare reference or a call names itself; other expressions have no usable name.
    const pick = implicit?.[1] ?? (call ? call[1].toLowerCase() : undefined)
    if (pick) names.push(unquote(pick))
  }
  return names
}

function parseCtes(masked: string): SqlCte[] {
  const ctes: SqlCte[] = []
  const pattern = new RegExp(String.raw`(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(${IDENT})\s*(\([^()]*\))?\s*AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(`, 'gi')
  for (const match of masked.matchAll(pattern)) {
    const open = match.index + match[0].length - 1
    const close = matchParen(masked, open)
    const body = masked.slice(open + 1, close < 0 ? masked.length : close)
    const listed = match[2] ? match[2].slice(1, -1).split(',').map(part => unquote(part.trim())).filter(Boolean) : null
    ctes.push({ name: unquote(match[1]), columns: listed ?? selectColumns(body) })
  }
  return ctes
}

/** Reads relations and CTEs out of one statement (as returned by `statementAt().masked`). */
export function parseStatement(masked: string, defaultSchema = 'public'): ParsedStatement {
  const ctes = parseCtes(masked)
  const cteByName = new Map(ctes.map(cte => [cte.name.toLowerCase(), cte]))
  const sources: SqlSource[] = []
  const add = (source: SqlSource): void => { if (!sources.some(known => known.key === source.key)) sources.push(source) }

  const alias = (text: string, from: number): { name?: string; end: number } => {
    const m = new RegExp(String.raw`\s*(?:AS\s+)?(${IDENT})`, 'iy')
    m.lastIndex = from
    const found = m.exec(text)
    if (!found) return { end: from }
    const raw = found[1]
    if (!raw.startsWith('"') && NOT_AN_ALIAS.has(raw.toUpperCase())) return { end: from }
    return { name: unquote(raw), end: m.lastIndex }
  }

  const relation = (at: number, joined: boolean, from: number): number => {
    const m = new RegExp(String.raw`\s*(?:ONLY\s+)?(?:LATERAL\s+)?(?:(${IDENT})\s*\.\s*)?(${IDENT})(?!\s*\()`, 'iy')
    m.lastIndex = from
    const found = m.exec(masked)
    if (!found) return from
    const name = unquote(found[2])
    if (!found[1] && NOT_AN_ALIAS.has(name.toUpperCase()) && !found[2].startsWith('"')) return from
    const given = alias(masked, m.lastIndex)
    const cte = !found[1] ? cteByName.get(name.toLowerCase()) : undefined
    add(cte
      ? { key: (given.name ?? name).toLowerCase(), kind: 'cte', table: cte.name, columns: cte.columns, joined, at }
      : { key: (given.name ?? name).toLowerCase(), kind: 'table', schema: found[1] ? unquote(found[1]) : defaultSchema, table: name, joined, at })
    return given.end
  }

  const pattern = /\b(FROM|JOIN|UPDATE|INTO)\b/gi
  for (const match of masked.matchAll(pattern)) {
    const keyword = match[1].toUpperCase()
    const joined = keyword === 'JOIN'
    let cursor = match.index + match[0].length
    // `FROM (SELECT ...) alias` — a derived table whose columns are its select list.
    const paren = /\s*(?:LATERAL\s+)?\(/iy
    paren.lastIndex = cursor
    const opened = paren.exec(masked)
    if (opened && keyword !== 'INTO' && keyword !== 'UPDATE') {
      const open = paren.lastIndex - 1
      const close = matchParen(masked, open)
      if (close < 0) continue
      const given = alias(masked, close + 1)
      if (given.name) add({ key: given.name.toLowerCase(), kind: 'subquery', columns: selectColumns(masked.slice(open + 1, close)), joined, at: match.index })
      continue
    }
    cursor = relation(match.index, joined, cursor)
    // `FROM a, b c` — further comma-separated relations of the same clause.
    if (keyword === 'FROM') {
      for (;;) {
        const comma = /\s*,/y
        comma.lastIndex = cursor
        if (!comma.exec(masked)) break
        const next = relation(match.index, false, comma.lastIndex)
        if (next === comma.lastIndex) break
        cursor = next
      }
    }
  }
  return { sources, ctes }
}

/** `FOREIGN KEY (a, b) REFERENCES s.t(x, y)` as written by pg_get_constraintdef. */
export interface ForeignKeyRef { columns: string[]; schema?: string; table: string; refColumns: string[] }

export function parseForeignKey(definition: string): ForeignKeyRef | null {
  const m = new RegExp(String.raw`FOREIGN KEY\s*\(([^)]*)\)\s*REFERENCES\s+(?:(${IDENT})\.)?(${IDENT})\s*\(([^)]*)\)`, 'i').exec(definition)
  if (!m) return null
  const list = (text: string): string[] => text.split(',').map(part => unquote(part.trim())).filter(Boolean)
  return { columns: list(m[1]), ...(m[2] ? { schema: unquote(m[2]) } : {}), table: unquote(m[3]), refColumns: list(m[4]) }
}
