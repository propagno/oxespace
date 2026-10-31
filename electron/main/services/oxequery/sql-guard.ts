import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type { SqlGuardVerdict } from '../../../../shared/types/oxequery'

type Kind = SqlGuardVerdict['kind']
const SEVERITY: Record<Kind, number> = { empty: 0, read: 1, write: 2, ddl: 3, destructive: 4 }

/**
 * A dollar-quote opener at `index`: `$$` or `$tag$` (the tag rule is unchanged).
 * Postgres reads a `$` right after an identifier character as part of that identifier (`foo$a$` is one name),
 * so no quote opens there; treating it as one would hide the text that follows from the classifier.
 */
function dollarTag(sql: string, index: number): string | undefined {
  if (/[\p{L}\p{N}_$]/u.test(sql[index - 1] ?? '')) return undefined
  return /^\$[A-Za-z_]*\$/.exec(sql.slice(index))?.[0]
}

/**
 * Whether a backslash escapes the next character inside the string literal opening at `index`. Always in an
 * `E'…'` string; never in a `U&'…'` one (its backslash starts a Unicode escape); in an ordinary string only in the
 * legacy reading, as a server with standard_conforming_strings off reads it. The classifier never assumes the setting.
 */
function backslashEscapes(sql: string, index: number, legacy: boolean): boolean {
  if (/[eE]/.test(sql[index - 1] ?? '') && !/[A-Za-z0-9_]/.test(sql[index - 2] ?? '')) return true
  if (sql[index - 1] === '&' && /[uU]/.test(sql[index - 2] ?? '') && !/[A-Za-z0-9_]/.test(sql[index - 3] ?? '')) return false
  return legacy
}

/** True when an ordinary string literal (not E'…', not U&'…') starting at `index` holds a backslash before it closes. */
function ordinaryWithBackslash(sql: string, index: number, end: number): boolean {
  if (backslashEscapes(sql, index, true) !== backslashEscapes(sql, index, false)) return sql.slice(index + 1, end).includes('\\')
  return false
}

/** How a scan reads backslashes in ordinary strings, and who hears that one held a backslash. */
export interface EscapeReading { legacy?: boolean; onAmbiguous?: () => void }

/**
 * Splits SQL into top-level statements and returns each one as a list of upper-case
 * word tokens with comments, string literals, quoted identifiers and dollar-quoted
 * bodies removed. It is a classifier, not a parser: it only has to know what a
 * statement *starts with* and whether a WHERE clause exists. With `literals`, the text
 * of each statement's string and dollar-quoted literals is collected there, one list per
 * statement, so a `DO` body can be inspected.
 */
