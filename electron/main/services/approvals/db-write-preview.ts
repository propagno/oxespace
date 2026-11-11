export interface PreviewQueryOptions {
  readOnly?: boolean
  timeoutMs?: number
}

export interface SqlPreviewDriver {
  engine: 'postgres' | 'mysql' | 'sqlite'
  query(sql: string, options?: PreviewQueryOptions): Promise<{ rows: Array<Record<string, unknown>> }>
}

export interface MongoPreviewDriver {
  engine: 'mongo' | 'mongodb'
  countDocuments(collection: string, filter: unknown, options?: { maxTimeMS?: number }): Promise<number>
  find(collection: string, filter: unknown, limit: number, options?: { maxTimeMS?: number }): Promise<Array<Record<string, unknown>>>
}

export type PreviewDriver = SqlPreviewDriver | MongoPreviewDriver

export interface MongoWritePreviewSpec {
  collection: string
  op: string
  filter?: Record<string, unknown>
  update?: Record<string, unknown>
  documents?: Array<Record<string, unknown>>
  upsert?: boolean
  options?: { upsert?: boolean; [key: string]: unknown }
  operations?: unknown[]
  [key: string]: unknown
}

export interface DatabaseWritePreviewInput {
  text?: string
  mongo?: MongoWritePreviewSpec
  env: string
  driver: PreviewDriver
  productionCount?: boolean
}

export type PreviewSampleCell = unknown | { old: unknown; new: unknown }

export interface DatabaseWritePreviewSample {
  cols: string[]
  rows: PreviewSampleCell[][]
}

export interface DatabaseWritePreview {
  status: 'ok' | 'off-production' | 'failed'
  count: number | null
  sample?: DatabaseWritePreviewSample
  reason?: string
}

const PREVIEW_TIMEOUT_MS = 5_000
const SAMPLE_LIMIT = 5
const MASKED_CELL = '•••'
const SECRET_COLUMN_RE = /(password|passwd|secret|token|key|hash|salt)/i

const PURE_FUNCTIONS = new Set([
  'now', 'current_date', 'current_timestamp', 'current_time', 'localtime', 'localtimestamp',
  'lower', 'upper', 'coalesce', 'nullif', 'date_trunc', 'trim', 'btrim', 'ltrim', 'rtrim',
  'length', 'char_length', 'character_length', 'octet_length', 'cast', 'extract', 'date_part',
  'age', 'abs', 'round', 'floor', 'ceil', 'ceiling', 'greatest', 'least', 'concat', 'substr', 'substring'
])

const GROUPING_KEYWORDS = new Set([
  'IN', 'AND', 'OR', 'NOT', 'WHERE', 'SET', 'VALUES', 'ON', 'WHEN', 'THEN', 'ELSE',
  'BETWEEN', 'IS', 'LIKE', 'ILIKE', 'SIMILAR', 'ANY', 'ALL', 'SOME', 'CASE', 'EXISTS'
])

const SUBQUERY_KEYWORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH', 'MERGE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'CALL', 'EXEC', 'EXECUTE', 'GRANT', 'REVOKE'])

type SqlToken =
  | { kind: 'word'; raw: string; upper: string }
  | { kind: 'ident'; raw: string; name: string }
  | { kind: 'string'; raw: string; value: string }
  | { kind: 'number'; raw: string; value: number }
  | { kind: 'punct'; raw: string }

function isProductionEnv(env: string): boolean {
  const normalized = env.trim().toLowerCase()
  return normalized === 'production' || normalized === 'prod'
}

function isSecretColumn(name: string): boolean {
  return SECRET_COLUMN_RE.test(name)
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code ?? '')
  const message = String((error as { message?: unknown }).message ?? '')
  return code === '57014' || code === 'ETIMEDOUT' || code === 'timeout' || /timeout|timed out|exceeded time limit/i.test(message)
}

function dollarTagAt(sql: string, index: number): string | undefined {
  if (/[A-Za-z0-9_$]/.test(sql[index - 1] ?? '')) return undefined
  return /^\$[A-Za-z_]*\$/.exec(sql.slice(index))?.[0]
}

