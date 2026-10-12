import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ExecutionHost } from '../../runtime/execution-host'
import type {
  ContainerAction, ContainerEngine, OxeQueryConnection, OxeQueryConnectionInput, OxeQueryErrorInfo, OxeQueryEvent, OxeQueryOp, OxeQueryOps, OxeQueryResponse,
  SqlBrowseInput
} from '../../../../shared/types/oxequery'
import { ConnectionInputError, ConnectionStore, type SecretCipher } from './connection-store'
import { ContainerRuntime, ContainerRuntimeError } from './container-runtime'
import { MongoInputError, OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { guardSql } from './sql-guard'
import type { OxeQueryWorkerClient } from './worker-client'

type Raw = Record<string, unknown>
const ACTIONS = new Set(['start', 'stop', 'restart', 'pause', 'unpause'])
const MAX_SHELLS = 32

function record(value: unknown): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OxeQueryError('invalid', 'Invalid request.')
  return value as Raw
}
function str(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) throw new OxeQueryError('invalid', `${label} is required.`)
  return value
}
function optionalString(value: unknown, max = 262_144): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new OxeQueryError('invalid', 'Invalid text input.')
  return value
}
function optionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new OxeQueryError('invalid', 'Invalid number.')
  return value as number
}
function engine(value: unknown): ContainerEngine | undefined {
  if (value === undefined) return undefined
  if (value !== 'docker' && value !== 'podman') throw new OxeQueryError('invalid', 'Unknown container engine.')
  return value
}

export function toErrorInfo(error: unknown): OxeQueryErrorInfo {
  if (error instanceof OxeQueryError) return { code: error.code, message: error.message, ...(error.reasons.length ? { reasons: error.reasons } : {}) }
  if (error instanceof ContainerRuntimeError) return { code: error.code, message: error.message }
  if (error instanceof ConnectionInputError || error instanceof MongoInputError) return { code: 'invalid', message: error.message }
  return { code: 'failed', message: error instanceof Error ? error.message.slice(0, 400) : 'OxeQuery failed.' }
}

export interface OxeQueryServiceOptions {
  db: AppDatabase
  cipher: SecretCipher
  host: ExecutionHost
  worker: Pick<OxeQueryWorkerClient, 'call' | 'close'>
  emit: (event: OxeQueryEvent) => void
  preferredEngine?: () => ContainerEngine | undefined
  runtime?: ContainerRuntime
}

/** Validates every operation, resolves secrets, and routes to containers or the database worker. */
export class OxeQueryService {
  readonly connections: ConnectionStore
  readonly containers: ContainerRuntime
  private readonly worker: OxeQueryServiceOptions['worker']
  private readonly shells = new Map<string, { file: string; args: string[] }>()

  constructor(options: OxeQueryServiceOptions) {
    this.connections = new ConnectionStore(options.db, options.cipher)
    this.containers = options.runtime ?? new ContainerRuntime({ host: options.host, emit: options.emit, preferred: options.preferredEngine })
    this.worker = options.worker
  }

  /** Lookup for the terminal service; the renderer can only ask to open a pane it was handed. */
  shellFor(paneId: string): { file: string; args: string[] } | undefined {
    return this.shells.get(paneId)
  }

  async call<K extends OxeQueryOp>(op: K, rawInput: unknown): Promise<OxeQueryResponse<OxeQueryOps[K]['output']>> {
    try {
      return { ok: true, value: await this.dispatch(op, rawInput) as OxeQueryOps[K]['output'] }
    } catch (error) {
      return { ok: false, error: toErrorInfo(error) }
    }
  }

  private resolve(value: unknown): ResolvedConnection {
    return this.connections.resolve(str(value, 'Connection', 64))
  }

