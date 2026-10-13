import { createHash } from 'node:crypto'
import { Client } from 'pg'
import Cursor from 'pg-cursor'
import { MongoClient, type Document } from 'mongodb'
import type {
  ConnectionTestResult, MongoWriteInput, MongoWriteResult, SqlApplyInput, SqlApplyResult, SqlEditability, MongoAggregateInput, MongoCollectionInfo, MongoDatabaseInfo, MongoFindInput, MongoIndexInfo, MongoResult,
  SqlBrowseInput, SqlColumn, SqlResult, SqlTable, SqlTableDetails
} from '../../../../shared/types/oxequery'
import { guardSql, isMutating, quoteIdentifier } from './sql-guard'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { mongoTlsOptions, mongoUri, pgSsl, type Endpoint } from './connection-options'
import { openTunnel, tunnelAvailable, type OpenTunnel } from './ssh-tunnel'
import { parseDocument, parsePipeline, toEjson } from './mongo-guard'
import { EJSON } from 'bson'
import { buildStatements, previewStatements, type ColumnMeta, type RowChange } from './table-editor'
import { createSink } from './export-writer'
import { parsePlan, planHints } from './plan-parser'
import type { SqlExplain } from '../../../../shared/types/oxequery'
import { openRejects, readRecords, type ImportFormat } from './import-reader'
import type { ImportTarget } from '../../../../shared/types/oxequery'
import type { ExportFormat, ExportSource } from '../../../../shared/types/oxequery'

const DEFAULT_ROWS = 500
const MAX_ROWS = 10_000
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

interface PgSession { key: string; client: Client; running: boolean; lastUsed: number; endpoint: Endpoint; tunnel?: OpenTunnel }
interface MongoSession { key: string; client: MongoClient; lastUsed: number; tunnel?: OpenTunnel }

