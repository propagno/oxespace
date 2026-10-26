import { connectionHint } from './connect-hint'
import { createHash } from 'node:crypto'
import { Client } from 'pg'
import Cursor from 'pg-cursor'
import { MongoClient, type Document } from 'mongodb'
import type {
  ConnectionTestResult, MongoWriteInput, MongoWriteResult, SqlApplyInput, SqlApplyResult, SqlEditability, MongoAggregateInput, MongoCollectionInfo, MongoDatabaseInfo, MongoFindInput, MongoIndexInfo, MongoResult,
  SqlBrowseInput, SqlColumn, SqlResult, SqlTable, SqlTableDetails, SqlConstraintInfo, SqlObjects, SqlTypeInfo, SqlDatabaseInfo, SqlRoleInfo, SqlExtensionInfo, SqlSearchResult, SqlSearchHit,SqlTables, ScriptStatementResult, SqlScriptResult
} from '../../../../shared/types/oxequery'
import { guardSql, isMutating, quoteIdentifier, tokenizeStatements } from './sql-guard'
import { buildFilterClause } from './filter-clause'
import { maintenanceStatement, planStructure } from './ddl-builder'
import type { MaintenanceAction, StructureInput, StructurePlan, StructureResult } from '../../../../shared/types/oxequery-structure'
import { splitStatements } from '../../../../shared/sqlText'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { mongoTlsOptions, mongoUri, pgSsl, type Endpoint } from './connection-options'
import { openTunnel, tunnelAvailable, type OpenTunnel } from './ssh-tunnel'
import { editableEjson, parseDocument, parseEditableDocument, parsePipeline, parseUpdate, parseValidator, toEjson } from './mongo-guard'
import { summarizeExplain } from './mongo-explain'
import { EJSON } from 'bson'
import { buildStatements, previewStatements, type ColumnMeta, type RowChange } from './table-editor'
import { createSink } from './export-writer'
import { createXlsxSink } from './xlsx-writer'
import { parsePlan, planHints } from './plan-parser'
import { inferSchema } from './mongo-schema'
import type { MongoBulkInput, MongoBulkResult, MongoCollectionAction, MongoExplainInput, MongoExplainSummary, MongoSchema, MongoStats, MongoValidation, SqlDefinitionTarget, SqlFunctionInfo } from '../../../../shared/types/oxequery'
import type { SqlExplain } from '../../../../shared/types/oxequery'
import { describeFile, openRejects, readRecords, type ImportFormat, type ImportOptions } from './import-reader'
import type { ImportConflict } from '../../../../shared/types/oxequery'
import type { ImportTarget } from '../../../../shared/types/oxequery'
import type { ExportFormat, ExportSource } from '../../../../shared/types/oxequery'
import { cancelOperation, runTagged, type MongoOperation } from './mongo-cancel'

const DEFAULT_ROWS = 500
const MAX_ROWS = 100_000
const MAX_CELL = 64 * 1024
const CONNECT_TIMEOUT_MS = 8000
const STATEMENT_TIMEOUT_MS = 60_000
const MAX_DOCUMENTS = 1000

const TYPE_NAMES: Record<number, string> = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2', 23: 'int4', 25: 'text', 26: 'oid', 114: 'json', 142: 'xml', 650: 'cidr',
  700: 'float4', 701: 'float8', 829: 'macaddr', 869: 'inet', 1000: 'bool[]', 1007: 'int4[]', 1009: 'text[]', 1015: 'varchar[]', 1042: 'bpchar', 1043: 'varchar',
  1082: 'date', 1083: 'time', 1114: 'timestamp', 1184: 'timestamptz', 1186: 'interval', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb', 3807: 'jsonb[]'
}

/** Removes the password (and URL-encoded form) from anything shown to a person. */
export function redact(message: string, ...secrets: (string | undefined)[]): string {
  let result = message
  for (const secret of secrets) {
    if (!secret || secret.length < 3) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) result = result.split(form).join('***')
  }
  return result.slice(0, 600)
}

/** A result larger than this is cut, whatever the row limit says: it travels through two processes to a web page. */
export const MAX_RESULT_BYTES = 32 * 1024 * 1024

/** Rows up to a size budget (an estimate: text length, 8 bytes for a number); reports whether it cut. */
export function capRowsByBytes(rows: unknown[][], maxBytes = MAX_RESULT_BYTES): { rows: unknown[][]; cut: boolean } {
  let used = 0
  for (let index = 0; index < rows.length; index++) {
    for (const value of rows[index]) used += typeof value === 'string' ? value.length : value === null ? 1 : 8
    if (used > maxBytes) return { rows: rows.slice(0, Math.max(1, index)), cut: true }
  }
  return { rows, cut: false }
}