function lexSql(sql: string): { ok: true; tokens: SqlToken[] } | { ok: false; reason: string } {
  const tokens: SqlToken[] = []
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (/\s/.test(ch)) { i += 1; continue }
    if (ch === '-' && next === '-') {
      i += 2
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth += 1; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth -= 1; i += 2 }
        else i += 1
      }
      if (depth > 0) return { ok: false, reason: 'unterminated comment' }
      continue
    }
    if (ch === '\'') {
      const escaped = /[eE]/.test(sql[i - 1] ?? '') && (() => { const last = tokens.at(-1); return last?.kind === 'word' && last.upper === 'E' })()
      if (escaped) tokens.pop()
      const start = i
      i += 1
      let val = ''
      let closed = false
      while (i < sql.length) {
        if (escaped && sql[i] === '\\' && i + 1 < sql.length) { val += sql[i + 1]; i += 2; continue }
        if (sql[i] === '\'') {
          if (sql[i + 1] === '\'') { val += '\''; i += 2; continue }
          i += 1
          closed = true
          break
        }
        val += sql[i]
        i += 1
      }
      if (!closed) return { ok: false, reason: 'unterminated string' }
      tokens.push({ kind: 'string', raw: (escaped ? 'E' : '') + sql.slice(start, i), value: val })
      continue
    }
    if (ch === '"' || ch === '`') {
      const quote = ch
      const start = i
      i += 1
      let name = ''
      let closed = false
      while (i < sql.length) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { name += quote; i += 2; continue }
          i += 1
          closed = true
          break
        }
        name += sql[i]
        i += 1
      }
      if (!closed) return { ok: false, reason: 'unterminated identifier' }
      tokens.push({ kind: 'ident', raw: sql.slice(start, i), name })
      continue
    }
    if (ch === '$') {
      const tag = dollarTagAt(sql, i)
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length)
        if (close < 0) return { ok: false, reason: 'unterminated dollar string' }
        const raw = sql.slice(i, close + tag.length)
        const value = sql.slice(i + tag.length, close)
        tokens.push({ kind: 'string', raw, value })
        i = close + tag.length
        continue
      }
    }
    if (/[0-9]/.test(ch)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(sql.slice(i))!
      tokens.push({ kind: 'number', raw: match[0], value: Number(match[0]) })
      i += match[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))!
      tokens.push({ kind: 'word', raw: match[0], upper: match[0].toUpperCase() })
      i += match[0].length
      continue
    }
    const two = sql.slice(i, i + 2)
    if (two === '!=' || two === '<>' || two === '<=' || two === '>=' || two === '::' || two === '||') {
      tokens.push({ kind: 'punct', raw: two })
      i += 2
      continue
    }
    tokens.push({ kind: 'punct', raw: ch })
    i += 1
  }
  return { ok: true, tokens }
}

function splitStatements(tokens: readonly SqlToken[]): SqlToken[][] {
  const out: SqlToken[][] = []
  let current: SqlToken[] = []
  let depth = 0
  for (const token of tokens) {
    if (token.kind === 'punct' && token.raw === '(') depth += 1
    else if (token.kind === 'punct' && token.raw === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && token.kind === 'punct' && token.raw === ';') {
      if (current.length) out.push(current)
      current = []
      continue
    }
    current.push(token)
  }
  if (current.length) out.push(current)
  return out
}

function renderTokens(tokens: readonly SqlToken[]): string {
  let out = ''
  for (let i = 0; i < tokens.length; i += 1) {
    const cur = tokens[i]
    const prev = tokens[i - 1]
    if (i > 0) {
      const noSpaceBefore = cur.kind === 'punct' && (cur.raw === ',' || cur.raw === ')' || cur.raw === '.' || cur.raw === '::')
      const noSpaceAfterPrev = prev.kind === 'punct' && (prev.raw === '(' || prev.raw === '.' || prev.raw === '::')
      const fnCall = cur.kind === 'punct' && cur.raw === '(' && (prev.kind === 'word' || prev.kind === 'ident') && !(prev.kind === 'word' && GROUPING_KEYWORDS.has(prev.upper))
      if (!noSpaceBefore && !noSpaceAfterPrev && !fnCall) out += ' '
    }
    out += cur.raw
  }
  return out
}

