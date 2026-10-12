import { createHash } from 'node:crypto'
import { Client } from 'pg'
import Cursor from 'pg-cursor'
import { MongoClient, type Document } from 'mongodb'
import type {
  ConnectionTestResult, MongoAggregateInput, MongoCollectionInfo, MongoDatabaseInfo, MongoFindInput, MongoIndexInfo, MongoResult,
  SqlBrowseInput, SqlColumn, SqlResult, SqlTable, SqlTableDetails
} from '../../../../shared/types/oxequery'
import { guardSql, isMutating, quoteIdentifier } from './sql-guard'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { parseDocument, parsePipeline, toEjson } from './mongo-guard'

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

function clampRows(value: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(value ?? DEFAULT_ROWS) || DEFAULT_ROWS, MAX_ROWS))
}

function sessionKey(connection: ResolvedConnection): string {
  return createHash('sha256').update(JSON.stringify([connection.engine, connection.host, connection.port, connection.database, connection.username, connection.password ?? '', connection.sslMode, connection.readOnly])).digest('hex')
}

interface PgSession { key: string; client: Client; running: boolean }
interface MongoSession { key: string; client: MongoClient }

/**
 * The database drivers. It runs inside the OxeQuery worker, so a slow or broken
 * connection can never block the main process; tests drive it directly.
 */
export class OxeQueryCore {
  private readonly pg = new Map<string, PgSession>()
  private readonly mongo = new Map<string, MongoSession>()

  // ---- Postgres -----------------------------------------------------------

  private pgConfig(connection: ResolvedConnection) {
    return {
      host: connection.host, port: connection.port, database: connection.database || 'postgres', user: connection.username || undefined, password: connection.password,
      ssl: connection.sslMode === 'require' ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS, statement_timeout: STATEMENT_TIMEOUT_MS, query_timeout: STATEMENT_TIMEOUT_MS + 5000,
      application_name: 'OxeQuery'
    }
  }

  private async pgSession(connection: ResolvedConnection): Promise<PgSession> {
    const key = sessionKey(connection)
    const existing = this.pg.get(connection.id)
    if (existing?.key === key) return existing
    if (existing) await this.closeConnection(connection.id)
    const client = new Client(this.pgConfig(connection))
    client.on('error', () => { if (this.pg.get(connection.id)?.client === client) this.pg.delete(connection.id) })
    try { await client.connect() } catch (error) {
      throw new OxeQueryError('connect', redact(error instanceof Error ? error.message : 'Connection failed', connection.password))
    }
    const session = { key, client, running: false }
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
      if (/statement timeout/i.test(message)) throw new OxeQueryError('timeout', `The query ran longer than ${STATEMENT_TIMEOUT_MS / 1000}s and was stopped.`)
      throw new OxeQueryError('query', redact(message, connection.password))
    } finally {
      client.off('notice', onNotice)
      if (readOnly) await client.query('ROLLBACK').catch(() => undefined)
      session.running = false
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
    return this.pgRun(connection, sql, [], clampRows(options.maxRows), connection.readOnly)
  }

  async sqlBrowse(connection: ResolvedConnection, input: SqlBrowseInput): Promise<SqlResult> {
    const limit = clampRows(input.limit ?? 100)
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
    const killer = new Client(this.pgConfig(connection))
    try {
      await killer.connect()
      await killer.query('SELECT pg_cancel_backend($1)', [pid])
      return true
    } catch { return false } finally { await killer.end().catch(() => undefined) }
  }

  // ---- MongoDB ------------------------------------------------------------

  private mongoUri(connection: ResolvedConnection): string {
    const credentials = connection.username ? `${encodeURIComponent(connection.username)}${connection.password ? `:${encodeURIComponent(connection.password)}` : ''}@` : ''
    const host = connection.host.includes(':') && !connection.host.startsWith('[') ? `[${connection.host}]` : connection.host
    const options = new URLSearchParams({ authSource: 'admin', directConnection: 'true', appName: 'OxeQuery' })
    if (connection.sslMode === 'require') { options.set('tls', 'true'); options.set('tlsAllowInvalidCertificates', 'true') }
    return `mongodb://${credentials}${host}:${connection.port}/?${options.toString()}`
  }

  private async mongoSession(connection: ResolvedConnection): Promise<MongoClient> {
    const key = sessionKey(connection)
    const existing = this.mongo.get(connection.id)
    if (existing?.key === key) return existing.client
    if (existing) await this.closeConnection(connection.id)
    const client = new MongoClient(this.mongoUri(connection), { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS, connectTimeoutMS: CONNECT_TIMEOUT_MS, maxPoolSize: 4 })
    try { await client.connect() } catch (error) {
      await client.close().catch(() => undefined)
      throw new OxeQueryError('connect', redact(error instanceof Error ? error.message : 'Connection failed', connection.password))
    }
    this.mongo.set(connection.id, { key, client })
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

  // ---- Shared -------------------------------------------------------------

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
      return { ok: false, message: error instanceof Error ? redact(error.message, connection.password) : 'Connection failed' }
    }
  }

  async closeConnection(id: string): Promise<void> {
    const pg = this.pg.get(id), mongo = this.mongo.get(id)
    this.pg.delete(id); this.mongo.delete(id)
    await Promise.allSettled([pg?.client.end(), mongo?.client.close()])
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...new Set([...this.pg.keys(), ...this.mongo.keys()])].map(id => this.closeConnection(id)))
  }
}
