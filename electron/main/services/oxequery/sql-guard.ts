import type { SqlGuardVerdict } from '../../../../shared/types/oxequery'

type Kind = SqlGuardVerdict['kind']
const SEVERITY: Record<Kind, number> = { empty: 0, read: 1, write: 2, ddl: 3, destructive: 4 }

/**
 * Splits SQL into top-level statements and returns each one as a list of upper-case
 * word tokens with comments, string literals, quoted identifiers and dollar-quoted
 * bodies removed. It is a classifier, not a parser: it only has to know what a
 * statement *starts with* and whether a WHERE clause exists.
 */
export function tokenizeStatements(sql: string): string[][] {
  const statements: string[][] = []
  let words: string[] = []
  let word = ''
  const endWord = (): void => { if (word) { words.push(word.toUpperCase()); word = '' } }
  const endStatement = (): void => { endWord(); if (words.length) statements.push(words); words = [] }
  let depth = 0
  for (let index = 0; index < sql.length;) {
    const char = sql[index], next = sql[index + 1]
    if (char === '-' && next === '-') {
      endWord()
      while (index < sql.length && sql[index] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      endWord()
      let nesting = 1
      index += 2
      while (index < sql.length && nesting > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') { nesting++; index += 2 } else if (sql[index] === '*' && sql[index + 1] === '/') { nesting--; index += 2 } else index++
      }
      continue
    }
    if (char === '\'' || char === '"') {
      endWord()
      const escapes = char === '\'' && /[eE]/.test(sql[index - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[index - 2] ?? '')
      index++
      while (index < sql.length) {
        if (escapes && sql[index] === '\\') { index += 2; continue }
        if (sql[index] === char) { if (sql[index + 1] === char) { index += 2; continue } index++; break }
        index++
      }
      words.push(char === '"' ? 'IDENT' : 'STRING')
      continue
    }
    if (char === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index))
      if (tag) {
        endWord()
        const close = sql.indexOf(tag[0], index + tag[0].length)
        index = close === -1 ? sql.length : close + tag[0].length
        words.push('STRING')
        continue
      }
    }
    if (char === '(') { endWord(); depth++; words.push('('); index++; continue }
    if (char === ')') { endWord(); depth = Math.max(0, depth - 1); words.push(')'); index++; continue }
    if (char === ';' && depth === 0) { endStatement(); index++; continue }
    if (/[A-Za-z0-9_]/.test(char)) word += char
    else endWord()
    index++
  }
  endStatement()
  return statements
}

function topLevel(words: string[]): string[] {
  const result: string[] = []
  let depth = 0
  for (const word of words) {
    if (word === '(') { depth++; continue }
    if (word === ')') { depth = Math.max(0, depth - 1); continue }
    if (depth === 0) result.push(word)
  }
  return result
}

const READ = new Set(['SELECT', 'SHOW', 'VALUES', 'TABLE', 'EXPLAIN', 'WITH'])
const WRITE = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY', 'CALL', 'DO', 'EXECUTE', 'PREPARE', 'LISTEN', 'NOTIFY', 'UNLISTEN'])
const DDL = new Set(['CREATE', 'ALTER', 'GRANT', 'REVOKE', 'COMMENT', 'VACUUM', 'REINDEX', 'CLUSTER', 'REFRESH', 'LOCK', 'SET', 'RESET', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'END', 'SAVEPOINT', 'RELEASE', 'DISCARD', 'ANALYZE', 'SECURITY', 'IMPORT'])
const DESTRUCTIVE = new Set(['DROP', 'TRUNCATE'])

function classify(words: string[]): { kind: Kind; reason?: string } {
  const outer = topLevel(words)
  const first = outer[0] ?? words.find(word => word !== '(') ?? ''
  if (!first) return { kind: 'empty' }
  if (DESTRUCTIVE.has(first)) return { kind: 'destructive', reason: `${first} permanently removes objects or data` }
  if (first === 'DELETE' || first === 'UPDATE') {
    return outer.includes('WHERE') || outer.includes('CURRENT') ? { kind: 'write' } : { kind: 'destructive', reason: `${first} without a WHERE clause affects every row` }
  }
  if (first === 'ALTER' && outer.includes('DROP')) return { kind: 'destructive', reason: 'ALTER ... DROP removes a column, constraint or object' }
  if (first === 'WITH') {
    // A data-modifying CTE is a write even though the statement starts like a query.
    const modifies = words.find(word => word === 'INSERT' || word === 'UPDATE' || word === 'DELETE' || word === 'MERGE')
    if (modifies) return { kind: words.includes('WHERE') || modifies === 'INSERT' ? 'write' : 'destructive', ...(modifies !== 'INSERT' && !words.includes('WHERE') ? { reason: `${modifies} inside WITH has no WHERE clause` } : {}) }
    return { kind: 'read' }
  }
  if (first === 'EXPLAIN') {
    const analyzes = outer.includes('ANALYZE') || words.slice(0, 6).includes('ANALYZE')
    const modifies = words.some(word => ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(word))
    return analyzes && modifies ? { kind: 'write', reason: 'EXPLAIN ANALYZE executes the statement' } : { kind: 'read' }
  }
  if (first === 'SELECT' && outer.includes('INTO')) {
    const from = outer.indexOf('FROM'), into = outer.indexOf('INTO')
    if (from === -1 || into < from) return { kind: 'ddl', reason: 'SELECT INTO creates a table' }
  }
  if (READ.has(first)) return { kind: 'read' }
  if (WRITE.has(first)) return { kind: 'write' }
  if (DDL.has(first)) return { kind: 'ddl' }
  return { kind: 'write', reason: `${first} is not a recognised read-only statement` }
}

export function guardSql(sql: string): SqlGuardVerdict {
  const statements = tokenizeStatements(sql)
  let kind: Kind = 'empty'
  const reasons: string[] = []
  for (const statement of statements) {
    const verdict = classify(statement)
    if (SEVERITY[verdict.kind] > SEVERITY[kind]) kind = verdict.kind
    if (verdict.reason && !reasons.includes(verdict.reason)) reasons.push(verdict.reason)
  }
  return { kind, reasons, statements: statements.length }
}

/** True when the statement may change data or the schema. */
export function isMutating(verdict: SqlGuardVerdict): boolean {
  return verdict.kind === 'write' || verdict.kind === 'ddl' || verdict.kind === 'destructive'
}

/** Postgres identifier quoting: wrap in double quotes and double any embedded quote. */
export function quoteIdentifier(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255 || name.includes('\0')) throw Error('Invalid identifier')
  return `"${name.replace(/"/g, '""')}"`
}