function validateExpression(tokens: readonly SqlToken[], allowTopSelect = false): string | null {
  let depth = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if (tok.kind === 'punct' && tok.raw === '(') { depth += 1; continue }
    if (tok.kind === 'punct' && tok.raw === ')') { depth -= 1; if (depth < 0) return 'unbalanced parentheses'; continue }
    if (tok.kind === 'word') {
      if (SUBQUERY_KEYWORDS.has(tok.upper) && !(allowTopSelect && i === 0 && tok.upper === 'SELECT')) {
        return 'subquery not allowed'
      }
    }
    const next = tokens[i + 1]
    if (next?.kind === 'punct' && next.raw === '(' && (tok.kind === 'word' || tok.kind === 'ident')) {
      if (tok.kind === 'word' && GROUPING_KEYWORDS.has(tok.upper) && tokens[i - 1]?.raw !== '.') continue
      const fnName = (tok.kind === 'word' ? tok.raw : tok.name).toLowerCase()
      if (!PURE_FUNCTIONS.has(fnName)) return `function ${fnName} not allowed`
    }
  }
  if (depth !== 0) return 'unbalanced parentheses'
  return null
}

function topLevelIndex(tokens: readonly SqlToken[], word: string, from = 0): number {
  let depth = 0
  for (let i = from; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if (tok.kind === 'punct' && tok.raw === '(') depth += 1
    else if (tok.kind === 'punct' && tok.raw === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && tok.kind === 'word' && tok.upper === word) return i
  }
  return -1
}

function hasTopLevelWord(tokens: readonly SqlToken[], words: ReadonlySet<string>): string | null {
  let depth = 0
  for (const tok of tokens) {
    if (tok.kind === 'punct' && tok.raw === '(') depth += 1
    else if (tok.kind === 'punct' && tok.raw === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && tok.kind === 'word' && words.has(tok.upper)) return tok.upper
  }
  return null
}

function splitTopLevelCommas(tokens: readonly SqlToken[]): SqlToken[][] {
  const parts: SqlToken[][] = []
  let cur: SqlToken[] = []
  let depth = 0
  for (const tok of tokens) {
    if (tok.kind === 'punct' && tok.raw === '(') depth += 1
    else if (tok.kind === 'punct' && tok.raw === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && tok.kind === 'punct' && tok.raw === ',') {
      parts.push(cur)
      cur = []
      continue
    }
    cur.push(tok)
  }
  parts.push(cur)
  return parts
}

function validTableTarget(tokens: readonly SqlToken[]): boolean {
  if (!tokens.length || tokens.length > 5) return false
  const banned = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'USING', 'FROM', 'WHERE', 'SET', 'ORDER', 'LIMIT', 'ON'])
  for (const tok of tokens) {
    if (tok.kind === 'punct' && tok.raw !== '.') return false
    if (tok.kind === 'word' && banned.has(tok.upper)) return false
  }
  return true
}

interface ParsedAssignment {
  column: string
  hasLiteral: boolean
  literalValue: unknown
}

function parseLiteral(tokens: readonly SqlToken[]): { ok: true; value: unknown } | { ok: false } {
  if (tokens.length === 1) {
    const tok = tokens[0]
    if (tok.kind === 'string') return { ok: true, value: tok.value }
    if (tok.kind === 'number') return { ok: true, value: tok.value }
    if (tok.kind === 'word') {
      if (tok.upper === 'NULL') return { ok: true, value: null }
      if (tok.upper === 'TRUE') return { ok: true, value: true }
      if (tok.upper === 'FALSE') return { ok: true, value: false }
    }
  }
  if (tokens.length === 2 && tokens[0].kind === 'punct' && tokens[0].raw === '-' && tokens[1].kind === 'number') {
    return { ok: true, value: -tokens[1].value }
  }
  return { ok: false }
}

