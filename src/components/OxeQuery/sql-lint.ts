import type { ConnectionEnvironment } from '../../../shared/types/oxequery'

/**
 * Checks SQL before it runs (roadmap Q4): advice about statements that are legal but usually a mistake. It is a
 * lexer with a few rules, not a parser, in the same spirit as the main process's statement guard: it only needs to
 * know what a statement starts with, where a clause ends and what sits in the select list. Each finding says which
 * text it is about; the message is written by the editor from the catalog (`lint.<code>`), never here.
 */
export type LintCode = 'updateNoWhere' | 'deleteNoWhere' | 'drop' | 'truncate' | 'alterDrop' | 'selectStarLarge' | 'selectNoLimit'

export interface LintFinding {
  code: LintCode
  /** Offsets in the text that was checked; `end` is exclusive. */
  start: number
  end: number
  /** The statement removes data or objects for good: it earns a confirmation, not just a marker. */
  destructive: boolean
  /** Values the catalog message interpolates. */
  params: Record<string, string | number>
}

export interface LintContext {
  environment: ConnectionEnvironment
  /** The catalog's row estimate for a table, when the schema tree has it. An unqualified name is looked up in the search path by the caller. */
  rowEstimate?: (schema: string | undefined, table: string) => number | undefined
  /** Tables with at least this many estimated rows count as large. */
  largeTableRows?: number
}

export const LARGE_TABLE_ROWS = 100_000

type Kind = 'word' | 'ident' | 'num' | 'str' | 'punct'
interface Tok { kind: Kind; /** Upper case for a word; as written for the rest. */ text: string; /** Lower case for a word, unquoted for an identifier. */ name: string; start: number; end: number; depth: number }

const WORD_START = /[A-Za-z_\u0080-￿]/
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/

/** Words, quoted identifiers, numbers and the few punctuation marks the rules read; comments and string bodies are dropped. */
function tokenize(sql: string): Tok[] {
  const out: Tok[] = []
  let depth = 0
  const push = (kind: Kind, text: string, start: number, end: number, name = text): void => { out.push({ kind, text, name, start, end, depth }) }
  for (let index = 0; index < sql.length;) {
    const char = sql[index], next = sql[index + 1]
    if (char === '-' && next === '-') { while (index < sql.length && sql[index] !== '\n') index++; continue }
    if (char === '/' && next === '*') {
      let nesting = 1
      index += 2
      while (index < sql.length && nesting > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') { nesting++; index += 2 } else if (sql[index] === '*' && sql[index + 1] === '/') { nesting--; index += 2 } else index++
      }
      continue
    }
    if (char === '\'') {
      const start = index
      const escapes = /[eE]/.test(sql[index - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[index - 2] ?? '')
      index++
      while (index < sql.length) {
        if (escapes && sql[index] === '\\') { index += 2; continue }
        if (sql[index] === '\'') { if (sql[index + 1] === '\'') { index += 2; continue } index++; break }
        index++
      }
      push('str', 'STRING', start, index)
      continue
    }
    if (char === '"') {
      const start = index
      let name = ''
      index++
      while (index < sql.length) {
        if (sql[index] === '"') { if (sql[index + 1] === '"') { name += '"'; index += 2; continue } index++; break }
        name += sql[index++]
      }
      push('ident', name, start, index, name)
      continue
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index, index + 64))
      if (tag) {
        const start = index
        const close = sql.indexOf(tag[0], index + tag[0].length)
        index = close === -1 ? sql.length : close + tag[0].length
        push('str', 'STRING', start, index)
        continue
      }
    }
    if (char === '(') { push('punct', '(', index, index + 1); depth++; index++; continue }
    if (char === ')') { depth = Math.max(0, depth - 1); push('punct', ')', index, index + 1); index++; continue }
    if (char === ';' || char === ',' || char === '.' || char === '*') { push('punct', char, index, index + 1); index++; continue }
    if (WORD_START.test(char)) {
      const start = index
      while (index < sql.length && WORD_PART.test(sql[index])) index++
      const raw = sql.slice(start, index)
      push('word', raw.toUpperCase(), start, index, raw.toLowerCase())
      continue
    }
    if (/[0-9]/.test(char)) {
      const start = index
      while (index < sql.length && /[0-9.]/.test(sql[index])) index++
      push('num', sql.slice(start, index), start, index)
      continue
    }
    index++
  }
  return out
}

