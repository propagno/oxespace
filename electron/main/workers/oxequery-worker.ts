import { parentPort } from 'node:worker_threads'
import { OxeQueryCore } from '../services/oxequery/oxequery-core'
import { MongoInputError, OxeQueryError, type ResolvedConnection } from '../services/oxequery/oxequery-errors'
import type { MongoAggregateInput, MongoFindInput, SqlBrowseInput } from '../../../shared/types/oxequery'

/**
 * Database drivers live here, off Electron's main thread. Requests run
 * concurrently on purpose: cancelling a query has to be able to overtake it.
 */
const core = new OxeQueryCore()

interface Request { requestId: number; op: string; connection?: ResolvedConnection; input?: Record<string, unknown> }

async function handle(request: Request): Promise<unknown> {
  const connection = request.connection
  const input = (request.input ?? {}) as Record<string, unknown>
  if (request.op === 'closeAll') { await core.closeAll(); return { ok: true } }
  if (request.op === 'ping') return { ok: true, drivers: core.drivers(), node: process.version }
  if (!connection) throw new OxeQueryError('invalid', 'A connection is required.')
  switch (request.op) {
    case 'test': return core.test(connection)
    case 'close': await core.closeConnection(connection.id); return { ok: true }
    case 'sql.run': return core.sqlRun(connection, String(input.sql ?? ''), { maxRows: input.maxRows as number | undefined, confirmed: input.confirmed === true })
    case 'sql.browse': return core.sqlBrowse(connection, input as unknown as SqlBrowseInput)
    case 'sql.schemas': return core.sqlSchemas(connection)
    case 'sql.tables': return core.sqlTables(connection, String(input.schema ?? ''))
    case 'sql.table': return core.sqlTable(connection, String(input.schema ?? ''), String(input.table ?? ''))
    case 'sql.cancel': return { cancelled: await core.sqlCancel(connection) }
    case 'mongo.databases': return core.mongoDatabases(connection)
    case 'mongo.collections': return core.mongoCollections(connection, String(input.database ?? ''))
    case 'mongo.find': return core.mongoFind(connection, input as unknown as MongoFindInput)
    case 'mongo.aggregate': return core.mongoAggregate(connection, input as unknown as MongoAggregateInput)
    case 'mongo.indexes': return core.mongoIndexes(connection, String(input.database ?? ''), String(input.collection ?? ''))
    default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')
  }
}

parentPort?.on('message', (request: Request) => {
  void handle(request).then(
    result => parentPort?.postMessage({ requestId: request.requestId, result }),
    (error: unknown) => parentPort?.postMessage({
      requestId: request.requestId,
      error: error instanceof OxeQueryError
        ? { code: error.code, message: error.message, reasons: error.reasons }
        : error instanceof MongoInputError ? { code: 'invalid', message: error.message, reasons: [] }
        : { code: 'query', message: error instanceof Error ? error.message : 'Operation failed', reasons: [] }
    })
  )
})