function parseAssignments(setTokens: readonly SqlToken[]): { ok: true; assignments: Map<string, ParsedAssignment> } | { ok: false; reason: string } {
  const items = splitTopLevelCommas(setTokens)
  const assignments = new Map<string, ParsedAssignment>()
  for (const item of items) {
    const eq = item.findIndex(tok => tok.kind === 'punct' && tok.raw === '=')
    if (eq <= 0 || eq === item.length - 1) return { ok: false, reason: 'invalid set clause' }
    const lhs = item.slice(0, eq)
    const rhs = item.slice(eq + 1)
    const lastLhs = lhs.at(-1)!
    if (lastLhs.kind !== 'word' && lastLhs.kind !== 'ident') return { ok: false, reason: 'invalid column in set' }
    const exprErr = validateExpression(rhs)
    if (exprErr) return { ok: false, reason: exprErr }
    const colName = lastLhs.kind === 'ident' ? lastLhs.name : lastLhs.raw
    const lit = parseLiteral(rhs)
    assignments.set(colName.toLowerCase(), {
      column: colName,
      hasLiteral: lit.ok,
      literalValue: lit.ok ? lit.value : renderTokens(rhs)
    })
  }
  return { ok: true, assignments }
}

type TranslatedSql =
  | { kind: 'values'; count: number }
  | { kind: 'count-only'; countSql: string }
  | { kind: 'rows'; countSql: string; sampleSql: string; assignments?: Map<string, ParsedAssignment> }

