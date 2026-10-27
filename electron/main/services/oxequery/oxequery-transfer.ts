import Cursor from 'pg-cursor'
import type { Document, MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import type { ExportFormat, ExportSource, ImportConflict, ImportTarget } from '../../../../shared/types/oxequery'
import type { ColumnMeta } from './table-editor'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { mongoCell, redact, type PgSession } from './oxequery-core'
import { guardSql, quoteIdentifier } from './sql-guard'
import { parseDocument } from './mongo-guard'
import { createSink } from './export-writer'
import { createXlsxSink } from './xlsx-writer'
import { describeFile, openRejects, readRecords, type ImportFormat, type ImportOptions } from './import-reader'

/**
 * Import from a file and export to a file, for both engines. They run on the core's sessions, which they reach
 * through this narrow host rather than through the whole core.
 */
export interface TransferHost {
  pgSession(connection: ResolvedConnection): Promise<PgSession>
  mongoSession(connection: ResolvedConnection): Promise<MongoClient>
  touchMongo(connection: ResolvedConnection): void
  mongoError(error: unknown, connection: ResolvedConnection): OxeQueryError
  columnMeta(connection: ResolvedConnection, schema: string, table: string): Promise<{ columns: ColumnMeta[] }>
}

/** The first rows of a file and the destination's columns, so a mapping can be chosen. */
export async function importPreview(host: TransferHost, connection: ResolvedConnection, input: { path: string; format: ImportFormat; target: ImportTarget; options?: ImportOptions }): Promise<{
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
    targetColumns = (await host.columnMeta(connection, input.target.schema, input.target.table)).columns.map(({ name, type, nullable, hasDefault, generated }) => ({ name, type, nullable, hasDefault, generated }))
  } else if (connection.engine !== 'mongodb') throw new OxeQueryError('invalid', 'A collection import needs a MongoDB connection.')
  const detected = input.format === 'csv' ? await describeFile(input.path, input.options ?? {}) : undefined
  return { fields, sample: rows.map(record => fields.map(field => text(record[field]))), targetColumns, ...(detected ? { detected } : {}) }
}

/**
 * Inserts the rows of a file. A table import runs in one transaction in batches,
 * so a failure leaves nothing behind; a dry run does the same and rolls back.
 * Rows that cannot be read are rejected into a file next to the source.
 */
export async function importRun(
  host: TransferHost,
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
      const client = await host.mongoSession(connection)
      const collection = client.db(input.target.database).collection(input.target.collection)
      let batch: Document[] = []
      let seen = 0
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        const documents = batch
        batch = []
        host.touchMongo(connection)
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
    const { columns } = await host.columnMeta(connection, input.target.schema, input.target.table)
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
    const session = await host.pgSession(connection)
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
    if (connection.engine === 'mongodb') throw host.mongoError(error, connection)
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
export async function exportRun(
  host: TransferHost,
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
    if (force || now - lastReport > 250) { lastReport = now; host.touchMongo(connection); hooks.progress(rows, sink.bytes) }
  }
  try {
    if (input.source.kind === 'collection') {
      const filter = parseDocument(input.source.filter, 'Filter')
      const client = await host.mongoSession(connection)
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
      const session = await host.pgSession(connection)
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
    if (connection.engine === 'mongodb') throw host.mongoError(error, connection)
    const message = error instanceof Error ? error.message : 'The export failed'
    if (/canceling statement due to user request/i.test(message)) throw new OxeQueryError('cancelled', 'The export was cancelled.')
    throw new OxeQueryError('query', redact(message, connection.password))
  }
}