export function cell(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value.length > MAX_CELL ? `${value.slice(0, MAX_CELL)}… (truncated)` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (Buffer.isBuffer(value)) return `\\x${value.subarray(0, 64).toString('hex')}${value.length > 64 ? `… (${value.length} bytes)` : ''}`
  try {
    const text = JSON.stringify(value)
    return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}… (truncated)` : text
  } catch { return String(value) }
}

/** The names in an array cell: `cell` turns an array into JSON text, and a server may also send the raw `{a,b}` form. */
export function nameList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string' || value === '') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch { /* not JSON: the raw array form */ }
  return value.replace(/^\{|\}$/g, '').split(',').map(name => name.replace(/^"|"$/g, '').trim()).filter(Boolean)
}

/** A Mongo value as a flat cell: ObjectId and dates unwrap, everything else stays JSON. */
function mongoCell(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  const plain = EJSON.serialize(value as never, { relaxed: true }) as unknown
  if (plain && typeof plain === 'object') {
    const record = plain as Record<string, unknown>
    if (typeof record.$oid === 'string') return record.$oid
    if (typeof record.$date === 'string') return record.$date
    if (record.$numberLong !== undefined) return String(record.$numberLong)
  }
  return plain
}

function clampRows(value: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(value ?? DEFAULT_ROWS) || DEFAULT_ROWS, MAX_ROWS))
}

/** Everything that changes how a session is built; a change reopens it. */
function sessionKey(connection: ResolvedConnection): string {
  return createHash('sha256').update(JSON.stringify([
    connection.engine, connection.host, connection.port, connection.database, connection.username, connection.password ?? '', connection.sslMode, connection.readOnly,
    connection.tls ?? null, connection.mongo ?? null, connection.ssh ?? null, connection.statementTimeoutMs ?? null
  ])).digest('hex')
}

/** open: a transaction the person began; failed: a statement in it failed, so only ROLLBACK is accepted. */
type TxState = 'none' | 'open' | 'failed'
interface PgSession { key: string; client: Client; running: boolean; lastUsed: number; endpoint: Endpoint; tunnel?: OpenTunnel; tx: TxState; txStatements: number; txSince?: number }
interface MongoSession { key: string; client: MongoClient; lastUsed: number; tunnel?: OpenTunnel; /** The running find or aggregate, so it can be stopped. */ operation?: MongoOperation }

/** A connection nobody used for this long is closed; it reopens on the next request. */
const withConnectionHint = (message: string, connection: ResolvedConnection): string => `${message}${connectionHint(message, connection)}`

/** How many tables of one schema are listed; the tree says so when there are more. */
const MAX_TABLES_LISTED = 20_000
/** A script this long is a migration, not a query tab. */
const MAX_SCRIPT_STATEMENTS = 500
const IDLE_MS = 10 * 60_000
const MAX_SESSIONS = 12
/** How long a catalog read waits for the query that is using the connection. */
const META_WAIT_MS = 10_000

/**
 * The database drivers. It runs inside the OxeQuery worker, so a slow or broken
 * connection can never block the main process; tests drive it directly.
 */
export class OxeQueryCore {
  private readonly pg = new Map<string, PgSession>()
  private readonly mongo = new Map<string, MongoSession>()
  private readonly reaper: ReturnType<typeof setInterval>

  constructor() {
    this.reaper = setInterval(() => void this.reapIdle(), 60_000)
    this.reaper.unref?.()
  }

  /** Closes sessions idle past the limit, and the least recently used one when too many are open. */
  async reapIdle(now = Date.now()): Promise<number> {
    const sessions = [
      ...[...this.pg].filter(([, session]) => !session.running && session.tx === 'none').map(([id, session]) => ({ id, lastUsed: session.lastUsed })),
      ...[...this.mongo].map(([id, session]) => ({ id, lastUsed: session.lastUsed }))
    ].sort((a, b) => a.lastUsed - b.lastUsed)
    const total = new Set([...this.pg.keys(), ...this.mongo.keys()]).size
    const stale = sessions.filter(session => now - session.lastUsed > IDLE_MS).map(session => session.id)
    const surplus = total > MAX_SESSIONS ? sessions.filter(session => !stale.includes(session.id)).slice(0, total - MAX_SESSIONS).map(session => session.id) : []
    const closing = [...new Set([...stale, ...surplus])]
    await Promise.allSettled(closing.map(id => this.closeConnection(id)))
    return closing.length
  }

  // ---- Postgres -----------------------------------------------------------

  private timeoutOf(connection: ResolvedConnection): number {
    return connection.statementTimeoutMs ?? STATEMENT_TIMEOUT_MS
  }

  /** The address to dial: the server itself, or the local end of its SSH tunnel. */
  private async reach(connection: ResolvedConnection): Promise<{ endpoint: Endpoint; tunnel?: OpenTunnel }> {
    if (!connection.ssh) return { endpoint: { host: connection.host, port: connection.port } }
    const keepalive = connection.keepaliveSeconds
    const tunnel = await openTunnel(connection.ssh, { host: connection.host, port: connection.port }, keepalive === undefined ? {} : { keepaliveMs: keepalive * 1000 })
    return { endpoint: tunnel.endpoint, tunnel }
  }

  private pgConfig(connection: ResolvedConnection, endpoint: Endpoint) {
    const timeout = this.timeoutOf(connection)
    return {
      host: endpoint.host, port: endpoint.port, database: connection.database || 'postgres', user: connection.username || undefined, password: connection.password,
      ssl: pgSsl(connection),
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: timeout, query_timeout: timeout + 5000,
      application_name: 'OxeQuery',
      // TCP keep-alive keeps a quiet connection from being dropped by a firewall or a load balancer.
      keepAlive: (connection.keepaliveSeconds ?? 30) > 0, keepAliveInitialDelayMillis: (connection.keepaliveSeconds ?? 30) * 1000
    }
  }

  private async pgSession(connection: ResolvedConnection): Promise<PgSession> {
    const key = sessionKey(connection)
    const existing = this.pg.get(connection.id)
    if (existing?.key === key) { existing.lastUsed = Date.now(); return existing }
    if (existing) await this.closeConnection(connection.id)
    const { endpoint, tunnel } = await this.reach(connection)
    // An 'error' event with no listener would crash the worker; the session's own listener is added below.
    const quiet = (candidate: Client): Client => { candidate.on('error', () => undefined); return candidate }
    let client = quiet(new Client(this.pgConfig(connection, endpoint)))
    try {
      try { await client.connect() } catch (error) {
        // "prefer" tries TLS first; a server without TLS says so, and gets a plain connection like libpq gives it.
        if (connection.sslMode !== 'prefer' || !/does not support SSL|SSL is not enabled|SSL not supported/i.test(error instanceof Error ? error.message : '')) throw error
        client = quiet(new Client({ ...this.pgConfig(connection, endpoint), ssl: false }))
        await client.connect()
      }
    } catch (error) {
      await tunnel?.close()
      throw new OxeQueryError('connect', withConnectionHint(redact(error instanceof Error ? error.message : 'Connection failed', connection.password, connection.ssh?.password, connection.ssh?.passphrase), connection))
    }
    client.on('error', () => { if (this.pg.get(connection.id)?.client === client) { this.pg.delete(connection.id); void tunnel?.close() } })
    const session: PgSession = { key, client, running: false, lastUsed: Date.now(), endpoint, tx: 'none', txStatements: 0, ...(tunnel ? { tunnel } : {}) }
    // A tunnel that drops under a live session would leave a client talking to nothing.
    tunnel?.onClose(() => { if (this.pg.get(connection.id) === session) this.pg.delete(connection.id) })
    this.pg.set(connection.id, session)
    return session
  }

  /**
   * Catalog reads for the tree and autocomplete share the connection with the user's query.
   * They wait for it instead of failing with "already running", so the tree does not go
   * empty (and stay empty) whenever a long statement is in flight.
   */
  private pgMeta(connection: ResolvedConnection, sql: string, params: unknown[], maxRows: number, readOnly: boolean): Promise<SqlResult> {
    return this.pgRun(connection, sql, params, maxRows, readOnly, META_WAIT_MS)
  }

  private async pgRun(connection: ResolvedConnection, sql: string, params: unknown[], maxRows: number, readOnly: boolean, waitMs = 0): Promise<SqlResult> {
    const session = await this.pgSession(connection)
    for (const deadline = Date.now() + waitMs; session.running && Date.now() < deadline;) await new Promise(resolve => setTimeout(resolve, 50))
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    session.running = true
    const started = Date.now()
    const { client } = session
    const notices: string[] = []
    const onNotice = (notice: { message?: string }): void => { if (notices.length < 20 && notice.message) notices.push(notice.message.slice(0, 500)) }
    client.on('notice', onNotice)
    // A transaction the person opened is theirs to end: no wrapper of ours around its statements.
    const manual = session.tx !== 'none'
    try {
      if (readOnly && !manual) await client.query('BEGIN READ ONLY')
      const verdict = guardSql(sql)
      if (session.tx === 'failed' && !/^\s*(ROLLBACK|ABORT)\b/i.test(sql)) {
        throw new OxeQueryError('invalid', 'The transaction failed. Roll it back before running anything else.')
      }
      let result: SqlResult
      if (verdict.statements > 1 && params.length === 0) {
        // Several statements need the simple protocol; results are capped afterwards.
        const raw = await client.query({ text: sql, rowMode: 'array' })
        const last = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as { fields?: { name: string; dataTypeID: number }[]; rows?: unknown[][]; command?: string; rowCount?: number | null } | undefined
        const rows = (last?.rows ?? []).slice(0, maxRows + 1)
        const capped = capRowsByBytes(rows.slice(0, maxRows).map(row => row.map(cell)))
        result = {
          columns: (last?.fields ?? []).map((field): SqlColumn => ({ name: field.name, type: TYPE_NAMES[field.dataTypeID] ?? `oid:${field.dataTypeID}` })),
          rows: capped.rows, rowCount: capped.rows.length, truncated: rows.length > maxRows || capped.cut, ...(capped.cut ? { limitedBy: 'bytes' as const } : rows.length > maxRows ? { limitedBy: 'rows' as const } : {}),
          durationMs: 0, ...(last?.command ? { command: last.command } : {}), ...(typeof last?.rowCount === 'number' ? { affectedRows: last.rowCount } : {})
        }
      } else {
        const cursor = client.query(new Cursor(sql, params, { rowMode: 'array' }))
        const read = (count: number): Promise<{ rows: unknown[][]; result: { fields?: { name: string; dataTypeID: number }[]; command?: string; rowCount?: number | null } }> =>
          new Promise((resolve, reject) => cursor.read(count, (error, rows, outcome) => error ? reject(error) : resolve({ rows: rows as unknown[][], result: outcome as never })))
        try {
          const { rows, result: outcome } = await read(maxRows + 1)
          const capped = capRowsByBytes(rows.slice(0, maxRows).map(row => row.map(cell)))
          result = {
            columns: (outcome.fields ?? []).map((field): SqlColumn => ({ name: field.name, type: TYPE_NAMES[field.dataTypeID] ?? `oid:${field.dataTypeID}` })),
            rows: capped.rows, rowCount: capped.rows.length, truncated: rows.length > maxRows || capped.cut, ...(capped.cut ? { limitedBy: 'bytes' as const } : rows.length > maxRows ? { limitedBy: 'rows' as const } : {}), durationMs: 0,
            ...(outcome.command ? { command: outcome.command } : {}), ...(typeof outcome.rowCount === 'number' && outcome.command !== 'SELECT' ? { affectedRows: outcome.rowCount } : {})
          }
        } finally {
          await new Promise<void>(resolve => cursor.close(() => resolve()))
        }
      }
      this.trackTransaction(session, sql)
      return { ...result, durationMs: Date.now() - started, ...(notices.length ? { notices } : {}) }
    } catch (error) {
      if (session.tx === 'open') session.tx = 'failed'
      if (error instanceof OxeQueryError) throw error
      const message = error instanceof Error ? error.message : 'Query failed'
      if (/canceling statement due to user request/i.test(message)) throw new OxeQueryError('cancelled', 'The query was cancelled.')
      if (/statement timeout/i.test(message)) throw new OxeQueryError('timeout', `The query ran longer than ${Math.round(this.timeoutOf(connection) / 1000)}s and was stopped.`)
      const server = error as { position?: string; code?: string; hint?: string }
      const position = Number(server.position)
      throw new OxeQueryError('query', redact(message, connection.password), [], {
        ...(Number.isInteger(position) && position > 0 ? { position } : {}),
        ...(typeof server.code === 'string' && /^[0-9A-Z]{5}$/.test(server.code) ? { sqlState: server.code } : {}),
        ...(typeof server.hint === 'string' && server.hint ? { hint: redact(server.hint, connection.password).slice(0, 300) } : {})
      })
    } finally {
      client.off('notice', onNotice)
      if (readOnly && !manual) await client.query('ROLLBACK').catch(() => undefined)
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  /** Keeps the transaction flag in step with BEGIN, COMMIT and ROLLBACK, however they were issued. */
  private trackTransaction(session: PgSession, sql: string): void {
    const words = tokenizeStatements(sql)
    for (const statement of words) {
      const [first, second] = statement
      if (first === 'BEGIN' || (first === 'START' && second === 'TRANSACTION')) { if (session.tx === 'none') { session.tx = 'open'; session.txStatements = 0; session.txSince = Date.now() } }
      else if (first === 'COMMIT' || first === 'END' || first === 'ABORT' || (first === 'ROLLBACK' && second !== 'TO' && statement[2] !== 'SAVEPOINT')) { session.tx = 'none'; session.txStatements = 0; delete session.txSince }
      else if (session.tx === 'open') session.txStatements++
    }
  }

  /** The transaction of one connection, for the toolbar. */
  txState(connection: ResolvedConnection): { state: TxState; statements: number; since?: number } {
    const session = this.pg.get(connection.id)
    return session ? { state: session.tx, statements: session.txStatements, ...(session.txSince ? { since: session.txSince } : {}) } : { state: 'none', statements: 0 }
  }

  /** Opens, commits or rolls back the transaction of a connection; SQL the person types does the same through `trackTransaction`. */
  async sqlTx(connection: ResolvedConnection, action: 'begin' | 'commit' | 'rollback'): Promise<{ state: TxState; statements: number; since?: number }> {
    if (action === 'begin') {
      if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only, so there is nothing to commit. Turn read-only off to work in a transaction.')
      const session = await this.pgSession(connection)
      if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is already open on this connection.')
      await this.pgRun(connection, 'BEGIN', [], 1, false)
    } else {
      const session = this.pg.get(connection.id)
      if (!session || session.tx === 'none') throw new OxeQueryError('invalid', 'There is no open transaction on this connection.')
      await this.pgRun(connection, action === 'commit' ? 'COMMIT' : 'ROLLBACK', [], 1, false)
    }
    return this.txState(connection)
  }

  /** The statement's own checks: empty, read-only, destructive. Throws when it may not run. */
  private checkStatement(connection: ResolvedConnection, sql: string, confirmed: boolean | undefined): void {
    if (typeof sql !== 'string' || sql.length > 1024 * 1024) throw new OxeQueryError('invalid', 'The SQL is empty or too large.')
    const verdict = guardSql(sql)
    if (verdict.kind === 'empty') throw new OxeQueryError('invalid', 'There is nothing to run.')
    if (connection.readOnly && isMutating(verdict)) {
      throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to run statements that change data.', verdict.reasons)
    }
    if (verdict.kind === 'destructive' && !confirmed) {
      throw new OxeQueryError('confirm', 'This statement is destructive and needs confirmation.', verdict.reasons)
    }
  }

  async sqlRun(connection: ResolvedConnection, sql: string, options: { maxRows?: number; confirmed?: boolean; params?: (string | null)[] } = {}): Promise<SqlResult> {
    this.checkStatement(connection, sql, options.confirmed)
    const params = options.params ?? []
    if (params.length > 0 && guardSql(sql).statements > 1) throw new OxeQueryError('invalid', 'Parameters work with one statement at a time.')
    return this.pgRun(connection, sql, params, clampRows(options.maxRows ?? connection.maxRows), connection.readOnly)
  }

  /**
   * Runs a script statement by statement, each on its own, and stops at the first failure. Everything is
   * checked before the first one runs, so a read-only connection or an unconfirmed DROP in the middle
   * does not leave half a script behind.
   */
  async sqlScript(connection: ResolvedConnection, sql: string, options: { maxRows?: number; confirmed?: boolean } = {}): Promise<SqlScriptResult> {
    if (typeof sql !== 'string' || sql.length > 1024 * 1024) throw new OxeQueryError('invalid', 'The SQL is empty or too large.')
    const spans = splitStatements(sql)
    if (spans.length === 0) throw new OxeQueryError('invalid', 'There is nothing to run.')
    if (spans.length > MAX_SCRIPT_STATEMENTS) throw new OxeQueryError('invalid', `A script can have up to ${MAX_SCRIPT_STATEMENTS} statements.`)
    const reasons = new Set<string>()
    for (const span of spans) {
      try { this.checkStatement(connection, span.text, options.confirmed) } catch (error) {
        if (error instanceof OxeQueryError && error.code === 'confirm') { for (const reason of error.reasons) reasons.add(reason); continue }
        throw error
      }
    }
    if (reasons.size) throw new OxeQueryError('confirm', 'This script has destructive statements and needs confirmation.', [...reasons])
    const statements: ScriptStatementResult[] = []
    const maxRows = clampRows(options.maxRows ?? connection.maxRows)
    for (const [index, span] of spans.entries()) {
      const entry: ScriptStatementResult = { index, start: span.start, end: span.end, sql: span.text.slice(0, 200) }
      try { entry.result = await this.pgRun(connection, span.text, [], maxRows, connection.readOnly) } catch (error) {
        const failure = error instanceof OxeQueryError ? error : new OxeQueryError('query', error instanceof Error ? error.message : 'Statement failed')
        entry.error = { code: failure.code, message: failure.message, ...failure.detail }
        statements.push(entry)
        return { statements, stoppedAt: index }
      }
      statements.push(entry)
    }
    return { statements }
  }

  async sqlBrowse(connection: ResolvedConnection, input: SqlBrowseInput): Promise<SqlResult> {
    const limit = clampRows(input.limit ?? Math.min(100, connection.maxRows ?? 100))
    const offset = Math.max(0, Math.min(Math.trunc(input.offset ?? 0) || 0, 10_000_000))
    const order = input.orderBy ? ` ORDER BY ${quoteIdentifier(input.orderBy.column)} ${input.orderBy.direction === 'desc' ? 'DESC' : 'ASC'}` : ''
    const { where, params } = buildFilterClause(input.filters ?? [])
    const table = `${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)}`
    const sql = `SELECT * FROM ${table}${where}${order} LIMIT ${limit + 1} OFFSET ${offset}`
    const result = await this.pgMeta(connection, sql, params, limit, true)
    if (params.length === 0 && !where) return result
    // A filter changes how many rows there are, so the page says how many match (a slow count is not worth failing for).
    try {
      const counted = await this.pgMeta(connection, `SELECT count(*) FROM ${table}${where}`, params, 1, true)
      return { ...result, totalRows: Number(counted.rows[0]?.[0] ?? 0) }
    } catch { return result }
  }

  async sqlSchemas(connection: ResolvedConnection): Promise<string[]> {
    const result = await this.pgMeta(connection, `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'
      ORDER BY (nspname = 'public') DESC, (nspname IN ('pg_catalog', 'information_schema')), nspname`, [], 500, true)
    return result.rows.map(row => String(row[0]))
  }

  async sqlTables(connection: ResolvedConnection, schema: string): Promise<SqlTables> {
    const result = await this.pgMeta(connection, `SELECT c.relname, c.relkind, c.reltuples::bigint, count(*) OVER () FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'f', 'p') ORDER BY c.relname LIMIT ${MAX_TABLES_LISTED}`, [schema], MAX_TABLES_LISTED, true)
    const kinds: Record<string, SqlTable['kind']> = { r: 'table', v: 'view', m: 'materialized view', f: 'foreign table', p: 'partitioned table' }
    const tables = result.rows.map(row => ({ schema, name: String(row[0]), kind: kinds[String(row[1])] ?? 'table', ...(Number(row[2]) >= 0 ? { approxRows: Number(row[2]) } : {}) }))
    return { tables, total: result.rows.length ? Number(result.rows[0][3]) : 0 }
  }

  async sqlTable(connection: ResolvedConnection, schema: string, table: string): Promise<SqlTableDetails> {
    const oid = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2)`
    const columns = await this.pgMeta(connection, `SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
        COALESCE(a.attnum = ANY (SELECT unnest(i.indkey) FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary), false), a.attnum,
        a.attidentity, a.attgenerated, col_description(a.attrelid, a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ${oid} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, table], 2000, true)
    const indexes = await this.pgMeta(connection, `SELECT ic.relname, pg_get_indexdef(i.indexrelid), i.indisunique, i.indisprimary
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = ${oid} ORDER BY ic.relname`, [schema, table], 500, true)
    const foreign = await this.pgMeta(connection, `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ${oid} AND contype = 'f' ORDER BY conname`, [schema, table], 500, true)
    const constraints = await this.pgMeta(connection, `SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ${oid} AND contype IN ('p', 'u', 'c', 'x') ORDER BY contype, conname`, [schema, table], 500, true)
    const properties = await this.pgMeta(connection, `SELECT c.relkind, pg_get_userbyid(c.relowner), obj_description(c.oid, 'pg_class'), pg_total_relation_size(c.oid), c.reltuples::bigint
      FROM pg_class c WHERE c.oid = ${oid}`, [schema, table], 1, true)
    const dependents = await this.pgMeta(connection, `SELECT DISTINCT kind, schema, name FROM (
        SELECT 'foreign key' AS kind, n.nspname AS schema, c.relname AS name FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE k.contype = 'f' AND k.confrelid = ${oid} AND k.conrelid <> k.confrelid
        UNION ALL
        SELECT 'view', n.nspname, v.relname FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class JOIN pg_namespace n ON n.oid = v.relnamespace
          WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = ${oid} AND v.oid <> d.refobjid
      ) found ORDER BY kind, schema, name LIMIT 200`, [schema, table], 200, true)
    const privileges = await this.pgMeta(connection, `SELECT CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type, a.is_grantable
      FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a WHERE c.oid = ${oid} ORDER BY 1, 2`, [schema, table], 500, true)
    const kinds: Record<string, SqlConstraintInfo['kind']> = { p: 'primary', u: 'unique', c: 'check', x: 'exclusion' }
    const relkinds: Record<string, string> = { r: 'table', v: 'view', m: 'materialized view', f: 'foreign table', p: 'partitioned table' }
    const props = properties.rows[0]
    return {
      columns: columns.rows.map(row => ({
        name: String(row[0]), type: String(row[1]), nullable: Boolean(row[2]), ...(row[3] && row[7] !== 's' ? { default: String(row[3]) } : {}), primaryKey: Boolean(row[4]), position: Number(row[5]),
        ...(row[6] === 'a' ? { identity: 'always' as const } : row[6] === 'd' ? { identity: 'by-default' as const } : {}),
        ...(row[7] === 's' && row[3] ? { generated: String(row[3]) } : {}), ...(row[8] ? { comment: String(row[8]) } : {})
      })),
      indexes: indexes.rows.map(row => ({ name: String(row[0]), definition: String(row[1]), unique: Boolean(row[2]), primary: Boolean(row[3]) })),
      foreignKeys: foreign.rows.map(row => ({ name: String(row[0]), definition: String(row[1]) })),
      constraints: constraints.rows.map(row => ({ name: String(row[0]), kind: kinds[String(row[1])] ?? 'check', definition: String(row[2]) })),
      dependents: dependents.rows.map(row => ({ kind: String(row[0]) as 'foreign key' | 'view', schema: String(row[1]), name: String(row[2]) })),
      privileges: privileges.rows.map(row => ({ grantee: String(row[0]), privilege: String(row[1]), grantable: Boolean(row[2]) })),
      properties: props ? { kind: relkinds[String(props[0])] ?? String(props[0]), owner: String(props[1]), ...(props[2] ? { comment: String(props[2]) } : {}), sizeBytes: Number(props[3]), estimatedRows: Math.max(0, Number(props[4])) } : null
    }
  }

  /** Cancels the statement a connection is running by asking the server from a second session. */
  async sqlCancel(connection: ResolvedConnection): Promise<boolean> {
    const session = this.pg.get(connection.id)
    if (!session?.running) return false
    const pid = (session.client as unknown as { processID?: number }).processID
    if (!pid) return false
    const killer = new Client(this.pgConfig(connection, session.endpoint))
    try {
      await killer.connect()
      await killer.query('SELECT pg_cancel_backend($1)', [pid])
      return true
    } catch { return false } finally { await killer.end().catch(() => undefined) }
  }

  // ---- PostgreSQL editing -------------------------------------------------

  /** Columns and the key used to find a row. A table with neither a primary key nor a unique NOT NULL index is not editable. */
  private async columnMeta(connection: ResolvedConnection, schema: string, table: string): Promise<{ columns: ColumnMeta[]; kind: string | null }> {
    const target = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2)`
    const kind = await this.pgMeta(connection, `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`, [schema, table], 1, true)
    const relkind = kind.rows[0] ? String(kind.rows[0][0]) : null
    const columns = await this.pgMeta(connection, `SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.atthasdef,
        (a.attgenerated <> '' OR a.attidentity = 'a') AS generated
      FROM pg_attribute a WHERE a.attrelid = ${target} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, table], 2000, true)
    const primary = await this.pgMeta(connection, `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = ${target} AND i.indisprimary`, [schema, table], 64, true)
    let keyNames = primary.rows.map(row => String(row[0]))
    if (keyNames.length === 0) {
      const unique = await this.pgMeta(connection, `SELECT array_agg(a.attname ORDER BY a.attnum)::text[] FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = ${target} AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
        GROUP BY i.indexrelid HAVING bool_and(a.attnotnull) ORDER BY count(*), i.indexrelid LIMIT 1`, [schema, table], 1, true)
      keyNames = nameList(unique.rows[0]?.[0])
    }
    return {
      kind: relkind,
      columns: columns.rows.map(row => ({ name: String(row[0]), type: String(row[1]), nullable: !row[2], hasDefault: Boolean(row[3]), generated: Boolean(row[4]), key: keyNames.includes(String(row[0])) }))
    }
  }

  async sqlEditability(connection: ResolvedConnection, schema: string, table: string): Promise<SqlEditability> {
    const { columns, kind } = await this.columnMeta(connection, schema, table)
    const base = { columns }
    if (connection.readOnly) return { editable: false, reason: 'This connection is read-only. Turn read-only off to edit data.', ...base }
    if (kind !== 'r' && kind !== 'p') return { editable: false, reason: 'Only tables can be edited, not views or foreign tables.', ...base }
    if (!columns.some(column => column.key)) return { editable: false, reason: 'This table has no primary key or unique NOT NULL index, so a row cannot be identified safely.', ...base }
    return { editable: true, ...base }
  }

  async sqlPreviewChanges(connection: ResolvedConnection, input: Pick<SqlApplyInput, 'schema' | 'table' | 'changes'>): Promise<string[]> {
    const { columns } = await this.columnMeta(connection, input.schema, input.table)
    return previewStatements(buildStatements(input.schema, input.table, columns, input.changes as RowChange[]))
  }

  /**
   * Applies the changes in one transaction. Each statement must affect exactly one
   * row; anything else (the row changed, or vanished) rolls everything back.
   */
  async sqlApply(connection: ResolvedConnection, input: Pick<SqlApplyInput, 'schema' | 'table' | 'changes'>): Promise<SqlApplyResult> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change data.')
    const editable = await this.sqlEditability({ ...connection, readOnly: false }, input.schema, input.table)
    if (!editable.editable) throw new OxeQueryError('invalid', editable.reason ?? 'This table cannot be edited.')
    const statements = buildStatements(input.schema, input.table, editable.columns, input.changes as RowChange[])
    const session = await this.pgSession(connection)
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
    session.running = true
    const { client } = session
    try {
      await client.query('BEGIN')
      try {
        for (const [index, statement] of statements.entries()) {
          const result = await client.query({ text: statement.text, values: statement.values })
          if (statement.expectRows !== null && result.rowCount !== statement.expectRows) {
            throw new OxeQueryError('conflict', `Change ${index + 1} (${statement.summary}) matched ${result.rowCount ?? 0} rows instead of 1. The row was changed or removed by someone else, so nothing was saved. Reload the table and try again.`)
          }
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
      return { applied: statements.length, statements: previewStatements(statements) }
    } catch (error) {
      if (error instanceof OxeQueryError) throw error
      const message = error instanceof Error ? error.message : 'The change failed'
      throw new OxeQueryError('query', redact(message, connection.password))
    } finally {
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  /** The DDL a structure action would run, without running it. */
  structurePreview(_connection: ResolvedConnection, input: Pick<StructureInput, 'schema' | 'table' | 'action'>): StructurePlan {
    return planStructure(input.schema, input.table, input.action)
  }

  /**
   * Runs a structure action in one transaction (PostgreSQL DDL is transactional): the first failing
   * statement rolls everything back. Destructive plans need `confirmed`, and a production connection
   * counts any structure change as one.
   */
  async structureApply(connection: ResolvedConnection, input: Pick<StructureInput, 'schema' | 'table' | 'action' | 'confirmed'>): Promise<StructureResult> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change the structure.')
    const copyColumns = input.action.kind === 'duplicate' && input.action.withData ? await this.writableColumns(connection, input.schema, input.table) : undefined
    const plan = planStructure(input.schema, input.table, input.action, copyColumns)
    if ((plan.destructive || connection.environment === 'prod') && !input.confirmed) {
      throw new OxeQueryError('confirm', plan.destructive ? 'This change cannot be undone and needs confirmation.' : 'This is a production connection: confirm the structure change.', plan.warnings)
    }
    const session = await this.pgSession(connection)
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
    session.running = true
    const started = Date.now()
    const { client } = session
    try {
      await client.query('BEGIN')
      try {
        for (const statement of plan.statements) await client.query(statement)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      }
      return { ...plan, applied: true, durationMs: Date.now() - started }
    } catch (error) {
      if (error instanceof OxeQueryError) throw error
      const pg = error as { message?: string; code?: string; hint?: string }
      throw new OxeQueryError('query', redact(pg.message ?? 'The change failed', connection.password), [], {
        ...(pg.code ? { sqlState: pg.code } : {}), ...(pg.hint ? { hint: pg.hint } : {})
      })
    } finally {
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  /** The columns of a table that accept a written value (not stored-generated ones), in table order. */
  private async writableColumns(connection: ResolvedConnection, schema: string, table: string): Promise<string[]> {
    const result = await this.pgMeta(connection, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position", [schema, table], 1000, true)
    return result.rows.map(row => String(row[0]))
  }

  /** VACUUM, ANALYZE and REINDEX cannot run inside a transaction block, so they go out as one statement. */
  async maintenance(connection: ResolvedConnection, input: { schema: string; table: string; action: MaintenanceAction; confirmed?: boolean }): Promise<{ statement: string; durationMs: number }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to run maintenance.')
    const statement = maintenanceStatement(input.schema, input.table, input.action)
    if (input.action === 'reindex' && !input.confirmed) throw new OxeQueryError('confirm', 'REINDEX locks the table while it rebuilds its indexes. Confirm to continue.')
    const session = await this.pgSession(connection)
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
    session.running = true
    const started = Date.now()
    try {
      await session.client.query(statement)
      return { statement, durationMs: Date.now() - started }
    } catch (error) {
      throw new OxeQueryError('query', redact(error instanceof Error ? error.message : 'Maintenance failed', connection.password))
    } finally {
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  // ---- MongoDB ------------------------------------------------------------

  private async mongoSession(connection: ResolvedConnection): Promise<MongoClient> {
    const key = sessionKey(connection)
    const existing = this.mongo.get(connection.id)
    if (existing?.key === key) { existing.lastUsed = Date.now(); return existing.client }
    if (existing) await this.closeConnection(connection.id)
    const { endpoint, tunnel } = await this.reach(connection)
    const client = new MongoClient(mongoUri(connection, endpoint), {
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS, connectTimeoutMS: CONNECT_TIMEOUT_MS, maxPoolSize: 4,
      ...(mongoTlsOptions(connection) as object)
    })
    try { await client.connect() } catch (error) {
      await client.close().catch(() => undefined)
      await tunnel?.close()
      throw new OxeQueryError('connect', withConnectionHint(redact(error instanceof Error ? error.message : 'Connection failed', connection.password, connection.ssh?.password, connection.ssh?.passphrase), connection))
    }
    const session: MongoSession = { key, client, lastUsed: Date.now(), ...(tunnel ? { tunnel } : {}) }
    tunnel?.onClose(() => { if (this.mongo.get(connection.id) === session) this.mongo.delete(connection.id) })
    this.mongo.set(connection.id, session)
    return client
  }

  /** A long export or import counts as use: without this the idle reaper closes the client under it. */
  private touchMongo(connection: ResolvedConnection): void {
    const session = this.mongo.get(connection.id)
    if (session) session.lastUsed = Date.now()
  }

  private mongoError(error: unknown, connection: ResolvedConnection): OxeQueryError {
    if (error instanceof OxeQueryError) return error
    const message = error instanceof Error ? error.message : 'Operation failed'
    if (/operation was interrupted|interrupted at shutdown|operation was killed|operation was aborted|^Cancelled$/i.test(message)) return new OxeQueryError('cancelled', 'The operation was cancelled.')
    if (/time limit|exceeded time|MaxTimeMSExpired/i.test(message)) return new OxeQueryError('timeout', 'The operation exceeded its time limit and was stopped.')
    return new OxeQueryError('query', redact(message, connection.password))
  }

  /** The connection's statement timeout, in the server's own unit. */
  private mongoTimeout(connection: ResolvedConnection): number {
    return Math.min(Math.max(connection.statementTimeoutMs ?? 30_000, 1000), 3_600_000)
  }

  /** Runs a read that `mongoCancel` can stop: tagged on the server, abortable here (see mongo-cancel). */
  private tagged<T>(connection: ResolvedConnection, run: (comment: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    return runTagged(this.mongo.get(connection.id), run)
  }

  /** Stops the find or aggregate this connection is running, on the server when allowed and always here. */
  mongoCancel(connection: ResolvedConnection): Promise<boolean> {
    return cancelOperation(this.mongo.get(connection.id))
  }

  /**
   * updateMany and deleteMany, after counting. A dry run only counts. The real run needs the count the
   * person saw (`expectedCount`) and their confirmation: if the number moved, nothing runs.
   */
  async mongoBulk(connection: ResolvedConnection, input: MongoBulkInput): Promise<MongoBulkResult> {
    if (connection.readOnly && !input.dryRun) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change documents.')
    const filter = parseDocument(input.filter, 'Filter') as Document
    const update = input.op === 'updateMany' ? parseUpdate(input.update, 'Update') : undefined
    try {
      const client = await this.mongoSession(connection)
      const collection = client.db(input.database).collection(input.collection)
      const matched = await collection.countDocuments(filter, { maxTimeMS: this.mongoTimeout(connection) })
      if (input.dryRun) return { matched, modified: 0, deleted: 0, dryRun: true }
      const reasons = [`${matched} document${matched === 1 ? '' : 's'} will be ${input.op === 'deleteMany' ? 'deleted' : 'changed'}.`]
      if (Object.keys(filter).length === 0) reasons.push('The filter is empty: every document in the collection matches.')
      if (!input.confirmed) throw new OxeQueryError('confirm', 'This change needs your confirmation.', reasons)
      if (input.expectedCount !== matched) {
        throw new OxeQueryError('conflict', `${matched} document${matched === 1 ? ' matches' : 's match'} now, not the ${input.expectedCount ?? 'counted'} you confirmed. Count again and confirm.`)
      }
      if (input.op === 'deleteMany') {
        const result = await collection.deleteMany(filter, { maxTimeMS: this.mongoTimeout(connection) })
        return { matched, modified: 0, deleted: result.deletedCount, dryRun: false }
      }
      const result = await collection.updateMany(filter, update as Document, { maxTimeMS: this.mongoTimeout(connection) })
      return { matched: result.matchedCount, modified: result.modifiedCount, deleted: 0, dryRun: false }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  /** Create, rename or drop a collection. */
  async mongoCollectionAction(connection: ResolvedConnection, input: { database: string; collection: string; action: MongoCollectionAction; confirmed?: boolean }): Promise<{ ok: true }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change collections.')
    const checkName = (name: string): void => {
      if (!name || name.includes('$') || name.includes('\0') || name.startsWith('system.') || Buffer.byteLength(name) > 120) throw new OxeQueryError('invalid', 'A collection name cannot be empty, contain "$", or start with "system.".')
    }
    checkName(input.collection)
    const action = input.action
    if (action.kind === 'rename') checkName(action.to)
    if (action.kind === 'drop' && !input.confirmed) throw new OxeQueryError('confirm', `Dropping "${input.collection}" deletes the collection and all of its documents for good.`)
    try {
      const database = (await this.mongoSession(connection)).db(input.database)
      if (action.kind === 'create') {
        await database.createCollection(input.collection, action.capped ? { capped: true, size: action.sizeBytes ?? 1_048_576, ...(action.maxDocuments ? { max: action.maxDocuments } : {}) } : {})
      } else if (action.kind === 'rename') {
        await database.collection(input.collection).rename(action.to, { dropTarget: false })
      } else {
        await database.collection(input.collection).drop()
      }
      return { ok: true }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoStats(connection: ResolvedConnection, database: string, collection: string): Promise<MongoStats> {
    try {
      const client = await this.mongoSession(connection)
      const [row] = await client.db(database).collection(collection).aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: 10_000 }).toArray()
      const stats = (row?.storageStats ?? {}) as Record<string, unknown>
      const number = (value: unknown): number => typeof value === 'number' ? value : Number(value ?? 0) || 0
      return {
        documents: number(stats.count), sizeBytes: number(stats.size), avgDocumentBytes: number(stats.avgObjSize), storageBytes: number(stats.storageSize),
        indexes: number(stats.nindexes), indexBytes: number(stats.totalIndexSize), capped: stats.capped === true
      }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoValidation(connection: ResolvedConnection, database: string, collection: string): Promise<MongoValidation> {
    try {
      const client = await this.mongoSession(connection)
      const [info] = await client.db(database).listCollections({ name: collection }).toArray()
      const options = ((info as { options?: Record<string, unknown> } | undefined)?.options ?? {})
      const validator = options.validator && typeof options.validator === 'object' && Object.keys(options.validator).length > 0 ? options.validator : null
      return {
        validator: validator ? JSON.stringify(JSON.parse(toEjson(validator, 1024 * 1024).text), null, 2) : null,
        level: options.validationLevel === 'off' || options.validationLevel === 'moderate' ? options.validationLevel : 'strict',
        action: options.validationAction === 'warn' ? 'warn' : 'error'
      }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoSetValidation(connection: ResolvedConnection, input: { database: string; collection: string; validator: string | null; level: MongoValidation['level']; action: MongoValidation['action'] }): Promise<{ ok: true }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change validation.')
    const validator = parseValidator(input.validator ?? undefined)
    try {
      const client = await this.mongoSession(connection)
      await client.db(input.database).command({ collMod: input.collection, validator: validator ?? {}, validationLevel: input.level, validationAction: input.action })
      return { ok: true }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  /** The planner's account of a find or aggregate, in words (and the raw answer next to it). */
  async mongoExplain(connection: ResolvedConnection, input: MongoExplainInput): Promise<MongoExplainSummary> {
    const verbosity = input.verbosity ?? 'executionStats'
    try {
      const client = await this.mongoSession(connection)
      const collection = client.db(input.database).collection(input.collection)
      const maxTimeMS = this.mongoTimeout(connection)
      let explain: Document
      if (input.kind === 'aggregate') {
        explain = await collection.aggregate(parsePipeline(input.pipeline ?? '[]', connection.readOnly), { maxTimeMS }).explain(verbosity) as Document
      } else {
        const projection = input.projection?.trim() ? parseDocument(input.projection, 'Projection') : undefined
        const sort = input.sort?.trim() ? parseDocument(input.sort, 'Sort') : undefined
        explain = await collection.find(parseDocument(input.filter, 'Filter'), { ...(projection ? { projection } : {}), ...(sort ? { sort: sort as never } : {}), maxTimeMS }).explain(verbosity) as Document
      }
      return summarizeExplain(explain as Record<string, unknown>, toEjson(explain, 256 * 1024).text)
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoDatabases(connection: ResolvedConnection): Promise<MongoDatabaseInfo[]> {
    try {
      const client = await this.mongoSession(connection)
      const result = await client.db('admin').admin().listDatabases({ authorizedDatabases: true })
      return result.databases.map(database => ({ name: database.name, ...(typeof database.sizeOnDisk === 'number' ? { sizeOnDisk: database.sizeOnDisk } : {}), ...(typeof database.empty === 'boolean' ? { empty: database.empty } : {}) }))
    } catch (error) {
      if (error instanceof OxeQueryError) throw error
      // A user without listDatabases still has the database named on the connection.
      if (connection.database) return [{ name: connection.database }]
      throw this.mongoError(error, connection)
    }
  }

  async mongoCollections(connection: ResolvedConnection, database: string): Promise<MongoCollectionInfo[]> {
    try {
      const client = await this.mongoSession(connection)
      const list = await client.db(database).listCollections({}, { nameOnly: true }).toArray()
      return list.map(item => ({ name: item.name, type: item.type ?? 'collection' })).sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoFind(connection: ResolvedConnection, input: MongoFindInput): Promise<MongoResult> {
    const filter = parseDocument(input.filter, 'Filter')
    const projection = input.projection?.trim() ? parseDocument(input.projection, 'Projection') : undefined
    const sort = input.sort?.trim() ? parseDocument(input.sort, 'Sort') : undefined
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50) || 50, MAX_DOCUMENTS))
    const skip = Math.max(0, Math.min(Math.trunc(input.skip ?? 0) || 0, 10_000_000))
    const started = Date.now()
    try {
      const client = await this.mongoSession(connection)
      const collection = client.db(input.database).collection(input.collection)
      const found = await this.tagged(connection, (comment, signal) => collection.find(filter, { ...(projection ? { projection } : {}), ...(sort ? { sort: sort as never } : {}), limit: limit + 1, skip, maxTimeMS: this.mongoTimeout(connection), promoteValues: false, comment, signal }).toArray())
      let total: number | undefined
      try { total = await collection.countDocuments(filter, { maxTimeMS: 5000 }) } catch { /* A slow count is not worth failing the query. */ }
      return this.mongoResult(found, limit, started, total)
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoAggregate(connection: ResolvedConnection, input: MongoAggregateInput): Promise<MongoResult> {
    const pipeline = parsePipeline(input.pipeline, connection.readOnly)
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 50) || 50, MAX_DOCUMENTS))
    const started = Date.now()
    try {
      const client = await this.mongoSession(connection)
      const skip = Math.max(0, Math.min(Math.trunc(input.skip ?? 0) || 0, 10_000_000))
      const stages = [...pipeline, ...(skip > 0 ? [{ $skip: skip }] : []), { $limit: limit + 1 }]
      const documents = await this.tagged(connection, (comment, signal) => client.db(input.database).collection(input.collection).aggregate(stages, { maxTimeMS: this.mongoTimeout(connection), promoteValues: false, comment, signal }).toArray())
      return this.mongoResult(documents, limit, started)
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoWrite(connection: ResolvedConnection, input: MongoWriteInput): Promise<MongoWriteResult> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change documents.')
    // Edited documents keep their BSON types: Int64, Double 5.0 and Decimal128 are not turned into plain numbers.
    const document = input.op === 'delete' ? undefined : parseEditableDocument(input.document, 'Document')
    const expected = input.expected ? parseEditableDocument(input.expected, 'Original document') : undefined
    if (input.op !== 'insert' && (!expected || expected._id === undefined)) throw new OxeQueryError('invalid', 'A change to an existing document needs the original document, including its _id.')
    if (input.op === 'replace' && document && document._id !== undefined && EJSON.stringify(document._id as never) !== EJSON.stringify(expected!._id as never)) {
      throw new OxeQueryError('invalid', 'The _id of a document cannot be changed.')
    }
    try {
      const client = await this.mongoSession(connection)
      const collection = client.db(input.database).collection(input.collection)
      if (input.op === 'insert') {
        const result = await collection.insertOne(document as Document)
        return { matched: 0, modified: 0, deleted: 0, insertedId: EJSON.stringify(result.insertedId as never, { relaxed: true }) }
      }
      // The write itself only matches a document that still equals what the person was looking at
      // (`$$ROOT` against the original, compared by the server), so a change landing between a
      // read and this write cannot be overwritten. A miss is explained by a second look.
      const unchanged = { _id: expected!._id, $expr: { $eq: ['$$ROOT', { $literal: expected }] } } as Document
      const explainMiss = async (): Promise<never> => {
        const exists = await collection.countDocuments({ _id: expected!._id } as Document, { limit: 1 })
        throw new OxeQueryError('conflict', exists
          ? 'The document changed since you opened it, so nothing was saved. Reload it and apply your edit again.'
          : 'The document no longer exists. Reload the collection.')
      }
      if (input.op === 'delete') {
        const result = await collection.deleteOne(unchanged)
        if (result.deletedCount === 0) return explainMiss()
        return { matched: result.deletedCount, modified: 0, deleted: result.deletedCount }
      }
      const result = await collection.replaceOne(unchanged, { ...(document as Document), _id: expected!._id })
      if (result.matchedCount === 0) return explainMiss()
      return { matched: result.matchedCount, modified: result.modifiedCount, deleted: 0 }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoIndexes(connection: ResolvedConnection, database: string, collection: string): Promise<MongoIndexInfo[]> {
    try {
      const client = await this.mongoSession(connection)
      const indexes = await client.db(database).collection(collection).indexes()
      return indexes.map(index => ({ name: String(index.name), keys: JSON.stringify(index.key), unique: Boolean(index.unique) }))
    } catch (error) { throw this.mongoError(error, connection) }
  }

  /** Field paths and types inferred from a random sample; a guide, not a contract. */
  async mongoSchema(connection: ResolvedConnection, database: string, collection: string, sampleSize = 200): Promise<MongoSchema> {
    const size = Math.max(10, Math.min(Math.trunc(sampleSize) || 200, 1000))
    try {
      const client = await this.mongoSession(connection)
      const documents = await client.db(database).collection(collection).aggregate([{ $sample: { size } }], { maxTimeMS: 20_000 }).toArray()
      return { sampled: documents.length, ...inferSchema(documents) }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoCreateIndex(connection: ResolvedConnection, input: { database: string; collection: string; keys: string; unique?: boolean }): Promise<{ name: string }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change indexes.')
    const keys = parseDocument(input.keys, 'Index keys')
    const entries = Object.entries(keys)
    if (entries.length === 0 || entries.length > 32) throw new OxeQueryError('invalid', 'An index needs between 1 and 32 keys.')
    for (const [field, direction] of entries) {
      if (!field || field.startsWith('$')) throw new OxeQueryError('invalid', `"${field}" is not a valid field name.`)
      if (![1, -1, 'text', '2dsphere', 'hashed'].includes(direction as never)) throw new OxeQueryError('invalid', `The direction of "${field}" must be 1, -1, "text", "2dsphere" or "hashed".`)
    }
    try {
      const client = await this.mongoSession(connection)
      const name = await client.db(input.database).collection(input.collection).createIndex(keys as never, { ...(input.unique ? { unique: true } : {}), background: true })
      return { name }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoDropIndex(connection: ResolvedConnection, input: { database: string; collection: string; name: string }): Promise<{ dropped: boolean }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change indexes.')
    if (input.name === '_id_' || input.name === '*') throw new OxeQueryError('invalid', 'The _id index cannot be dropped.')
    try {
      const client = await this.mongoSession(connection)
      await client.db(input.database).collection(input.collection).dropIndex(input.name)
      return { dropped: true }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async sqlFunctions(connection: ResolvedConnection, schema: string): Promise<SqlFunctionInfo[]> {
    const result = await this.pgMeta(connection, `SELECT p.oid::int, p.proname, pg_get_function_identity_arguments(p.oid), p.prokind
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') ORDER BY p.proname, p.oid LIMIT 1000`, [schema], 1000, true)
    return result.rows.map(row => ({ oid: Number(row[0]), name: String(row[1]), args: String(row[2]), kind: row[3] === 'p' ? 'procedure' as const : 'function' as const }))
  }

  async sqlDatabases(connection: ResolvedConnection): Promise<SqlDatabaseInfo[]> {
    const result = await this.pgMeta(connection, `SELECT d.datname, pg_get_userbyid(d.datdba), pg_encoding_to_char(d.encoding), CASE WHEN has_database_privilege(d.datname, 'CONNECT') THEN pg_database_size(d.datname) END,
        d.datconnlimit, d.datname = current_database()
      FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname`, [], 500, true)
    return result.rows.map(row => ({ name: String(row[0]), owner: String(row[1]), encoding: String(row[2]), sizeBytes: row[3] === null ? null : Number(row[3]), connectionLimit: Number(row[4]), current: Boolean(row[5]) }))
  }

  async sqlRoles(connection: ResolvedConnection): Promise<SqlRoleInfo[]> {
    const result = await this.pgMeta(connection, `SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolcanlogin, r.rolreplication, r.rolconnlimit,
        COALESCE((SELECT array_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), '{}')
      FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY r.rolname`, [], 1000, true)
    return result.rows.map(row => ({
      name: String(row[0]), superuser: Boolean(row[1]), createDatabase: Boolean(row[2]), createRole: Boolean(row[3]), login: Boolean(row[4]), replication: Boolean(row[5]), connectionLimit: Number(row[6]),
      memberOf: nameList(row[7])
    }))
  }

  /** CREATE DATABASE cannot run inside a transaction, so it goes out as the only statement of the session. */
  async sqlCreateDatabase(connection: ResolvedConnection, input: { name: string; owner?: string; template?: string; encoding?: string }): Promise<{ ok: true }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to create a database.')
    const encodings = ['UTF8', 'LATIN1', 'SQL_ASCII']
    if (input.encoding !== undefined && !encodings.includes(input.encoding)) throw new OxeQueryError('invalid', 'Choose UTF8, LATIN1 or SQL_ASCII.')
    const clauses = [
      input.owner ? `OWNER ${quoteIdentifier(input.owner)}` : '', input.template ? `TEMPLATE ${quoteIdentifier(input.template)}` : '', input.encoding ? `ENCODING '${input.encoding}'` : ''
    ].filter(Boolean).join(' ')
    await this.pgRun(connection, `CREATE DATABASE ${quoteIdentifier(input.name)} ${clauses}`.trim(), [], 1, false)
    return { ok: true }
  }

  async sqlDropDatabase(connection: ResolvedConnection, input: { name: string; confirmed?: boolean }): Promise<{ ok: true }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to drop a database.')
    if (input.name === connection.database) throw new OxeQueryError('invalid', 'This connection is using that database. Connect to another one to drop it.')
    if (!input.confirmed) throw new OxeQueryError('confirm', `Dropping the database "${input.name}" deletes all of its data for good.`)
    await this.pgRun(connection, `DROP DATABASE ${quoteIdentifier(input.name)}`, [], 1, false)
    return { ok: true }
  }

  /** Sequences, user types and triggers of one schema (each list capped, with a flag when it was). */
  async sqlObjects(connection: ResolvedConnection, schema: string): Promise<SqlObjects> {
    const cap = 1000
    const sequences = await this.pgMeta(connection, `SELECT sequencename, data_type::text, last_value FROM pg_sequences WHERE schemaname = $1 ORDER BY sequencename LIMIT ${cap + 1}`, [schema], cap + 1, true)
    const types = await this.pgMeta(connection, `SELECT t.oid::int, t.typname, t.typtype,
        (SELECT string_agg(e.enumlabel, chr(10) ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND t.typtype IN ('e', 'c', 'd', 'r') AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
      ORDER BY t.typname LIMIT ${cap + 1}`, [schema], cap + 1, true)
    const triggers = await this.pgMeta(connection, `SELECT t.oid::int, t.tgname, c.relname, pg_get_triggerdef(t.oid), t.tgenabled <> 'D'
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = $1 ORDER BY c.relname, t.tgname LIMIT ${cap + 1}`, [schema], cap + 1, true)
    const kinds: Record<string, SqlTypeInfo['kind']> = { e: 'enum', c: 'composite', d: 'domain', r: 'range' }
    return {
      sequences: sequences.rows.slice(0, cap).map(row => ({ name: String(row[0]), dataType: String(row[1]), lastValue: row[2] === null ? null : Number(row[2]) })),
      types: types.rows.slice(0, cap).map(row => ({ oid: Number(row[0]), name: String(row[1]), kind: kinds[String(row[2])] ?? 'composite', ...(row[3] ? { values: String(row[3]).split('\n') } : {}) })),
      triggers: triggers.rows.slice(0, cap).map(row => ({ oid: Number(row[0]), name: String(row[1]), table: String(row[2]), definition: String(row[3]), enabled: Boolean(row[4]) })),
      truncated: sequences.rows.length > cap || types.rows.length > cap || triggers.rows.length > cap
    }
  }

  async sqlExtensions(connection: ResolvedConnection): Promise<SqlExtensionInfo[]> {
    const result = await this.pgMeta(connection, 'SELECT e.extname, e.extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname', [], 500, true)
    return result.rows.map(row => ({ name: String(row[0]), version: String(row[1]), schema: String(row[2]) }))
  }

  /** Finds tables, views, functions, sequences and types by name in every schema except the system ones. */
  async sqlSearch(connection: ResolvedConnection, query: string): Promise<SqlSearchResult> {
    const text = query.trim()
    if (text.length === 0) return { hits: [], truncated: false }
    const pattern = `%${text.replace(/[\\%_]/g, match => `\\${match}`)}%`
    const cap = 200
    const result = await this.pgMeta(connection, `
      SELECT * FROM (
        SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table' ELSE 'sequence' END AS kind,
               n.nspname AS schema, c.relname AS name, NULL::text AS args, NULL::int AS oid
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S') AND c.relname ILIKE $1
        UNION ALL
        SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.oid::int
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prokind IN ('f', 'p') AND p.proname ILIKE $1
        UNION ALL
        SELECT 'type', n.nspname, t.typname, NULL, t.oid::int
          FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typtype IN ('e', 'd', 'r') AND t.typname ILIKE $1
      ) found WHERE schema NOT IN ('pg_catalog', 'information_schema') AND schema NOT LIKE 'pg\\_toast%' AND schema NOT LIKE 'pg\\_temp%'
      ORDER BY (lower(name) = lower($2)) DESC, name, schema LIMIT ${cap + 1}`, [pattern, text], cap + 1, true)
    return {
      hits: result.rows.slice(0, cap).map(row => ({
        kind: String(row[0]) as SqlSearchHit['kind'], schema: String(row[1]), name: String(row[2]),
        ...(row[3] !== null ? { args: String(row[3]) } : {}), ...(row[4] !== null ? { oid: Number(row[4]) } : {})
      })),
      truncated: result.rows.length > cap
    }
  }

  /** `CREATE TYPE` for an enum, a composite, a domain or a range, from the catalog. */
  private async typeDefinition(connection: ResolvedConnection, oid: number): Promise<string> {
    const info = await this.pgMeta(connection, `SELECT n.nspname, t.typname, t.typtype, t.typrelid::int, format_type(t.typbasetype, t.typtypmod), t.typnotnull, pg_get_expr(t.typdefaultbin, 0)
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.oid = $1::oid`, [oid], 1, true)
    const row = info.rows[0]
    if (!row) throw new OxeQueryError('invalid', 'That type no longer exists.')
    const name = `${quoteIdentifier(String(row[0]))}.${quoteIdentifier(String(row[1]))}`
    switch (String(row[2])) {
      case 'e': {
        const labels = await this.pgMeta(connection, 'SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::oid ORDER BY enumsortorder', [oid], 10_000, true)
        return `CREATE TYPE ${name} AS ENUM (${labels.rows.map(label => `'${String(label[0]).replace(/'/g, "''")}'`).join(', ')});`
      }
      case 'c': {
        const attributes = await this.pgMeta(connection, `SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = $1::oid AND attnum > 0 AND NOT attisdropped ORDER BY attnum`, [Number(row[3])], 1000, true)
        return `CREATE TYPE ${name} AS (\n${attributes.rows.map(attribute => `  ${quoteIdentifier(String(attribute[0]))} ${String(attribute[1])}`).join(',\n')}\n);`
      }
      case 'd': return `CREATE DOMAIN ${name} AS ${String(row[4])}${row[6] ? ` DEFAULT ${String(row[6])}` : ''}${row[5] ? ' NOT NULL' : ''};`
      default: return `-- ${name} is a range type; its definition is not generated.`
    }
  }

  /** Re-creates the statement that defines a table, view or function, from the catalog. */
  async sqlDefinition(connection: ResolvedConnection, target: SqlDefinitionTarget): Promise<{ text: string }> {
    if (target.kind === 'trigger' || target.kind === 'type') {
      if (!Number.isInteger(target.oid) || target.oid <= 0) throw new OxeQueryError('invalid', 'Choose an object.')
      if (target.kind === 'type') return { text: await this.typeDefinition(connection, target.oid) }
      const result = await this.pgMeta(connection, 'SELECT pg_get_triggerdef($1::oid, true)', [target.oid], 1, true)
      return { text: `${String(result.rows[0]?.[0] ?? '')};` }
    }
    if (target.kind === 'sequence') {
      const result = await this.pgMeta(connection, 'SELECT data_type::text, start_value, min_value, max_value, increment_by, cycle, cache_size FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2', [target.schema, target.name], 1, true)
      const row = result.rows[0]
      if (!row) throw new OxeQueryError('invalid', 'That sequence no longer exists.')
      return { text: `CREATE SEQUENCE ${quoteIdentifier(target.schema)}.${quoteIdentifier(target.name)} AS ${String(row[0])} START ${String(row[1])} INCREMENT ${String(row[4])} MINVALUE ${String(row[2])} MAXVALUE ${String(row[3])} CACHE ${String(row[6])}${row[5] ? ' CYCLE' : ' NO CYCLE'};` }
    }
    if (target.kind === 'function') {
      if (!Number.isInteger(target.oid) || target.oid <= 0) throw new OxeQueryError('invalid', 'Choose a function.')
      const result = await this.pgMeta(connection, 'SELECT pg_get_functiondef($1::oid)', [target.oid], 1, true)
      return { text: String(result.rows[0]?.[0] ?? '') }
    }
    const qualified = `${quoteIdentifier(target.schema)}.${quoteIdentifier(target.name)}`
    if (target.kind === 'view') {
      const result = await this.pgMeta(connection, `SELECT c.relkind, pg_get_viewdef(c.oid, true) FROM pg_class c WHERE c.oid = to_regclass($1) AND c.relkind IN ('v', 'm')`, [qualified], 1, true)
      const row = result.rows[0]
      if (!row) throw new OxeQueryError('invalid', 'That view no longer exists.')
      return { text: `CREATE ${row[0] === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'} ${qualified} AS\n${String(row[1]).trim()}` }
    }
    const columns = await this.pgMeta(connection, `SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attgenerated
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [qualified], 1000, true)
    if (columns.rows.length === 0) throw new OxeQueryError('invalid', 'That table no longer exists.')
    const constraints = await this.pgMeta(connection, `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = to_regclass($1) ORDER BY contype DESC, conname`, [qualified], 500, true)
    const indexes = await this.pgMeta(connection, `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2
      AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = to_regclass($3)) ORDER BY indexname`, [target.schema, target.name, qualified], 500, true)
    const lines = columns.rows.map(row => {
      const generated = row[4] === 's' ? ` GENERATED ALWAYS AS (${String(row[3])}) STORED` : ''
      const fallback = !generated && row[3] ? ` DEFAULT ${String(row[3])}` : ''
      return `  ${quoteIdentifier(String(row[0]))} ${String(row[1])}${generated}${fallback}${row[2] ? ' NOT NULL' : ''}`
    })
    for (const row of constraints.rows) lines.push(`  CONSTRAINT ${quoteIdentifier(String(row[0]))} ${String(row[1])}`)
    return { text: [`CREATE TABLE ${qualified} (\n${lines.join(',\n')}\n);`, ...indexes.rows.map(row => `${String(row[0])};`)].join('\n') }
  }

  /** One whole document, for the edit form of one that was too large to list. */
  async mongoDocument(connection: ResolvedConnection, input: { database: string; collection: string; id: string }): Promise<{ text: string }> {
    const id = parseEditableDocument(`{"_id":${input.id}}`, 'Document id')._id
    try {
      const client = await this.mongoSession(connection)
      const found = await client.db(input.database).collection(input.collection).findOne({ _id: id } as Document, { promoteValues: false })
      if (!found) throw new OxeQueryError('invalid', 'The document no longer exists. Reload the collection.')
      const whole = editableEjson(found, 4 * 1024 * 1024)
      if (whole.truncated) throw new OxeQueryError('invalid', 'This document is larger than 4 MB and cannot be edited here.')
      return { text: whole.text }
    } catch (error) { throw this.mongoError(error, connection) }
  }

  private mongoResult(documents: Document[], limit: number, started: number, total?: number): MongoResult {
    const shown = documents.slice(0, limit).map(document => editableEjson(document))
    const sliced = documents.slice(0, limit)
    const oversized = shown.flatMap((entry, index) => entry.truncated ? [{ index, id: editableEjson(sliced[index]._id).text }] : [])
    return {
      documents: shown.map(entry => entry.text),
      ...(oversized.length ? { oversized } : {}),
      truncated: documents.length > limit,
      durationMs: Date.now() - started,
      ...(total !== undefined ? { total } : {})
    }
  }

  // ---- Explain ------------------------------------------------------------

  /**
   * The execution plan of one statement. Plain EXPLAIN never runs it. ANALYZE does:
   * a statement that only reads runs in a READ ONLY transaction, and one that changes
   * data runs in a transaction that is always rolled back, so the plan shows real
   * timings without keeping any change.
   */
  async sqlExplain(connection: ResolvedConnection, input: { sql: string; analyze?: boolean }): Promise<SqlExplain> {
    if (typeof input.sql !== 'string' || input.sql.length > 1024 * 1024) throw new OxeQueryError('invalid', 'The SQL is empty or too large.')
    const verdict = guardSql(input.sql)
    if (verdict.kind === 'empty') throw new OxeQueryError('invalid', 'There is nothing to explain.')
    if (verdict.statements !== 1) throw new OxeQueryError('invalid', 'Explain one statement at a time.')
    if (/^\s*(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*explain\b/i.test(input.sql)) throw new OxeQueryError('invalid', 'Write the statement without EXPLAIN; it is added for you.')
    const analyze = Boolean(input.analyze)
    const mutating = isMutating(verdict)
    if (analyze && mutating && connection.readOnly) throw new OxeQueryError('read-only', 'Analyzing a statement that changes data runs it. Turn read-only off first.', verdict.reasons)
    const body = input.sql.replace(/;\s*$/, '')
    const session = await this.pgSession(connection)
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
    session.running = true
    const { client } = session
    try {
      await client.query(analyze && mutating ? 'BEGIN' : 'BEGIN READ ONLY')
      const options = analyze ? 'FORMAT JSON, ANALYZE, BUFFERS' : 'FORMAT JSON'
      const outcome = await client.query({ text: `EXPLAIN (${options}) ${body}`, rowMode: 'array' })
      const cell = (outcome.rows[0] as unknown[] | undefined)?.[0]
      const document = typeof cell === 'string' ? JSON.parse(cell) as unknown : cell
      const { plan, nodeCount } = parsePlan(document)
      const root = (Array.isArray(document) ? document[0] : document) as Record<string, unknown> | undefined
      const planning = root?.['Planning Time']
      const execution = root?.['Execution Time']
      return {
        analyze, plan, nodeCount, hints: planHints(plan),
        ...(typeof planning === 'number' ? { planningMs: planning } : {}),
        ...(typeof execution === 'number' ? { executionMs: execution } : {})
      }
    } catch (error) {
      if (error instanceof OxeQueryError) throw error
      const message = error instanceof Error ? error.message : 'EXPLAIN failed'
      if (/canceling statement due to user request/i.test(message)) throw new OxeQueryError('cancelled', 'The query was cancelled.')
      if (/statement timeout/i.test(message)) throw new OxeQueryError('timeout', `The query ran longer than ${Math.round(this.timeoutOf(connection) / 1000)}s and was stopped.`)
      throw new OxeQueryError('query', redact(message, connection.password))
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  // ---- Import -------------------------------------------------------------

  /** The first rows of a file and the destination's columns, so a mapping can be chosen. */
  async importPreview(connection: ResolvedConnection, input: { path: string; format: ImportFormat; target: ImportTarget; options?: ImportOptions }): Promise<{
    fields: string[]; sample: string[][]; targetColumns: { name: string; type: string; nullable: boolean; hasDefault: boolean; generated: boolean }[]; detected?: { delimiter: string; encoding: string }
  }> {
    const fields: string[] = []
    const rows: Record<string, unknown>[] = []
    for await (const item of readRecords(input.path, input.format, input.options)) {
      if (!('record' in item)) continue
      for (const key of Object.keys(item.record)) if (!fields.includes(key)) fields.push(key)
      rows.push(item.record)
      if (rows.length >= 10) break
    }
    const text = (value: unknown): string => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    let targetColumns: { name: string; type: string; nullable: boolean; hasDefault: boolean; generated: boolean }[] = []
    if (input.target.kind === 'table') {
      if (connection.engine !== 'postgres') throw new OxeQueryError('invalid', 'A table import needs a PostgreSQL connection.')
      targetColumns = (await this.columnMeta(connection, input.target.schema, input.target.table)).columns.map(({ name, type, nullable, hasDefault, generated }) => ({ name, type, nullable, hasDefault, generated }))
    } else if (connection.engine !== 'mongodb') throw new OxeQueryError('invalid', 'A collection import needs a MongoDB connection.')
    const detected = input.format === 'csv' ? await describeFile(input.path, input.options ?? {}) : undefined
    return { fields, sample: rows.map(record => fields.map(field => text(record[field]))), targetColumns, ...(detected ? { detected } : {}) }
  }

  /**
   * Inserts the rows of a file. A table import runs in one transaction in batches,
   * so a failure leaves nothing behind; a dry run does the same and rolls back.
   * Rows that cannot be read are rejected into a file next to the source.
   */
  async importRun(
    connection: ResolvedConnection,
    input: { path: string; format: ImportFormat; target: ImportTarget; mapping: Record<string, string>; dryRun?: boolean; emptyAsNull?: boolean; options?: ImportOptions; conflict?: ImportConflict },
    hooks: { cancelled(): boolean; progress(rows: number): void }
  ): Promise<{ dryRun: boolean; inserted: number; updated?: number; skipped?: number; rejected: number; rejects: { row: number; reason: string }[]; rejectsPath?: string; cancelled: boolean; durationMs: number }> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to import data.')
    const started = Date.now()
    const dryRun = Boolean(input.dryRun)
    const emptyAsNull = input.emptyAsNull !== false
    const rejects: { row: number; reason: string }[] = []
    let rejected = 0
    let rejectsPath: string | undefined
    let rejectsFile: Awaited<ReturnType<typeof openRejects>> | undefined
    let rejectsOpened = false
    const reject = async (row: number, reason: string, raw?: string): Promise<void> => {
      rejected++
      if (rejects.length < 50) rejects.push({ row, reason })
      if (dryRun) return
      if (!rejectsOpened) {
        rejectsOpened = true
        rejectsFile = await openRejects(input.path)
        rejectsPath = rejectsFile?.path
      }
      await rejectsFile?.write(`${JSON.stringify({ row, reason, ...(raw ? { raw } : {}) })}\n`)
    }
    let inserted = 0
    let updated = 0
    let skipped = 0
    let lastReport = 0
    const report = (seen: number): void => { const now = Date.now(); if (now - lastReport > 250) { lastReport = now; hooks.progress(seen) } }
    const finish = async (cancelled: boolean): Promise<{ dryRun: boolean; inserted: number; updated?: number; skipped?: number; rejected: number; rejects: { row: number; reason: string }[]; rejectsPath?: string; cancelled: boolean; durationMs: number }> => {
      await rejectsFile?.close().catch(() => undefined)
      return { dryRun, inserted, ...(updated ? { updated } : {}), ...(skipped ? { skipped } : {}), rejected, rejects, ...(rejectsPath ? { rejectsPath } : {}), cancelled, durationMs: Date.now() - started }
    }
    try {
      if (input.target.kind === 'collection') {
        if (connection.engine !== 'mongodb') throw new OxeQueryError('invalid', 'A collection import needs a MongoDB connection.')
        const client = await this.mongoSession(connection)
        const collection = client.db(input.target.database).collection(input.target.collection)
        let batch: Document[] = []
        let seen = 0
        const flush = async (): Promise<void> => {
          if (batch.length === 0) return
          const documents = batch
          batch = []
          this.touchMongo(connection)
          if (dryRun) { inserted += documents.length; return }
          try {
            const outcome = await collection.insertMany(documents, { ordered: false })
            inserted += outcome.insertedCount
          } catch (error) {
            const failure = error as { result?: { insertedCount?: number }; writeErrors?: { index?: number; errmsg?: string }[]; insertedCount?: number }
            inserted += failure.result?.insertedCount ?? failure.insertedCount ?? 0
            if (!failure.writeErrors) throw error
            for (const writeError of failure.writeErrors) await reject(seen, String(writeError.errmsg ?? 'The document was refused.').slice(0, 200))
          }
        }
        for await (const item of readRecords(input.path, input.format, input.options)) {
          if (hooks.cancelled()) return await finish(true)
          seen++
          if (!('record' in item)) { await reject(item.row, item.error, item.raw); continue }
          const mapped: Document = {}
          for (const [field, value] of Object.entries(item.record)) {
            const target = input.mapping[field]
            if (target) mapped[target] = value
          }
          if (Object.keys(mapped).length === 0) { await reject(item.row, 'No mapped field has a value.'); continue }
          // JSON and NDJSON may carry extended JSON ({"$oid": …}, {"$date": …}); CSV stays text.
          batch.push(input.format === 'csv' ? mapped : EJSON.deserialize(mapped as never) as Document)
          if (batch.length >= 1000) { await flush(); report(seen) }
        }
        await flush()
        return await finish(false)
      }

      if (connection.engine !== 'postgres') throw new OxeQueryError('invalid', 'A table import needs a PostgreSQL connection.')
      const { columns } = await this.columnMeta(connection, input.target.schema, input.target.table)
      const destinations = [...new Set(Object.values(input.mapping))]
      if (destinations.length === 0) throw new OxeQueryError('invalid', 'Map at least one field to a column.')
      const metas = destinations.map(name => {
        const meta = columns.find(column => column.name === name)
        if (!meta) throw new OxeQueryError('invalid', `The table has no column "${name}".`)
        if (meta.generated) throw new OxeQueryError('invalid', `Column "${name}" is generated and cannot be imported into.`)
        if (!/^[A-Za-z0-9_ ."()[\],]+$/.test(meta.type) || meta.type.length > 200) throw new OxeQueryError('invalid', `Column "${name}" has a type that cannot be imported safely.`)
        return meta
      })
      const fieldsByColumn = destinations.map(name => Object.entries(input.mapping).find(([, target]) => target === name)![0])
      const perBatch = Math.max(1, Math.min(1000, Math.floor(60_000 / metas.length)))
      const table = `${quoteIdentifier(input.target.schema)}.${quoteIdentifier(input.target.table)}`
      // What to do with a row whose key exists: refuse the import (default), leave the row, or update it.
      const conflict = input.conflict && input.conflict.mode !== 'error' ? input.conflict : null
      for (const name of conflict?.columns ?? []) {
        if (!columns.some(column => column.name === name)) throw new OxeQueryError('invalid', `The table has no column "${name}" to match rows on.`)
        if (!destinations.includes(name)) throw new OxeQueryError('invalid', `The key column "${name}" must be mapped to a file field.`)
      }
      if (conflict?.mode === 'update' && conflict.columns.length === 0) throw new OxeQueryError('invalid', 'Choose the key column or columns that identify an existing row.')
      const keyList = conflict && conflict.columns.length ? ` (${conflict.columns.map(quoteIdentifier).join(', ')})` : ''
      const updatable = destinations.filter(name => !(conflict?.columns ?? []).includes(name))
      const reportsInserts = conflict?.mode === 'update' && updatable.length > 0
      const conflictSql = !conflict ? '' : conflict.mode === 'skip' || updatable.length === 0
        ? ` ON CONFLICT${keyList} DO NOTHING`
        : ` ON CONFLICT${keyList} DO UPDATE SET ${updatable.map(name => `${quoteIdentifier(name)} = EXCLUDED.${quoteIdentifier(name)}`).join(', ')} RETURNING (xmax = 0) AS inserted`
      const insertSql = (count: number): string => `INSERT INTO ${table} (${metas.map(meta => quoteIdentifier(meta.name)).join(', ')}) VALUES ${
        Array.from({ length: count }, (_, rowIndex) => `(${metas.map((meta, columnIndex) => `$${rowIndex * metas.length + columnIndex + 1}::${meta.type}`).join(', ')})`).join(', ')}${conflictSql}`
      const session = await this.pgSession(connection)
      if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
      session.running = true
      const { client } = session
      let batch: (string | null)[][] = []
      let rowsSeen = 0
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        const rows = batch
        batch = []
        const outcome = await client.query({ text: insertSql(rows.length), values: rows.flat() })
        if (reportsInserts) {
          const fresh = (outcome.rows as { inserted: boolean }[]).filter(row => row.inserted === true).length
          inserted += fresh
          updated += outcome.rows.length - fresh
        } else if (conflict) {
          inserted += outcome.rowCount ?? 0
          skipped += rows.length - (outcome.rowCount ?? 0)
        } else inserted += rows.length
      }
      try {
        await client.query('BEGIN')
        try {
          for await (const item of readRecords(input.path, input.format, input.options)) {
            if (hooks.cancelled()) { await client.query('ROLLBACK'); inserted = 0; updated = 0; skipped = 0; return await finish(true) }
            rowsSeen++
            if (!('record' in item)) { await reject(item.row, item.error, item.raw); continue }
            batch.push(fieldsByColumn.map((field, index) => {
              const value = item.record[field]
              if (value === null || value === undefined) return null
              if (typeof value === 'object') return JSON.stringify(value)
              const text = String(value)
              return text === '' && emptyAsNull && metas[index].nullable ? null : text
            }))
            if (batch.length >= perBatch) { await flush(); report(rowsSeen) }
          }
          await flush()
          await client.query(dryRun ? 'ROLLBACK' : 'COMMIT')
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          inserted = 0; updated = 0; skipped = 0
          throw error
        }
      } finally { session.running = false; session.lastUsed = Date.now() }
      return await finish(false)
    } catch (error) {
      await rejectsFile?.close().catch(() => undefined)
      if (error instanceof OxeQueryError) throw error
      if (connection.engine === 'mongodb') throw this.mongoError(error, connection)
      const message = error instanceof Error ? error.message : 'The import failed'
      throw new OxeQueryError('query', `Nothing was imported. ${redact(message, connection.password)}`)
    }
  }

  // ---- Export -------------------------------------------------------------

  /**
   * Streams a query, a table or a collection to a new file in the chosen format.
   * Rows are read in batches through a cursor, so memory stays flat however large
   * the source is. Cancelling removes the partial file.
   */
  async exportRun(
    connection: ResolvedConnection,
    input: { source: ExportSource; format: ExportFormat; options?: { delimiter?: ',' | ';' | '\t'; header?: boolean; bom?: boolean; maxRows?: number }; path: string },
    hooks: { cancelled(): boolean; progress(rows: number, bytes: number): void }
  ): Promise<{ rows: number; bytes: number; durationMs: number; cancelled: boolean }> {
    const started = Date.now()
    const limit = Math.max(1, Math.min(Math.trunc(input.options?.maxRows ?? 5_000_000) || 5_000_000, 20_000_000))
    const tableName = input.source.kind === 'table' ? `${quoteIdentifier(input.source.schema)}.${quoteIdentifier(input.source.table)}` : input.source.kind === 'collection' ? undefined : '"query_result"'
    const sink = input.format === 'xlsx' ? createXlsxSink(input.path) : createSink(input.format, input.path, { ...input.options, ...(tableName ? { tableName } : {}) })
    let rows = 0
    let lastReport = 0
    const report = (force = false): void => {
      const now = Date.now()
      if (force || now - lastReport > 250) { lastReport = now; this.touchMongo(connection); hooks.progress(rows, sink.bytes) }
    }
    try {
      if (input.source.kind === 'collection') {
        const filter = parseDocument(input.source.filter, 'Filter')
        const client = await this.mongoSession(connection)
        const cursor = client.db(input.source.database).collection(input.source.collection).find(filter, { batchSize: 1000, maxTimeMS: 600_000 })
        const header: { columns: string[] | null } = { columns: null }
        const buffered: Document[] = []
        const flushHeader = async (): Promise<void> => {
          if (header.columns) return
          const names = new Set<string>()
          for (const document of buffered) for (const key of Object.keys(document)) names.add(key)
          const columns = [...names].sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
          header.columns = columns
          await sink.start(columns)
          for (const document of buffered.splice(0)) { await sink.row(columns.map(name => mongoCell(document[name]))); rows++ }
        }
        for await (const document of cursor) {
          if (hooks.cancelled()) { await cursor.close(); await sink.abort(); return { rows, bytes: sink.bytes, durationMs: Date.now() - started, cancelled: true } }
          if (rows + buffered.length >= limit) break
          if (!header.columns) { buffered.push(document); if (buffered.length >= 100) await flushHeader(); continue }
          await sink.row(header.columns.map(name => mongoCell(document[name])))
          rows++
          report()
        }
        await flushHeader()
        await cursor.close()
      } else {
        const session = await this.pgSession(connection)
        if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    if (session.tx !== 'none') throw new OxeQueryError('invalid', 'A transaction is open on this connection. Commit or roll it back first.')
        let sql: string
        if (input.source.kind === 'table') sql = `SELECT * FROM ${quoteIdentifier(input.source.schema)}.${quoteIdentifier(input.source.table)}`
        else {
          const verdict = guardSql(input.source.sql)
          if (verdict.kind !== 'read') throw new OxeQueryError('invalid', 'Only a query that reads data can be exported.')
          if (verdict.statements !== 1) throw new OxeQueryError('invalid', 'Export one statement at a time.')
          sql = input.source.sql
        }
        session.running = true
        const { client } = session
        let cursor: Cursor | null = null
        let cursorClosed = false
        try {
          await client.query('BEGIN READ ONLY')
          const opened = client.query(new Cursor(sql, [], { rowMode: 'array' }))
          cursor = opened
          const read = (count: number): Promise<{ rows: unknown[][]; fields: { name: string; dataTypeID?: number }[] }> =>
            new Promise((resolve, reject) => opened.read(count, (error, batch, result) => error ? reject(error) : resolve({ rows: batch as unknown[][], fields: ((result as { fields?: { name: string }[] } | undefined)?.fields ?? []) })))
          let headerWritten = false
          for (;;) {
            const batch = await read(1000)
            if (!headerWritten) { await sink.start(batch.fields.map(field => field.name), batch.fields.map(field => field.dataTypeID)); headerWritten = true }
            if (batch.rows.length === 0) break
            for (const row of batch.rows) {
              if (rows >= limit) break
              await sink.row(row)
              rows++
            }
            report()
            if (hooks.cancelled()) { cursorClosed = true; await new Promise<void>(resolve => opened.close(() => resolve())); await sink.abort(); return { rows, bytes: sink.bytes, durationMs: Date.now() - started, cancelled: true } }
            if (rows >= limit) break
          }
          cursorClosed = true
          await new Promise<void>(resolve => opened.close(() => resolve()))
        } finally {
          // An open cursor holds the session: a failure (a file that cannot be written, say) must close it before ROLLBACK can run.
          if (cursor && !cursorClosed) { const open = cursor; await new Promise<void>(resolve => open.close(() => resolve())).catch(() => undefined) }
          await client.query('ROLLBACK').catch(() => undefined)
          session.running = false
          session.lastUsed = Date.now()
        }
      }
      await sink.end()
      report(true)
      return { rows, bytes: sink.bytes, durationMs: Date.now() - started, cancelled: false }
    } catch (error) {
      await sink.abort()
      if (error instanceof OxeQueryError) throw error
      if (connection.engine === 'mongodb') throw this.mongoError(error, connection)
      const message = error instanceof Error ? error.message : 'The export failed'
      if (/canceling statement due to user request/i.test(message)) throw new OxeQueryError('cancelled', 'The export was cancelled.')
      throw new OxeQueryError('query', redact(message, connection.password))
    }
  }

  // ---- Shared -------------------------------------------------------------

  /** True for each driver that actually loaded into this bundle. */
  drivers(): { postgres: boolean; mongodb: boolean; ssh: boolean } {
    return { postgres: typeof Client === 'function' && typeof Cursor === 'function', mongodb: typeof MongoClient === 'function', ssh: tunnelAvailable() }
  }

  async test(connection: ResolvedConnection): Promise<ConnectionTestResult> {
    const started = Date.now()
    try {
      if (connection.engine === 'postgres') {
        const result = await this.pgRun(connection, 'SELECT version()', [], 1, true)
        return { ok: true, message: 'Connected', serverVersion: String(result.rows[0]?.[0] ?? '').split(' on ')[0], latencyMs: Date.now() - started }
      }
      const client = await this.mongoSession(connection)
      const info = await client.db('admin').command({ buildInfo: 1 })
      return { ok: true, message: 'Connected', serverVersion: `MongoDB ${String(info.version ?? '')}`.trim(), latencyMs: Date.now() - started }
    } catch (error) {
      if (error instanceof OxeQueryError) return { ok: false, message: error.message, code: error.code, ...(error.reasons.length ? { reasons: error.reasons } : {}) }
      return { ok: false, message: error instanceof Error ? withConnectionHint(redact(error.message, connection.password), connection) : 'Connection failed' }
    }
  }

  async closeConnection(id: string): Promise<void> {
    const pg = this.pg.get(id), mongo = this.mongo.get(id)
    this.pg.delete(id); this.mongo.delete(id)
    await Promise.allSettled([pg?.client.end(), mongo?.client.close()])
    await Promise.allSettled([pg?.tunnel?.close(), mongo?.tunnel?.close()])
  }

  async closeAll(): Promise<void> {
    clearInterval(this.reaper)
    await Promise.allSettled([...new Set([...this.pg.keys(), ...this.mongo.keys()])].map(id => this.closeConnection(id)))
  }
}