const WRITE_MODIFIERS = new Set(['JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'USING', 'ORDER', 'LIMIT', 'OFFSET', 'FETCH', 'RETURNING'])

function translateSql(sql: string): { ok: true; plan: TranslatedSql } | { ok: false; reason: string } {
  const lexed = lexSql(sql)
  if (!lexed.ok) return lexed
  const statements = splitStatements(lexed.tokens)
  if (statements.length === 0) return { ok: false, reason: 'empty statement' }
  if (statements.length > 1) return { ok: false, reason: 'multiple statements' }
  const stmt = statements[0]
  const first = stmt[0]
  if (first.kind !== 'word') return { ok: false, reason: 'unsupported statement' }

  if (first.upper === 'UPDATE') {
    const setIdx = topLevelIndex(stmt, 'SET', 1)
    if (setIdx < 2) return { ok: false, reason: 'missing set clause' }
    const tableTokens = stmt.slice(1, setIdx)
    if (!validTableTarget(tableTokens)) return { ok: false, reason: 'join or invalid target in update' }
    const afterSet = stmt.slice(setIdx + 1)
    if (topLevelIndex(afterSet, 'FROM') >= 0) return { ok: false, reason: 'update from not supported' }
    const badMod = hasTopLevelWord(afterSet, WRITE_MODIFIERS)
    if (badMod) return { ok: false, reason: `${badMod.toLowerCase()} not supported in update` }
    const whereRel = topLevelIndex(afterSet, 'WHERE')
    const setTokens = whereRel >= 0 ? afterSet.slice(0, whereRel) : afterSet
    const whereTokens = whereRel >= 0 ? afterSet.slice(whereRel + 1) : null
    if (!setTokens.length) return { ok: false, reason: 'empty set clause' }
    if (whereTokens && !whereTokens.length) return { ok: false, reason: 'empty where clause' }
    const parsedSet = parseAssignments(setTokens)
    if (!parsedSet.ok) return parsedSet
    if (whereTokens) {
      const whereErr = validateExpression(whereTokens)
      if (whereErr) return { ok: false, reason: whereErr }
    }
    const tableSql = renderTokens(tableTokens)
    const whereSql = whereTokens ? ` WHERE ${renderTokens(whereTokens)}` : ''
    return {
      ok: true,
      plan: {
        kind: 'rows',
        countSql: `SELECT COUNT(*) AS count FROM ${tableSql}${whereSql}`,
        sampleSql: `SELECT * FROM ${tableSql}${whereSql} LIMIT ${SAMPLE_LIMIT}`,
        assignments: parsedSet.assignments
      }
    }
  }

  if (first.upper === 'DELETE') {
    let idx = 1
    const fromTok = stmt[idx]
    if (fromTok?.kind === 'word' && fromTok.upper === 'FROM') idx += 1
    else return { ok: false, reason: 'delete without from not supported' }
    const rest = stmt.slice(idx)
    const badMod = hasTopLevelWord(rest, WRITE_MODIFIERS)
    if (badMod) return { ok: false, reason: `${badMod.toLowerCase()} not supported in delete` }
    const whereRel = topLevelIndex(rest, 'WHERE')
    const tableTokens = whereRel >= 0 ? rest.slice(0, whereRel) : rest
    const whereTokens = whereRel >= 0 ? rest.slice(whereRel + 1) : null
    if (!validTableTarget(tableTokens)) return { ok: false, reason: 'invalid target in delete' }
    if (whereTokens && !whereTokens.length) return { ok: false, reason: 'empty where clause' }
    if (whereTokens) {
      const whereErr = validateExpression(whereTokens)
      if (whereErr) return { ok: false, reason: whereErr }
    }
    const tableSql = renderTokens(tableTokens)
    const whereSql = whereTokens ? ` WHERE ${renderTokens(whereTokens)}` : ''
    return {
      ok: true,
      plan: {
        kind: 'rows',
        countSql: `SELECT COUNT(*) AS count FROM ${tableSql}${whereSql}`,
        sampleSql: `SELECT * FROM ${tableSql}${whereSql} LIMIT ${SAMPLE_LIMIT}`
      }
    }
  }

  if (first.upper === 'INSERT') {
    if (stmt[1]?.kind !== 'word' || stmt[1].upper !== 'INTO') return { ok: false, reason: 'unsupported insert form' }
    const onIdx = topLevelIndex(stmt, 'ON', 2)
    if (onIdx >= 0) {
      const nextWord = stmt[onIdx + 1]
      if (nextWord?.kind === 'word' && (nextWord.upper === 'CONFLICT' || nextWord.upper === 'DUPLICATE')) {
        return { ok: false, reason: 'upsert not supported' }
      }
      return { ok: false, reason: 'insert clause not supported' }
    }
    if (topLevelIndex(stmt, 'RETURNING', 2) >= 0) return { ok: false, reason: 'returning not supported' }
    const valuesIdx = topLevelIndex(stmt, 'VALUES', 2)
    const selectIdx = topLevelIndex(stmt, 'SELECT', 2)
    if (valuesIdx >= 0) {
      const tupleGroupTokens = stmt.slice(valuesIdx + 1)
      if (!tupleGroupTokens.length) return { ok: false, reason: 'empty values' }
      const tuples = splitTopLevelCommas(tupleGroupTokens)
      for (const tuple of tuples) {
        if (tuple[0]?.kind !== 'punct' || tuple[0].raw !== '(' || tuple.at(-1)?.kind !== 'punct' || tuple.at(-1)?.raw !== ')') {
          return { ok: false, reason: 'invalid values tuple' }
        }
        const innerErr = validateExpression(tuple.slice(1, -1))
        if (innerErr) return { ok: false, reason: innerErr }
      }
      return { ok: true, plan: { kind: 'values', count: tuples.length } }
    }
    if (selectIdx >= 0) {
      const selectTokens = stmt.slice(selectIdx)
      if (topLevelIndex(selectTokens, 'INTO', 1) >= 0 || topLevelIndex(selectTokens, 'FOR', 1) >= 0) {
        return { ok: false, reason: 'unsafe insert select' }
      }
      const err = validateExpression(selectTokens, true)
      if (err) return { ok: false, reason: err }
      const selectSql = renderTokens(selectTokens)
      return {
        ok: true,
        plan: {
          kind: 'count-only',
          countSql: `SELECT COUNT(*) AS count FROM (${selectSql}) AS preview_rows`
        }
      }
    }
    return { ok: false, reason: 'unsupported insert form' }
  }

  return { ok: false, reason: `${first.upper.toLowerCase()} not supported` }
}

function readCountFromRows(rows: Array<Record<string, unknown>>): number {
  const first = rows[0]
  if (!first) return 0
  const raw = 'count' in first ? first.count : Object.values(first)[0]
  const num = Number(raw)
  return Number.isFinite(num) ? num : 0
}

function buildSqlSample(rows: Array<Record<string, unknown>>, assignments?: Map<string, ParsedAssignment>): DatabaseWritePreviewSample {
  const cols: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); cols.push(key) }
    }
  }
  const shapedRows = rows.slice(0, SAMPLE_LIMIT).map(row => cols.map(col => {
    if (isSecretColumn(col)) return MASKED_CELL
    const current = row[col]
    const assigned = assignments?.get(col.toLowerCase())
    if (!assigned) return current
    const nextVal = assigned.literalValue
    if (Object.is(current, nextVal)) return current
    return { old: current, new: nextVal }
  }))
  return { cols, rows: shapedRows }
}