/** The statements as lists of tokens: a `;` ends one only outside parentheses. */
function statements(tokens: Tok[]): Tok[][] {
  const out: Tok[][] = []
  let current: Tok[] = []
  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === ';' && token.depth === 0) { if (current.length) out.push(current); current = []; continue }
    current.push(token)
  }
  if (current.length) out.push(current)
  return out
}

const isWord = (token: Tok | undefined, ...words: string[]): boolean => token?.kind === 'word' && words.includes(token.text)
const isPunct = (token: Tok | undefined, char: string): boolean => token?.kind === 'punct' && token.text === char

/** Tokens from `from` while they stay inside the parentheses (or the statement) the one at `from` sits in. */
function scopeEnd(tokens: Tok[], from: number): number {
  const depth = tokens[from].depth
  let end = from + 1
  while (end < tokens.length && tokens[end].depth >= depth) end++
  return end
}

const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'BOOL_AND', 'BOOL_OR', 'EVERY', 'ARRAY_AGG', 'STRING_AGG', 'JSON_AGG', 'JSONB_AGG'])
/** Words that end a FROM clause. */
const AFTER_FROM = new Set(['WHERE', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'HAVING', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'FOR', 'RETURNING'])

function checkModify(tokens: Tok[], at: number): LintFinding | null {
  const verb = tokens[at].text
  const end = scopeEnd(tokens, at)
  const depth = tokens[at].depth
  for (let index = at + 1; index < end; index++) if (tokens[index].depth === depth && isWord(tokens[index], 'WHERE')) return null
  return { code: verb === 'UPDATE' ? 'updateNoWhere' : 'deleteNoWhere', start: tokens[at].start, end: tokens[end - 1].end, destructive: true, params: { statement: verb } }
}

/** `DROP …` and `TRUNCATE …` as the first words, and `ALTER … DROP COLUMN/CONSTRAINT …`. */
function checkRemoval(tokens: Tok[]): LintFinding | null {
  const first = tokens[0]
  const span = (): { start: number; end: number } => ({ start: first.start, end: Math.min(tokens.length, 3) > 0 ? tokens[Math.min(tokens.length, 3) - 1].end : first.end })
  if (isWord(first, 'DROP')) return { code: 'drop', ...span(), destructive: true, params: { statement: tokens.slice(0, 2).map(token => token.text).join(' ') } }
  if (isWord(first, 'TRUNCATE')) return { code: 'truncate', ...span(), destructive: true, params: { statement: 'TRUNCATE' } }
  if (isWord(first, 'ALTER')) {
    for (let index = 1; index < tokens.length; index++) {
      const token = tokens[index]
      // `ALTER COLUMN c DROP NOT NULL / DEFAULT` loosens a rule; only dropping a column, constraint or similar loses something.
      if (token.depth === 0 && isWord(token, 'DROP') && !isWord(tokens[index + 1], 'NOT', 'DEFAULT', 'IDENTITY', 'EXPRESSION')) {
        return { code: 'alterDrop', start: token.start, end: (tokens[index + 2] ?? tokens[index + 1] ?? token).end, destructive: true, params: { statement: ['ALTER', 'DROP', tokens[index + 1]?.text ?? ''].join(' ').trim() } }
      }
    }
  }
  return null
}

/** The tables a SELECT reads: the names after FROM and JOIN at its own depth, with a schema when one is written. */
function readTables(tokens: Tok[], select: number): Array<{ schema?: string; name: string }> {
  const depth = tokens[select].depth
  const end = scopeEnd(tokens, select)
  const tables: Array<{ schema?: string; name: string }> = []
  for (let index = select + 1; index < end; index++) {
    if (tokens[index].depth !== depth || !isWord(tokens[index], 'FROM', 'JOIN')) continue
    const first = tokens[index + 1]
    if (!first || (first.kind !== 'word' && first.kind !== 'ident') || (first.kind === 'word' && AFTER_FROM.has(first.text))) continue
    const qualified = isPunct(tokens[index + 2], '.') && (tokens[index + 3]?.kind === 'word' || tokens[index + 3]?.kind === 'ident')
    if (qualified) tables.push({ schema: first.name, name: tokens[index + 3].name })
    else if (!isPunct(tokens[index + 2], '(')) tables.push({ name: first.name })
  }
  return tables
}

/** Whether the SELECT at `select` has a LIMIT or FETCH of its own (not one of a subquery). */
function hasLimit(tokens: Tok[], select: number): boolean {
  const depth = tokens[select].depth
  const end = scopeEnd(tokens, select)
  for (let index = select + 1; index < end; index++) if (tokens[index].depth === depth && isWord(tokens[index], 'LIMIT', 'FETCH')) return true
  return false
}

