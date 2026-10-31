import { parentPort } from 'node:worker_threads'
import { OxeQueryCore } from '../services/oxequery/oxequery-core'
import { MongoInputError, OxeQueryError, type ResolvedConnection } from '../services/oxequery/oxequery-errors'
import type { MongoAggregateInput, MongoFindInput, MongoWriteInput, SqlBrowseInput } from '../../../shared/types/oxequery'

/**
 * Database drivers live here, off Electron's main thread. Requests run
 * concurrently on purpose: cancelling a query has to be able to overtake it.
 */
const core = new OxeQueryCore()

interface Request { requestId: number; op: string; connection?: ResolvedConnection; input?: Record<string, unknown> }

/** Exports that can still be cancelled, by the caller's export id. */
const exports = new Map<string, { cancelled: boolean }>()

/** Requests that stop or close work; they never count as work on the session they target. */
const UNTRACKED = new Set(['close', 'sql.cancel', 'mongo.cancel'])

async function handle(request: Request): Promise<unknown> {
  if (request.op === 'export.cancel' || request.op === 'import.cancel') {
    const active = exports.get(String(request.input?.exportId ?? request.input?.importId ?? ''))
    if (active) active.cancelled = true
    return { cancelled: Boolean(active) }
  }
  const connection = request.connection
  const input = (request.input ?? {}) as Record<string, unknown>
  if (request.op === 'closeAll') { await core.closeAll(); return { ok: true } }
  if (request.op === 'ping') return { ok: true, drivers: core.drivers(), node: process.version }
  if (!connection) throw new OxeQueryError('invalid', 'A connection is required.')
  // While a request runs, its session is busy: a key change or the idle reaper never closes it (oxequery-core `track`).
  return UNTRACKED.has(request.op) ? dispatch(request, connection, input) : core.track(connection, () => dispatch(request, connection, input))
}