/** A connection nobody used for this long is closed; it reopens on the next request. */
const IDLE_MS = 10 * 60_000
const MAX_SESSIONS = 12

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
      ...[...this.pg].filter(([, session]) => !session.running).map(([id, session]) => ({ id, lastUsed: session.lastUsed })),
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
    const tunnel = await openTunnel(connection.ssh, { host: connection.host, port: connection.port })
    return { endpoint: tunnel.endpoint, tunnel }
  }

  private pgConfig(connection: ResolvedConnection, endpoint: Endpoint) {
    const timeout = this.timeoutOf(connection)
    return {
      host: endpoint.host, port: endpoint.port, database: connection.database || 'postgres', user: connection.username || undefined, password: connection.password,
      ssl: pgSsl(connection),
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: timeout, query_timeout: timeout + 5000,
      application_name: 'OxeQuery'
    }
  }

  private async pgSession(connection: ResolvedConnection): Promise<PgSession> {
    const key = sessionKey(connection)
    const existing = this.pg.get(connection.id)
    if (existing?.key === key) { existing.lastUsed = Date.now(); return existing }
    if (existing) await this.closeConnection(connection.id)
    const { endpoint, tunnel } = await this.reach(connection)
    const client = new Client(this.pgConfig(connection, endpoint))
    client.on('error', () => { if (this.pg.get(connection.id)?.client === client) { this.pg.delete(connection.id); void tunnel?.close() } })
    try { await client.connect() } catch (error) {
      await tunnel?.close()
      throw new OxeQueryError('connect', redact(error instanceof Error ? error.message : 'Connection failed', connection.password, connection.ssh?.password, connection.ssh?.passphrase))
    }
    const session: PgSession = { key, client, running: false, lastUsed: Date.now(), endpoint, ...(tunnel ? { tunnel } : {}) }
    // A tunnel that drops under a live session would leave a client talking to nothing.
    tunnel?.onClose(() => { if (this.pg.get(connection.id) === session) this.pg.delete(connection.id) })
    this.pg.set(connection.id, session)
    return session
  }

  private async pgRun(connection: ResolvedConnection, sql: string, params: unknown[], maxRows: number, readOnly: boolean): Promise<SqlResult> {
    const session = await this.pgSession(connection)
    if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
    session.running = true
    const started = Date.now()
    const { client } = session
    const notices: string[] = []
    const onNotice = (notice: { message?: string }): void => { if (notices.length < 20 && notice.message) notices.push(notice.message.slice(0, 500)) }
    client.on('notice', onNotice)
    try {
      if (readOnly) await client.query('BEGIN READ ONLY')
      const verdict = guardSql(sql)
      let result: SqlResult
      if (verdict.statements > 1 && params.length === 0) {
        // Several statements need the simple protocol; results are capped afterwards.
        const raw = await client.query({ text: sql, rowMode: 'array' })
        const last = (Array.isArray(raw) ? raw[raw.length - 1] : raw) as { fields?: { name: string; dataTypeID: number }[]; rows?: unknown[][]; command?: string; rowCount?: number | null } | undefined
        const rows = (last?.rows ?? []).slice(0, maxRows + 1)
        result = {
          columns: (last?.fields ?? []).map((field): SqlColumn => ({ name: field.name, type: TYPE_NAMES[field.dataTypeID] ?? `oid:${field.dataTypeID}` })),
          rows: rows.slice(0, maxRows).map(row => row.map(cell)), rowCount: Math.min(rows.length, maxRows), truncated: rows.length > maxRows,
          durationMs: 0, ...(last?.command ? { command: last.command } : {}), ...(typeof last?.rowCount === 'number' ? { affectedRows: last.rowCount } : {})
        }
      } else {
        const cursor = client.query(new Cursor(sql, params, { rowMode: 'array' }))
        const read = (count: number): Promise<{ rows: unknown[][]; result: { fields?: { name: string; dataTypeID: number }[]; command?: string; rowCount?: number | null } }> =>
          new Promise((resolve, reject) => cursor.read(count, (error, rows, outcome) => error ? reject(error) : resolve({ rows: rows as unknown[][], result: outcome as never })))
        try {
          const { rows, result: outcome } = await read(maxRows + 1)
          result = {
            columns: (outcome.fields ?? []).map((field): SqlColumn => ({ name: field.name, type: TYPE_NAMES[field.dataTypeID] ?? `oid:${field.dataTypeID}` })),
            rows: rows.slice(0, maxRows).map(row => row.map(cell)), rowCount: Math.min(rows.length, maxRows), truncated: rows.length > maxRows, durationMs: 0,
            ...(outcome.command ? { command: outcome.command } : {}), ...(typeof outcome.rowCount === 'number' && outcome.command !== 'SELECT' ? { affectedRows: outcome.rowCount } : {})
          }
        } finally {
          await new Promise<void>(resolve => cursor.close(() => resolve()))
        }
      }
      return { ...result, durationMs: Date.now() - started, ...(notices.length ? { notices } : {}) }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Query failed'
      if (/canceling statement due to user request/i.test(message)) throw new OxeQueryError('cancelled', 'The query was cancelled.')
      if (/statement timeout/i.test(message)) throw new OxeQueryError('timeout', `The query ran longer than ${Math.round(this.timeoutOf(connection) / 1000)}s and was stopped.`)
      throw new OxeQueryError('query', redact(message, connection.password))
    } finally {
      client.off('notice', onNotice)
      if (readOnly) await client.query('ROLLBACK').catch(() => undefined)
      session.running = false
      session.lastUsed = Date.now()
    }
  }

  async sqlRun(connection: ResolvedConnection, sql: string, options: { maxRows?: number; confirmed?: boolean } = {}): Promise<SqlResult> {
    if (typeof sql !== 'string' || sql.length > 1024 * 1024) throw new OxeQueryError('invalid', 'The SQL is empty or too large.')
    const verdict = guardSql(sql)
    if (verdict.kind === 'empty') throw new OxeQueryError('invalid', 'There is nothing to run.')
    if (connection.readOnly && isMutating(verdict)) {
      throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to run statements that change data.', verdict.reasons)
    }
    if (verdict.kind === 'destructive' && !options.confirmed) {
      throw new OxeQueryError('confirm', 'This statement is destructive and needs confirmation.', verdict.reasons)
    }
    return this.pgRun(connection, sql, [], clampRows(options.maxRows ?? connection.maxRows), connection.readOnly)
  }

  async sqlBrowse(connection: ResolvedConnection, input: SqlBrowseInput): Promise<SqlResult> {
    const limit = clampRows(input.limit ?? Math.min(100, connection.maxRows ?? 100))
    const offset = Math.max(0, Math.min(Math.trunc(input.offset ?? 0) || 0, 10_000_000))
    const order = input.orderBy ? ` ORDER BY ${quoteIdentifier(input.orderBy.column)} ${input.orderBy.direction === 'desc' ? 'DESC' : 'ASC'}` : ''
    const sql = `SELECT * FROM ${quoteIdentifier(input.schema)}.${quoteIdentifier(input.table)}${order} LIMIT ${limit + 1} OFFSET ${offset}`
    const result = await this.pgRun(connection, sql, [], limit, true)
    return result
  }

  async sqlSchemas(connection: ResolvedConnection): Promise<string[]> {
    const result = await this.pgRun(connection, `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'
      ORDER BY (nspname = 'public') DESC, (nspname IN ('pg_catalog', 'information_schema')), nspname`, [], 500, true)
    return result.rows.map(row => String(row[0]))
  }

  async sqlTables(connection: ResolvedConnection, schema: string): Promise<SqlTable[]> {
    const result = await this.pgRun(connection, `SELECT c.relname, c.relkind, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'v', 'm', 'f', 'p') ORDER BY c.relname`, [schema], 5000, true)
    const kinds: Record<string, SqlTable['kind']> = { r: 'table', v: 'view', m: 'materialized view', f: 'foreign table', p: 'partitioned table' }
    return result.rows.map(row => ({ schema, name: String(row[0]), kind: kinds[String(row[1])] ?? 'table', ...(Number(row[2]) >= 0 ? { approxRows: Number(row[2]) } : {}) }))
  }

  async sqlTable(connection: ResolvedConnection, schema: string, table: string): Promise<SqlTableDetails> {
    const oid = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2)`
    const columns = await this.pgRun(connection, `SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
        COALESCE(a.attnum = ANY (SELECT unnest(i.indkey) FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary), false), a.attnum
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ${oid} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, table], 2000, true)
    const indexes = await this.pgRun(connection, `SELECT ic.relname, pg_get_indexdef(i.indexrelid), i.indisunique, i.indisprimary
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid WHERE i.indrelid = ${oid} ORDER BY ic.relname`, [schema, table], 500, true)
    const foreign = await this.pgRun(connection, `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = ${oid} AND contype = 'f' ORDER BY conname`, [schema, table], 500, true)
    return {
      columns: columns.rows.map(row => ({ name: String(row[0]), type: String(row[1]), nullable: Boolean(row[2]), ...(row[3] ? { default: String(row[3]) } : {}), primaryKey: Boolean(row[4]), position: Number(row[5]) })),
      indexes: indexes.rows.map(row => ({ name: String(row[0]), definition: String(row[1]), unique: Boolean(row[2]), primary: Boolean(row[3]) })),
      foreignKeys: foreign.rows.map(row => ({ name: String(row[0]), definition: String(row[1]) }))
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
    const kind = await this.pgRun(connection, `SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`, [schema, table], 1, true)
    const relkind = kind.rows[0] ? String(kind.rows[0][0]) : null
    const columns = await this.pgRun(connection, `SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.atthasdef,
        (a.attgenerated <> '' OR a.attidentity = 'a') AS generated
      FROM pg_attribute a WHERE a.attrelid = ${target} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [schema, table], 2000, true)
    const primary = await this.pgRun(connection, `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = ${target} AND i.indisprimary`, [schema, table], 64, true)
    let keyNames = primary.rows.map(row => String(row[0]))
    if (keyNames.length === 0) {
      const unique = await this.pgRun(connection, `SELECT array_agg(a.attname ORDER BY a.attnum)::text[] FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = ${target} AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
        GROUP BY i.indexrelid HAVING bool_and(a.attnotnull) ORDER BY count(*), i.indexrelid LIMIT 1`, [schema, table], 1, true)
      const names = unique.rows[0]?.[0]
      keyNames = typeof names === 'string' ? names.replace(/^\{|\}$/g, '').split(',').map(name => name.replace(/^"|"$/g, '')) : []
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
      throw new OxeQueryError('connect', redact(error instanceof Error ? error.message : 'Connection failed', connection.password, connection.ssh?.password, connection.ssh?.passphrase))
    }
    const session: MongoSession = { key, client, lastUsed: Date.now(), ...(tunnel ? { tunnel } : {}) }
    tunnel?.onClose(() => { if (this.mongo.get(connection.id) === session) this.mongo.delete(connection.id) })
    this.mongo.set(connection.id, session)
    return client
  }

  private mongoError(error: unknown, connection: ResolvedConnection): OxeQueryError {
    if (error instanceof OxeQueryError) return error
    const message = error instanceof Error ? error.message : 'Operation failed'
    if (/time limit|exceeded time|MaxTimeMSExpired/i.test(message)) return new OxeQueryError('timeout', 'The operation exceeded its time limit and was stopped.')
    return new OxeQueryError('query', redact(message, connection.password))
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
      const found = await collection.find(filter, { ...(projection ? { projection } : {}), ...(sort ? { sort: sort as never } : {}), limit: limit + 1, skip, maxTimeMS: 30_000 }).toArray()
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
      const documents = await client.db(input.database).collection(input.collection).aggregate([...pipeline, { $limit: limit + 1 }], { maxTimeMS: 30_000 }).toArray()
      return this.mongoResult(documents, limit, started)
    } catch (error) { throw this.mongoError(error, connection) }
  }

  async mongoWrite(connection: ResolvedConnection, input: MongoWriteInput): Promise<MongoWriteResult> {
    if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to change documents.')
    const document = input.op === 'delete' ? undefined : parseDocument(input.document, 'Document')
    const expected = input.expected ? parseDocument(input.expected, 'Original document') : undefined
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
      // Compare what is stored now with what the person was looking at.
      const current = await collection.findOne({ _id: expected!._id } as Document)
      if (!current) throw new OxeQueryError('conflict', 'The document no longer exists. Reload the collection.')
      if (EJSON.stringify(current as never, { relaxed: true }) !== EJSON.stringify(expected as never, { relaxed: true })) {
        throw new OxeQueryError('conflict', 'The document changed since you opened it, so nothing was saved. Reload it and apply your edit again.')
      }
      if (input.op === 'delete') {
        const result = await collection.deleteOne({ _id: expected!._id } as Document)
        return { matched: result.deletedCount, modified: 0, deleted: result.deletedCount }
      }
      const result = await collection.replaceOne({ _id: expected!._id } as Document, { ...(document as Document), _id: expected!._id })
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

  private mongoResult(documents: Document[], limit: number, started: number, total?: number): MongoResult {
    return {
      documents: documents.slice(0, limit).map(document => toEjson(document).text),
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
  async importPreview(connection: ResolvedConnection, input: { path: string; format: ImportFormat; target: ImportTarget }): Promise<{
    fields: string[]; sample: string[][]; targetColumns: { name: string; type: string; nullable: boolean; hasDefault: boolean; generated: boolean }[]
  }> {
    const fields: string[] = []
    const rows: Record<string, unknown>[] = []
    for await (const item of readRecords(input.path, input.format)) {
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
    return { fields, sample: rows.map(record => fields.map(field => text(record[field]))), targetColumns }
  }

  /**
   * Inserts the rows of a file. A table import runs in one transaction in batches,
   * so a failure leaves nothing behind; a dry run does the same and rolls back.
   * Rows that cannot be read are rejected into a file next to the source.
   */
  async importRun(
    connection: ResolvedConnection,
    input: { path: string; format: ImportFormat; target: ImportTarget; mapping: Record<string, string>; dryRun?: boolean; emptyAsNull?: boolean },
    hooks: { cancelled(): boolean; progress(rows: number): void }
  ): Promise<{ dryRun: boolean; inserted: number; rejected: number; rejects: { row: number; reason: string }[]; rejectsPath?: string; cancelled: boolean; durationMs: number }> {
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
    let lastReport = 0
    const report = (seen: number): void => { const now = Date.now(); if (now - lastReport > 250) { lastReport = now; hooks.progress(seen) } }
    const finish = async (cancelled: boolean): Promise<{ dryRun: boolean; inserted: number; rejected: number; rejects: { row: number; reason: string }[]; rejectsPath?: string; cancelled: boolean; durationMs: number }> => {
      await rejectsFile?.close().catch(() => undefined)
      return { dryRun, inserted, rejected, rejects, ...(rejectsPath ? { rejectsPath } : {}), cancelled, durationMs: Date.now() - started }
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
        for await (const item of readRecords(input.path, input.format)) {
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
      const insertSql = (count: number): string => `INSERT INTO ${table} (${metas.map(meta => quoteIdentifier(meta.name)).join(', ')}) VALUES ${
        Array.from({ length: count }, (_, rowIndex) => `(${metas.map((meta, columnIndex) => `$${rowIndex * metas.length + columnIndex + 1}::${meta.type}`).join(', ')})`).join(', ')}`
      const session = await this.pgSession(connection)
      if (session.running) throw new OxeQueryError('invalid', 'This connection is already running a query. Wait for it or cancel it.')
      session.running = true
      const { client } = session
      let batch: (string | null)[][] = []
      let rowsSeen = 0
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        const rows = batch
        batch = []
        await client.query({ text: insertSql(rows.length), values: rows.flat() })
        inserted += rows.length
      }
      try {
        await client.query('BEGIN')
        try {
          for await (const item of readRecords(input.path, input.format)) {
            if (hooks.cancelled()) { await client.query('ROLLBACK'); inserted = 0; return await finish(true) }
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
          inserted = 0
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
    const sink = createSink(input.format, input.path, { ...input.options, ...(tableName ? { tableName } : {}) })
    let rows = 0
    let lastReport = 0
    const report = (force = false): void => {
      const now = Date.now()
      if (force || now - lastReport > 250) { lastReport = now; hooks.progress(rows, sink.bytes) }
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
        try {
          await client.query('BEGIN READ ONLY')
          const cursor = client.query(new Cursor(sql, [], { rowMode: 'array' }))
          const read = (count: number): Promise<{ rows: unknown[][]; fields: { name: string }[] }> =>
            new Promise((resolve, reject) => cursor.read(count, (error, batch, result) => error ? reject(error) : resolve({ rows: batch as unknown[][], fields: ((result as { fields?: { name: string }[] }).fields ?? []) })))
          let headerWritten = false
          for (;;) {
            const batch = await read(1000)
            if (!headerWritten) { await sink.start(batch.fields.map(field => field.name)); headerWritten = true }
            if (batch.rows.length === 0) break
            for (const row of batch.rows) {
              if (rows >= limit) break
              await sink.row(row)
              rows++
            }
            report()
            if (hooks.cancelled()) { await new Promise<void>(resolve => cursor.close(() => resolve())); await sink.abort(); return { rows, bytes: sink.bytes, durationMs: Date.now() - started, cancelled: true } }
            if (rows >= limit) break
          }
          await new Promise<void>(resolve => cursor.close(() => resolve()))
        } finally {
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
      return { ok: false, message: error instanceof Error ? redact(error.message, connection.password) : 'Connection failed' }
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