  private async dispatch(op: string, rawInput: unknown): Promise<unknown> {
    const input = record(rawInput ?? {})
    switch (op) {
      case 'containers.engines': return this.containers.engines(true)
      case 'containers.list': return this.containers.list(engine(input.engine))
      case 'containers.inspect': return this.containers.inspect(str(input.id, 'Container', 128), engine(input.engine))
      case 'containers.action': {
        const action = str(input.action, 'Action', 16)
        if (!ACTIONS.has(action)) throw new OxeQueryError('invalid', 'Unsupported container action.')
        await this.containers.action(str(input.id, 'Container', 128), action as ContainerAction, engine(input.engine))
        return { ok: true }
      }
      case 'containers.exec': {
        const argv = input.argv
        if (!Array.isArray(argv)) throw new OxeQueryError('invalid', 'A command is required.')
        return this.containers.exec(str(input.id, 'Container', 128), argv as string[], optionalInt(input.timeoutMs, 1000, 120_000), engine(input.engine))
      }
      case 'containers.logsStart': return { streamId: await this.containers.logsStart(str(input.id, 'Container', 128), optionalInt(input.tail, 0, 5000), engine(input.engine)) }
      case 'containers.logsStop': this.containers.logsStop(str(input.streamId, 'Stream', 64)); return { ok: true }
      case 'containers.shell': {
        const shell = input.shell === 'bash' ? 'bash' : 'sh'
        const command = await this.containers.shellCommand(str(input.id, 'Container', 128), shell, engine(input.engine))
        if (this.shells.size >= MAX_SHELLS) this.shells.delete(this.shells.keys().next().value as string)
        const paneId = `oxequery-shell:${randomUUID()}`
        this.shells.set(paneId, { file: command.file, args: command.args })
        return { paneId }
      }
      case 'containers.suggestConnection': {
        const found = await this.containers.suggestConnection(str(input.id, 'Container', 128), engine(input.engine))
        return found?.suggestion ?? null
      }
      case 'connections.list': return this.connections.list()
      case 'connections.save': {
        const saved = this.connections.save(input as unknown as OxeQueryConnectionInput)
        await this.worker.call('close', this.connections.resolve(saved.id)).catch(() => undefined)
        return saved
      }
      case 'connections.delete': {
        const id = str(input.id, 'Connection', 64)
        const connection = this.connections.resolve(id)
        this.connections.delete(id)
        await this.worker.call('close', connection).catch(() => undefined)
        return { ok: true }
      }
      case 'connections.test': return this.worker.call('test', this.resolve(input.id))
      case 'connections.fromContainer': return this.fromContainer(str(input.id, 'Container', 128), engine(input.engine), optionalString(input.name, 80))
      case 'sql.schemas': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.schemas', connection))
      case 'sql.tables': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.tables', connection, { schema: str(input.schema, 'Schema', 255) }))
      case 'sql.table': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.table', connection, { schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255) }))
      case 'sql.run': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.run', connection, {
        sql: str(input.sql, 'SQL', 1024 * 1024), maxRows: optionalInt(input.maxRows, 1, 10_000), confirmed: input.confirmed === true
      }))
      case 'sql.browse': {
        const browse: SqlBrowseInput = {
          connectionId: str(input.connectionId, 'Connection', 64), schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255),
          limit: optionalInt(input.limit, 1, 1000), offset: optionalInt(input.offset, 0, 10_000_000)
        }
        if (input.orderBy !== undefined) {
          const order = record(input.orderBy)
          browse.orderBy = { column: str(order.column, 'Column', 255), direction: order.direction === 'desc' ? 'desc' : 'asc' }
        }
        return this.requireEngine(browse.connectionId, 'postgres', connection => this.worker.call('sql.browse', connection, browse))
      }
      case 'sql.cancel': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.cancel', connection))
      case 'sql.check': return guardSql(str(input.sql, 'SQL', 1024 * 1024))
      case 'mongo.databases': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.databases', connection))
      case 'mongo.collections': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.collections', connection, { database: str(input.database, 'Database', 255) }))
      case 'mongo.find': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.find', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), filter: optionalString(input.filter),
        projection: optionalString(input.projection), sort: optionalString(input.sort), limit: optionalInt(input.limit, 1, 1000), skip: optionalInt(input.skip, 0, 10_000_000)
      }))
      case 'mongo.aggregate': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.aggregate', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), pipeline: str(input.pipeline, 'Pipeline', 262_144), limit: optionalInt(input.limit, 1, 1000)
      }))
      case 'mongo.indexes': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.indexes', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255)
      }))
      default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')
    }
  }

  private async requireEngine<T>(id: unknown, expected: ResolvedConnection['engine'], run: (connection: ResolvedConnection) => Promise<T>): Promise<T> {
    const connection = this.resolve(id)
    if (connection.engine !== expected) throw new OxeQueryError('invalid', `This operation needs a ${expected === 'postgres' ? 'PostgreSQL' : 'MongoDB'} connection.`)
    return run(connection)
  }

  private async fromContainer(id: string, requested: ContainerEngine | undefined, name: string | undefined): Promise<OxeQueryConnection> {
    const found = await this.containers.suggestConnection(id, requested)
    if (!found) throw new OxeQueryError('invalid', 'This container does not look like PostgreSQL or MongoDB.')
    const { suggestion, password } = found
    if (!suggestion.port) throw new OxeQueryError('invalid', 'This container does not publish its database port. Recreate it with a published port (for example -p 5432:5432).')
    // Created in the main process: the password goes straight to secure storage and is never returned.
    return this.connections.save({
      name: name ?? suggestion.name, engine: suggestion.engine, host: suggestion.host, port: suggestion.port,
      database: suggestion.database, username: suggestion.username, readOnly: true, environment: 'local', containerRef: suggestion.name,
      ...(password ? { password } : {})
    })
  }

  async dispose(): Promise<void> {
    this.containers.dispose()
    await this.worker.close()
  }
}