async function dispatch(request: Request, connection: ResolvedConnection, input: Record<string, unknown>): Promise<unknown> {
  switch (request.op) {
    case 'test': return core.test(connection)
    case 'close': await core.closeConnection(connection.id, connection.role); return { ok: true }
    case 'sql.run': return core.sqlRun(connection, String(input.sql ?? ''), { maxRows: input.maxRows as number | undefined, confirmed: input.confirmed === true, params: input.params as (string | null)[] | undefined, paged: input.paged === true })
    case 'sql.more': return core.sqlMore(connection, String(input.pageId ?? ''), input.maxRows as number | undefined)
    case 'sql.script': return core.sqlScript(connection, String(input.sql ?? ''), { maxRows: input.maxRows as number | undefined, confirmed: input.confirmed === true })
    case 'sql.tx': return input.action === 'status' ? core.txState(connection) : core.sqlTx(connection, input.action as 'begin' | 'commit' | 'rollback')
    case 'sql.browse': return core.sqlBrowse(connection, input as unknown as SqlBrowseInput)
    case 'sql.schemas': return core.sqlSchemas(connection)
    case 'sql.tables': return core.sqlTables(connection, String(input.schema ?? ''))
    case 'sql.table': return core.sqlTable(connection, String(input.schema ?? ''), String(input.table ?? ''))
    case 'sql.cancel': return { cancelled: await core.sqlCancel(connection) }
    case 'sql.editability': return core.sqlEditability(connection, String(input.schema ?? ''), String(input.table ?? ''))
    case 'sql.previewChanges': return { statements: await core.sqlPreviewChanges(connection, input as never) }
    case 'sql.apply': return core.sqlApply(connection, input as never)
    case 'sql.structure.preview': return core.structurePreview(connection, input as never)
    case 'sql.structure.apply': return core.structureApply(connection, input as never)
    case 'sql.maintenance': return core.maintenance(connection, input as never)
    case 'mongo.databases': return core.mongoDatabases(connection)
    case 'mongo.collections': return core.mongoCollections(connection, String(input.database ?? ''))
    case 'mongo.find': return core.mongoFind(connection, input as unknown as MongoFindInput)
    case 'mongo.aggregate': return core.mongoAggregate(connection, input as unknown as MongoAggregateInput)
    case 'export.run': {
      const exportId = String(input.exportId ?? '')
      if (!exportId || exports.has(exportId)) throw new OxeQueryError('invalid', 'This export is already running.')
      const state = { cancelled: false }
      exports.set(exportId, state)
      try {
        return await core.exportRun(connection, input as never, {
          cancelled: () => state.cancelled,
          progress: (rows, bytes) => parentPort?.postMessage({ requestId: request.requestId, progress: { exportId, rows, bytes } })
        })
      } finally { exports.delete(exportId) }
    }
    case 'sql.explain':
      return core.sqlExplain(connection, input as never)
    case 'import.preview':
      return core.importPreview(connection, input as never)
    case 'import.run': {
      const importId = String(input.importId ?? '')
      if (!importId || exports.has(importId)) throw new OxeQueryError('invalid', 'This import is already running.')
      const state = { cancelled: false }
      exports.set(importId, state)
      try {
        return await core.importRun(connection, input as never, {
          cancelled: () => state.cancelled,
          progress: rows => parentPort?.postMessage({ requestId: request.requestId, progress: { importId, rows } })
        })
      } finally { exports.delete(importId) }
    }
    case 'mongo.write': return core.mongoWrite(connection, input as unknown as MongoWriteInput)
    case 'mongo.document': return core.mongoDocument(connection, { database: String(input.database ?? ''), collection: String(input.collection ?? ''), id: String(input.id ?? '') })
    case 'mongo.schema': return core.mongoSchema(connection, String(input.database ?? ''), String(input.collection ?? ''), typeof input.sampleSize === 'number' ? input.sampleSize : undefined)
    case 'mongo.createIndex': return core.mongoCreateIndex(connection, input as never)
    case 'mongo.dropIndex': return core.mongoDropIndex(connection, input as never)
    case 'sql.functions': return core.sqlFunctions(connection, String(input.schema ?? ''))
    case 'sql.databases': return core.sqlDatabases(connection)
    case 'sql.createDatabase': return core.sqlCreateDatabase(connection, input as never)
    case 'sql.dropDatabase': return core.sqlDropDatabase(connection, input as never)
    case 'sql.roles': return core.sqlRoles(connection)
    case 'sql.objects': return core.sqlObjects(connection, String(input.schema ?? ''))
    case 'sql.extensions': return core.sqlExtensions(connection)
    case 'sql.search': return core.sqlSearch(connection, String(input.query ?? ''))
    case 'sql.definition': return core.sqlDefinition(connection, input as never)
    case 'mongo.bulk': return core.mongoBulk(connection, input as never)
    case 'mongo.collection': return core.mongoCollectionAction(connection, input as never)
    case 'mongo.stats': return core.mongoStats(connection, String(input.database ?? ''), String(input.collection ?? ''))
    case 'mongo.validation': return core.mongoValidation(connection, String(input.database ?? ''), String(input.collection ?? ''))
    case 'mongo.setValidation': return core.mongoSetValidation(connection, input as never)
    case 'mongo.explain': return core.mongoExplain(connection, input as never)
    case 'mongo.cancel': return { cancelled: await core.mongoCancel(connection) }
    case 'mongo.indexes': return core.mongoIndexes(connection, String(input.database ?? ''), String(input.collection ?? ''))
    default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')
  }
}

// Every answer says how many of the person's sessions would lose work if the worker stopped: the main process never
// restarts the worker while that is above zero (worker-client `probe`).
parentPort?.on('message', (request: Request) => {
  void handle(request).then(
    result => parentPort?.postMessage({ requestId: request.requestId, result, personAtRisk: core.personAtRisk() }),
    (error: unknown) => parentPort?.postMessage({
      requestId: request.requestId,
      personAtRisk: core.personAtRisk(),
      error: error instanceof OxeQueryError
        ? { code: error.code, message: error.message, reasons: error.reasons, detail: error.detail, ...(error.messageCode ? { messageCode: error.messageCode } : {}) }
        : error instanceof MongoInputError ? { code: 'invalid', message: error.message, reasons: [] }
        : { code: 'query', message: error instanceof Error ? error.message : 'Operation failed', reasons: [] }
    })
  )
})