function hasUnsafeMongoOperator(value: unknown, depth = 0): boolean {
  if (depth > 32 || !value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(item => hasUnsafeMongoOperator(item, depth + 1))
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '$where' || key === '$function' || key === '$accumulator') return true
    if (hasUnsafeMongoOperator(child, depth + 1)) return true
  }
  return false
}

const MONGO_SINGLE_OPS = new Set(['updateOne', 'replaceOne', 'deleteOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'])
const MONGO_MULTI_OPS = new Set(['updateMany', 'deleteMany'])

function computeMongoUpdatedDoc(doc: Record<string, unknown>, op: string, update?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (op === 'deleteOne' || op === 'deleteMany' || op === 'findOneAndDelete' || !update) return undefined
  const keys = Object.keys(update)
  const hasOperators = keys.some(key => key.startsWith('$'))
  if (!hasOperators) {
    const next: Record<string, unknown> = {}
    if ('_id' in doc) next._id = doc._id
    for (const [key, val] of Object.entries(update)) next[key] = val
    return next
  }
  const next: Record<string, unknown> = { ...doc }
  if (update.$set && typeof update.$set === 'object' && !Array.isArray(update.$set)) {
    Object.assign(next, update.$set as Record<string, unknown>)
  }
  if (update.$unset && typeof update.$unset === 'object' && !Array.isArray(update.$unset)) {
    for (const key of Object.keys(update.$unset as Record<string, unknown>)) next[key] = null
  }
  if (update.$inc && typeof update.$inc === 'object' && !Array.isArray(update.$inc)) {
    for (const [key, delta] of Object.entries(update.$inc as Record<string, unknown>)) {
      if (typeof delta === 'number') next[key] = (typeof next[key] === 'number' ? (next[key] as number) : 0) + delta
    }
  }
  return next
}

function buildMongoSample(docs: Array<Record<string, unknown>>, op: string, update?: Record<string, unknown>): DatabaseWritePreviewSample {
  const updatedDocs = docs.map(doc => computeMongoUpdatedDoc(doc, op, update))
  const cols: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < docs.length; i += 1) {
    for (const key of Object.keys(docs[i])) { if (!seen.has(key)) { seen.add(key); cols.push(key) } }
    const after = updatedDocs[i]
    if (after) {
      for (const key of Object.keys(after)) { if (!seen.has(key)) { seen.add(key); cols.push(key) } }
    }
  }
  const rows = docs.map((doc, idx) => {
    const after = updatedDocs[idx]
    return cols.map(col => {
      if (isSecretColumn(col)) return MASKED_CELL
      const beforeVal = doc[col]
      if (!after) return beforeVal
      const afterVal = after[col]
      if (Object.is(beforeVal, afterVal)) return beforeVal
      return { old: beforeVal, new: afterVal }
    })
  })
  return { cols, rows }
}