export function tokenizeStatements(sql: string, literals?: string[][], reading: EscapeReading = {}): string[][] {
  const statements: string[][] = []
  let words: string[] = []
  let texts: string[] = []
  let word = ''
  const endWord = (): void => { if (word) { words.push(word.toUpperCase()); word = '' } }
  const endStatement = (): void => { endWord(); if (words.length) { statements.push(words); literals?.push(texts) } words = []; texts = [] }
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
      const escapes = char === '\'' && backslashEscapes(sql, index, reading.legacy ?? false)
      const open = index
      const start = ++index
      while (index < sql.length) {
        if (escapes && sql[index] === '\\') { index += 2; continue }
        if (sql[index] === char) { if (sql[index + 1] === char) { index += 2; continue } index++; break }
        index++
      }
      if (char === '\'' && reading.onAmbiguous && ordinaryWithBackslash(sql, open, index)) reading.onAmbiguous()
      if (char === '\'') texts.push(sql.slice(start, Math.max(start, index - 1)).replace(/''/g, '\''))
      words.push(char === '"' ? 'IDENT' : 'STRING')
      continue
    }
    if (char === '$') {
      const tag = dollarTag(sql, index)
      if (tag) {
        endWord()
        const close = sql.indexOf(tag, index + tag.length)
        texts.push(sql.slice(index + tag.length, close === -1 ? sql.length : close))
        index = close === -1 ? sql.length : close + tag.length
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

interface Verdict { kind: Kind; reason?: string; code?: MainMessage }

const COPY_PROGRAM = 'COPY ... PROGRAM runs a shell command on the database server.'
const ROW_LOCK = 'SELECT ... FOR UPDATE / FOR SHARE locks the rows it reads until the transaction ends.'
const SESSION_ROLE = 'SET ROLE / SET SESSION AUTHORIZATION changes the session user, and with it what later statements may do.'
const TABLE_LOCK = 'VACUUM FULL locks the whole table while it runs.'
const RUNS_CODE: Record<'DO' | 'CALL', string> = {
  DO: 'DO runs code in the database; its effect is not known before it runs.',
  CALL: 'CALL runs a stored procedure; its effect is not known before it runs.'
}
/** How deep `DO` bodies are followed through nested literals (dynamic SQL inside dynamic SQL). */
const BODY_DEPTH = 4

/** The destructive keyword a statement's words carry anywhere, for code whose text is not a single statement. */
function destructiveWord(words: string[]): string | undefined {
  const found = words.find(word => word === 'DROP' || word === 'TRUNCATE' || word === 'DELETE')
  if (found) return found
  if (words[0] === 'COPY' && words.includes('PROGRAM')) return 'COPY PROGRAM'
  // A row lock (`FOR UPDATE`, `FOR NO KEY UPDATE`) and `ON CONFLICT DO UPDATE` are not an UPDATE statement.
  const update = words.findIndex((word, index) => word === 'UPDATE' && !['FOR', 'KEY', 'DO'].includes(words[index - 1]))
  return update !== -1 && !words.slice(update).includes('WHERE') ? 'UPDATE' : undefined
}

/**
 * The destructive keyword inside a `DO` or `CALL`: in its own words, in its string and dollar-quoted literals (the
 * body, or SQL text handed to EXECUTE) and in theirs, to `BODY_DEPTH`. Deeper nesting counts as destructive.
 */
function destructiveInside(words: string[], texts: string[], depth = 0): string | undefined {
  const own = destructiveWord(words)
  if (own) return own
  for (const text of texts) {
    if (depth >= BODY_DEPTH) return 'nested code'
    const nested: string[][] = []
    const statements = tokenizeStatements(text, nested)
    for (const [index, statement] of statements.entries()) {
      const found = destructiveInside(statement, nested[index] ?? [], depth + 1)
      if (found) return found
    }
  }
  return undefined
}

/** `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` and `FOR KEY SHARE`, at any depth. */
function locksRows(words: string[]): boolean {
  return words.some((word, index) => word === 'FOR' && (
    words[index + 1] === 'UPDATE' || words[index + 1] === 'SHARE' ||
    (words[index + 1] === 'NO' && words[index + 2] === 'KEY' && words[index + 3] === 'UPDATE') ||
    (words[index + 1] === 'KEY' && words[index + 2] === 'SHARE')))
}

function classify(words: string[], texts: string[]): Verdict | Verdict[] {
  const outer = topLevel(words)
  const first = outer[0] ?? words.find(word => word !== '(') ?? ''
  if (!first) return { kind: 'empty' }
  if (first === 'COPY' && outer.includes('PROGRAM')) {
    return { kind: 'destructive', reason: COPY_PROGRAM, code: mainMessage('oxequery.sql.copyProgram', {}) }
  }
  if (first === 'PREPARE') {
    // PREPARE name [ (types) ] AS <statement>: the EXECUTE that follows runs the inner statement, so it is judged here.
    let depth = 0
    const as = words.findIndex(word => { if (word === '(') depth++; else if (word === ')') depth = Math.max(0, depth - 1); return depth === 0 && word === 'AS' })
    const inner = as === -1 ? [] : [classify(words.slice(as + 1), texts)].flat()
    const destructive = inner.some(verdict => verdict.kind === 'destructive')
    const keyword = destructive ? destructiveWord(words.slice(as + 1)) ?? words[as + 1] : undefined
    return [{ kind: 'write' }, ...inner, ...(keyword ? [{
      kind: 'destructive' as const, reason: `PREPARE contains ${keyword}, which can remove data or objects.`,
      code: mainMessage('oxequery.sql.destructiveInside', { statement: 'PREPARE', keyword })
    }] : [])]
  }
  if (first === 'DO' || first === 'CALL') {
    const runs: Verdict = { kind: 'write', reason: RUNS_CODE[first], code: mainMessage(first === 'DO' ? 'oxequery.sql.doBlock' : 'oxequery.sql.callProcedure', {}) }
    const inside = destructiveInside(words.slice(1), texts)
    return inside ? [runs, {
      kind: 'destructive', reason: `${first} contains ${inside}, which can remove data or objects.`,
      code: mainMessage('oxequery.sql.destructiveInside', { statement: first, keyword: inside })
    }] : runs
  }
  // A plain EXPLAIN only plans the statement, so it takes no lock; EXPLAIN ANALYZE runs it and does.
  if (READ.has(first) && (first !== 'EXPLAIN' || words.includes('ANALYZE')) && locksRows(words)) {
    return [{ kind: 'write', reason: ROW_LOCK, code: mainMessage('oxequery.sql.rowLock', {}) }, classifyPlain(words, outer, first)]
  }
  return classifyPlain(words, outer, first)
}

function classifyPlain(words: string[], outer: string[], first: string): Verdict {
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
  // Same kind as any other DDL; these only add the reason the confirmation shows.
  if ((first === 'SET' || first === 'RESET') && (outer.slice(1, 3).includes('ROLE') || (outer.slice(1, 3).includes('SESSION') && outer.includes('AUTHORIZATION')))) {
    return { kind: 'ddl', reason: SESSION_ROLE, code: mainMessage('oxequery.sql.sessionRole', {}) }
  }
  if (first === 'VACUUM' && words.includes('FULL')) return { kind: 'ddl', reason: TABLE_LOCK, code: mainMessage('oxequery.sql.tableLock', {}) }
  if (DDL.has(first)) return { kind: 'ddl' }
  return { kind: 'write', reason: `${first} is not a recognised read-only statement` }
}

/**
 * Functions that reach outside the database even inside a READ ONLY transaction:
 * server files, large objects on disk, other servers, other sessions, the server's
 * configuration, advisory locks, and functions that run SQL text given as a string
 * (which would hide any of the above from a scan).
 */
const OUTSIDE_REACH = new Set([
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_ls_logdir', 'pg_ls_waldir', 'pg_ls_tmpdir', 'pg_ls_archive_statusdir', 'pg_stat_file', 'pg_file_write',
  'pg_file_read', 'pg_file_rename', 'pg_file_unlink', 'pg_logdir_ls', 'lo_import', 'lo_export', 'lo_from_bytea', 'lo_put', 'lo_create', 'lo_unlink', 'lowrite',
  'dblink', 'dblink_connect', 'dblink_connect_u', 'dblink_exec', 'dblink_send_query', 'dblink_open', 'dblink_fetch', 'dblink_get_result',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_switch_wal', 'pg_create_restore_point', 'pg_backup_start', 'pg_backup_stop',
  'pg_start_backup', 'pg_stop_backup', 'pg_promote', 'set_config', 'pg_advisory_lock', 'pg_advisory_lock_shared', 'pg_try_advisory_lock', 'pg_try_advisory_lock_shared',
  'pg_advisory_xact_lock', 'pg_advisory_xact_lock_shared', 'pg_try_advisory_xact_lock', 'pg_try_advisory_xact_lock_shared',
  'query_to_xml', 'query_to_xml_and_xmlschema', 'query_to_xmlschema', 'cursor_to_xml', 'cursor_to_xmlschema', 'nextval', 'setval'
])

/** SQL with comments, string literals and dollar-quoted bodies blanked; quoted identifiers are kept. */
function blankLiterals(sql: string, legacy = false): string {
  let out = ''
  for (let index = 0; index < sql.length;) {
    const char = sql[index], next = sql[index + 1]
    if (char === '-' && next === '-') { while (index < sql.length && sql[index] !== '\n') index++; out += ' '; continue }
    if (char === '/' && next === '*') {
      let depth = 1
      index += 2
      while (index < sql.length && depth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') { depth++; index += 2 } else if (sql[index] === '*' && sql[index + 1] === '/') { depth--; index += 2 } else index++
      }
      out += ' '
      continue
    }
    if (char === '\'') {
      const escapes = backslashEscapes(sql, index, legacy)
      index++
      while (index < sql.length) {
        if (escapes && sql[index] === '\\') { index += 2; continue }
        if (sql[index] === '\'') { if (sql[index + 1] === '\'') { index += 2; continue } index++; break }
        index++
      }
      out += "''"
      continue
    }
    if (char === '$') {
      const tag = dollarTag(sql, index)
      if (tag) {
        const close = sql.indexOf(tag, index + tag.length)
        index = close === -1 ? sql.length : close + tag.length
        out += "''"
        continue
      }
    }
    out += char
    index++
  }
  return out
}

/** Names from the list above that the statement calls, in any case, quoted or schema-qualified. */
export function outsideReach(sql: string, legacy = false): string[] {
  const text = blankLiterals(sql, legacy)
  const found = new Set<string>()
  for (const match of text.matchAll(/(?:^|[^\w$"])"?([A-Za-z_][\w$]*)"?\s*\(/g)) {
    const name = match[1].toLowerCase()
    if (OUTSIDE_REACH.has(name)) found.add(name)
  }
  return [...found]
}

const AMBIGUOUS_ESCAPE = 'A backslash in a string can end it early on a server with standard_conforming_strings off, and then more of this text runs than it shows.'

/**
 * Classifies SQL. When an ordinary string holds a backslash, the text is read both ways (standard, and as a legacy
 * server with standard_conforming_strings off reads it) and the more severe verdict wins; when that is the legacy one,
 * it says so (`oxequery.sql.ambiguousEscape`). The server's setting is never assumed.
 */
export function guardSql(sql: string): SqlGuardVerdict {
  let ambiguous = false
  const standard = classifySql(sql, { onAmbiguous: () => { ambiguous = true } })
  if (!ambiguous) return standard
  const legacy = classifySql(sql, { legacy: true })
  if (SEVERITY[legacy.kind] <= SEVERITY[standard.kind]) return standard
  return { ...legacy, reasons: [...legacy.reasons, AMBIGUOUS_ESCAPE], codes: [...(legacy.codes ?? []), mainMessage('oxequery.sql.ambiguousEscape', {})] }
}

function classifySql(sql: string, reading: EscapeReading): SqlGuardVerdict {
  const literals: string[][] = []
  const statements = tokenizeStatements(sql, literals, reading)
  let kind: Kind = 'empty'
  const reasons: string[] = []
  const codes: MainMessage[] = []
  const reach = statements.length ? outsideReach(sql, reading.legacy ?? false) : []
  if (reach.length) {
    kind = 'write'
    reasons.push(`Calls ${reach.join(', ')}, which reaches outside the database (server files, other servers, other sessions or the server's configuration).`)
  }
  for (const [index, statement] of statements.entries()) {
    for (const verdict of [classify(statement, literals[index] ?? [])].flat()) {
      if (SEVERITY[verdict.kind] > SEVERITY[kind]) kind = verdict.kind
      if (verdict.reason && !reasons.includes(verdict.reason)) {
        reasons.push(verdict.reason)
        if (verdict.code) codes.push(verdict.code)
      }
    }
  }
  return { kind, reasons, statements: statements.length, ...(codes.length ? { codes } : {}) }
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