function checkSelect(tokens: Tok[], select: number, context: LintContext, findings: LintFinding[], limited: boolean): void {
  const depth = tokens[select].depth
  const end = scopeEnd(tokens, select)
  const large = context.largeTableRows ?? LARGE_TABLE_ROWS
  // `*` in the select list: after SELECT, DISTINCT, a comma or a `table.`; `count(*)` and `a * b` do not qualify.
  let from = end
  for (let index = select + 1; index < end; index++) if (tokens[index].depth === depth && isWord(tokens[index], 'FROM')) { from = index; break }
  if (from === end || limited || !context.rowEstimate) return
  for (let index = select + 1; index < from; index++) {
    const token = tokens[index]
    if (token.depth !== depth || !isPunct(token, '*')) continue
    const before = tokens[index - 1]
    if (!(isWord(before, 'SELECT', 'DISTINCT', 'ALL') || isPunct(before, ',') || isPunct(before, '.'))) continue
    let biggest: { name: string; rows: number } | null = null
    for (const table of readTables(tokens, select)) {
      const rows = context.rowEstimate(table.schema, table.name)
      if (rows !== undefined && rows >= large && (!biggest || rows > biggest.rows)) biggest = { name: table.schema ? `${table.schema}.${table.name}` : table.name, rows }
    }
    if (biggest) findings.push({ code: 'selectStarLarge', start: token.start, end: token.end, destructive: false, params: { table: biggest.name, rows: biggest.rows } })
    return
  }
}

/** A SELECT that reads a table with nothing to bound it. A lone aggregate (`count(*)`) returns one row and is not one. */
function checkUnbounded(tokens: Tok[], select: number, findings: LintFinding[]): void {
  const end = scopeEnd(tokens, select)
  let from = -1, grouped = false
  for (let index = select + 1; index < end; index++) {
    if (tokens[index].depth !== 0) continue
    if (from === -1 && isWord(tokens[index], 'FROM')) from = index
    if (isWord(tokens[index], 'GROUP')) grouped = true
    if (isWord(tokens[index], 'INTO')) return
  }
  if (from === -1) return
  if (!grouped) for (let index = select + 1; index < from; index++) if (tokens[index].depth === 0 && tokens[index].kind === 'word' && AGGREGATES.has(tokens[index].text) && isPunct(tokens[index + 1], '(')) return
  findings.push({ code: 'selectNoLimit', start: tokens[select].start, end: tokens[select].end, destructive: false, params: {} })
}

/** Everything worth saying about the statements in `sql`, in the order they appear. */
export function lintSql(sql: string, context: LintContext): LintFinding[] {
  const findings: LintFinding[] = []
  for (const tokens of statements(tokenize(sql))) {
    const first = tokens[0]
    if (first.kind !== 'word' || first.text === 'EXPLAIN') continue
    const removal = checkRemoval(tokens)
    if (removal) findings.push(removal)
    // A change to rows: the statement itself, or a data-modifying CTE (`WITH gone AS (DELETE FROM t RETURNING *) …`).
    for (let index = 0; index < tokens.length; index++) {
      if (!isWord(tokens[index], 'UPDATE', 'DELETE')) continue
      if (index === 0 || (isPunct(tokens[index - 1], '(') && tokens[index].depth > 0)) {
        const finding = checkModify(tokens, index)
        if (finding) findings.push(finding)
      }
    }
    if (!isWord(first, 'SELECT', 'WITH')) continue
    if (tokens.some(token => token.depth === 0 && isWord(token, 'INSERT', 'UPDATE', 'DELETE', 'MERGE'))) continue
    const top = tokens.findIndex(token => token.depth === 0 && isWord(token, 'SELECT'))
    if (top === -1) continue
    const limited = tokens.some(token => token.depth === 0 && isWord(token, 'LIMIT', 'FETCH'))
    // Every SELECT in the statement can read a big table; only the outermost one has to be bounded.
    for (let index = 0; index < tokens.length; index++) if (isWord(tokens[index], 'SELECT')) checkSelect(tokens, index, context, findings, hasLimit(tokens, index) || (tokens[index].depth === 0 && limited))
    if (context.environment === 'prod' && !limited) checkUnbounded(tokens, top, findings)
  }
  return findings.sort((a, b) => a.start - b.start)
}

/** The findings that deserve a confirmation before the statement runs. */
export function destructiveFindings(findings: LintFinding[]): LintFinding[] {
  return findings.filter(finding => finding.destructive)
}