async function previewMongo(mongo: MongoWritePreviewSpec, env: string, driver: MongoPreviewDriver, productionCount?: boolean): Promise<DatabaseWritePreview> {
  const production = isProductionEnv(env)
  if (production && !productionCount) return { status: 'off-production', count: null }

  const op = mongo.op
  if (op === 'bulkWrite' || Boolean(mongo.upsert) || Boolean(mongo.options?.upsert)) {
    return { status: 'failed', count: null, reason: op === 'bulkWrite' ? 'bulkWrite not supported' : 'upsert not supported' }
  }
  if (hasUnsafeMongoOperator(mongo.filter) || hasUnsafeMongoOperator(mongo.update)) {
    return { status: 'failed', count: null, reason: 'unsafe mongo operator' }
  }
  if (op === 'insertOne') {
    return { status: production ? 'off-production' : 'ok', count: 1 }
  }
  if (op === 'insertMany') {
    const n = Array.isArray(mongo.documents) ? mongo.documents.length : 0
    return { status: production ? 'off-production' : 'ok', count: n }
  }
  const single = MONGO_SINGLE_OPS.has(op)
  const multi = MONGO_MULTI_OPS.has(op)
  if (!single && !multi) {
    return { status: 'failed', count: null, reason: `unsupported mongo op ${op}` }
  }

  const filter = mongo.filter ?? {}
  const options = { maxTimeMS: PREVIEW_TIMEOUT_MS }
  try {
    const rawCount = await driver.countDocuments(mongo.collection, filter, options)
    const count = single ? Math.min(rawCount, 1) : rawCount
    if (production) return { status: 'off-production', count }
    const docs = await driver.find(mongo.collection, filter, SAMPLE_LIMIT, options)
    const sampleDocs = single ? docs.slice(0, 1) : docs.slice(0, SAMPLE_LIMIT)
    return { status: 'ok', count, sample: buildMongoSample(sampleDocs, op, mongo.update) }
  } catch (error) {
    return { status: 'failed', count: null, reason: isTimeoutError(error) ? 'timeout' : 'error' }
  }
}

export async function previewDatabaseWrite(input: DatabaseWritePreviewInput): Promise<DatabaseWritePreview> {
  if (input.mongo) {
    if (!('countDocuments' in input.driver)) return { status: 'failed', count: null, reason: 'incompatible driver' }
    return previewMongo(input.mongo, input.env, input.driver, input.productionCount)
  }

  const production = isProductionEnv(input.env)
  if (production && !input.productionCount) {
    return { status: 'off-production', count: null }
  }

  if (typeof input.text !== 'string' || !input.text.trim()) {
    return { status: 'failed', count: null, reason: 'empty statement' }
  }
  if (!('query' in input.driver)) {
    return { status: 'failed', count: null, reason: 'incompatible driver' }
  }

  const translated = translateSql(input.text)
  if (!translated.ok) {
    return { status: 'failed', count: null, reason: translated.reason }
  }

  const plan = translated.plan
  if (plan.kind === 'values') {
    return { status: production ? 'off-production' : 'ok', count: plan.count }
  }

  const queryOptions: PreviewQueryOptions = { readOnly: true, timeoutMs: PREVIEW_TIMEOUT_MS }
  try {
    const countResult = await input.driver.query(plan.countSql, queryOptions)
    const count = readCountFromRows(countResult.rows)
    if (production || plan.kind === 'count-only') {
      return { status: production ? 'off-production' : 'ok', count }
    }
    const sampleResult = await input.driver.query(plan.sampleSql, queryOptions)
    return { status: 'ok', count, sample: buildSqlSample(sampleResult.rows, plan.assignments) }
  } catch (error) {
    return { status: 'failed', count: null, reason: isTimeoutError(error) ? 'timeout' : 'error' }
  }
}
