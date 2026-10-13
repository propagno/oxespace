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
import { PickedFiles, type PickedKind } from './picked-files'

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
  /** Native chooser for certificates and keys; absent in tests and headless runs. */
  pickFile?: (kind: PickedKind) => Promise<{ name: string; content: string } | null>
  /** Native save dialog for exports; absent in tests and headless runs. */
  pickSavePath?: (suggestedName: string, format: 'csv' | 'json' | 'ndjson' | 'sql') => Promise<string | null>
  /** Native open dialog for an import file. */
  pickImportPath?: () => Promise<string | null>
}

/** Validates every operation, resolves secrets, and routes to containers or the database worker. */
export class OxeQueryService {
  readonly connections: ConnectionStore
  readonly containers: ContainerRuntime
  private readonly worker: OxeQueryServiceOptions['worker']
  private readonly shells = new Map<string, { file: string; args: string[] }>()
  private readonly picked = new PickedFiles()
  private readonly pickFile?: OxeQueryServiceOptions['pickFile']
  private readonly pickSavePath?: OxeQueryServiceOptions['pickSavePath']
  private readonly pickImportPath?: OxeQueryServiceOptions['pickImportPath']
  /** Files the person chose to import, by opaque id; the page never sees a path. */
  private readonly imports = new Map<string, { path: string; format: 'csv' | 'ndjson' | 'json'; expires: number }>()
  private readonly emit: (event: OxeQueryEvent) => void

  constructor(options: OxeQueryServiceOptions) {
    this.connections = new ConnectionStore(options.db, options.cipher, this.picked)
    this.pickFile = options.pickFile
    this.pickSavePath = options.pickSavePath
    this.pickImportPath = options.pickImportPath
    this.emit = options.emit
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
      case 'system.ping': return this.worker.call('ping')
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
      case 'connections.trustHostKey': {
        // The host and port come from the saved connection, never from the caller.
        const connection = this.connections.get(str(input.id, 'Connection', 64))
        if (!connection.ssh) throw new OxeQueryError('invalid', 'This connection does not use an SSH tunnel.')
        this.connections.trustHostKey(connection.ssh.host, connection.ssh.port, str(input.fingerprint, 'Fingerprint', 128))
        return { ok: true }
      }
      case 'connections.knownHosts': return this.connections.knownHosts()
      case 'connections.forgetHostKey': {
        const port = optionalInt(input.port, 1, 65535)
        if (port === undefined) throw new OxeQueryError('invalid', 'Port is required.')
        this.connections.forgetHostKey(str(input.host, 'Host', 255), port)
        return { ok: true }
      }
      case 'files.pick': {
        const kind = str(input.kind, 'Kind', 16)
        if (!['ca', 'cert', 'key', 'sshKey'].includes(kind)) throw new OxeQueryError('invalid', 'Unsupported file kind.')
        if (!this.pickFile) throw new OxeQueryError('invalid', 'Choosing files is not available here.')
        const file = await this.pickFile(kind as PickedKind)
        return file ? { handle: this.picked.register(kind as PickedKind, file.name, file.content), name: file.name } : null
      }
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
      case 'sql.editability': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.editability', connection, { schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255) }))
      case 'sql.previewChanges': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.previewChanges', connection, this.changeInput(input)))
      case 'sql.apply': return this.requireEngine(input.connectionId, 'postgres', connection => {
        const change = this.changeInput(input)
        const reasons: string[] = []
        if (connection.environment === 'prod') reasons.push('This is a production connection.')
        const deletes = change.changes.filter(item => (item as { kind?: unknown }).kind === 'delete').length
        if (deletes) reasons.push(`${deletes} row${deletes === 1 ? '' : 's'} will be deleted.`)
        if (reasons.length && input.confirmed !== true) throw new OxeQueryError('confirm', 'These changes need your confirmation.', reasons)
        return this.worker.call('sql.apply', connection, change)
      })
      case 'mongo.databases': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.databases', connection))
      case 'mongo.collections': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.collections', connection, { database: str(input.database, 'Database', 255) }))
      case 'mongo.find': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.find', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), filter: optionalString(input.filter),
        projection: optionalString(input.projection), sort: optionalString(input.sort), limit: optionalInt(input.limit, 1, 1000), skip: optionalInt(input.skip, 0, 10_000_000)
      }))
      case 'mongo.aggregate': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.aggregate', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), pipeline: str(input.pipeline, 'Pipeline', 262_144), limit: optionalInt(input.limit, 1, 1000)
      }))
      case 'mongo.write': return this.requireEngine(input.connectionId, 'mongodb', connection => {
        const op = str(input.op, 'Operation', 16)
        if (!['insert', 'replace', 'delete'].includes(op)) throw new OxeQueryError('invalid', 'Unsupported write operation.')
        const reasons: string[] = []
        if (connection.environment === 'prod') reasons.push('This is a production connection.')
        if (op === 'delete') reasons.push('The document will be deleted.')
        if (reasons.length && input.confirmed !== true) throw new OxeQueryError('confirm', 'This change needs your confirmation.', reasons)
        return this.worker.call('mongo.write', connection, {
          database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), op,
          document: optionalString(input.document), expected: optionalString(input.expected)
        })
      })
      case 'sql.explain': {
        const sql = str(input.sql, 'SQL', 1024 * 1024)
        const analyze = input.analyze === true
        return this.requireEngine(input.connectionId, 'postgres', connection => {
          const verdict = guardSql(sql)
          if (analyze && verdict.kind !== 'read' && verdict.kind !== 'empty' && input.confirmed !== true) {
            throw new OxeQueryError('confirm', 'Confirmation is required.', ['ANALYZE runs the statement. Its changes are rolled back, but triggers and sequences still run.', ...verdict.reasons])
          }
          return this.worker.call('sql.explain', connection, { sql, analyze })
        })
      }
      case 'import.cancel': {
        const importId = str(input.importId, 'Import', 64)
        return this.worker.call('import.cancel', undefined, { importId })
      }
      case 'import.preview': {
        const connection = this.resolve(input.connectionId)
        const target = this.importTarget(connection.engine, input.target)
        if (!this.pickImportPath) throw new OxeQueryError('invalid', 'Choosing files is not available here.')
        const path = await this.pickImportPath()
        if (!path) return { dismissed: true, importId: '', fileName: '', format: 'csv', bytes: 0, fields: [], sample: [], targetColumns: [], mapping: {} }
        const { detectFormat, checkSize } = await import('./import-reader')
        const format = detectFormat(path)
        const bytes = await checkSize(path)
        const preview = await this.worker.call<{ fields: string[]; sample: string[][]; targetColumns: { name: string }[] }>('import.preview', connection, { path, format, target })
        const now = Date.now()
        for (const [key, value] of this.imports) if (value.expires < now) this.imports.delete(key)
        const importId = `imp-${randomUUID()}`
        this.imports.set(importId, { path, format, expires: now + 30 * 60_000 })
        const lower = new Map(preview.targetColumns.map(column => [column.name.toLowerCase(), column.name]))
        const mapping: Record<string, string> = {}
        for (const field of preview.fields) {
          const match = target.kind === 'table' ? lower.get(field.toLowerCase()) : field
          if (match) mapping[field] = match
        }
        return { importId, fileName: path.split(/[\\/]/).pop() ?? 'file', format, bytes, ...preview, mapping }
      }
      case 'import.run': {
        const connection = this.resolve(input.connectionId)
        const target = this.importTarget(connection.engine, input.target)
        const importId = str(input.importId, 'Import', 80)
        const file = this.imports.get(importId)
        if (!file || file.expires < Date.now()) throw new OxeQueryError('invalid', 'Choose the file again; this selection expired.')
        const mapping = record(input.mapping)
        const clean: Record<string, string> = {}
        for (const [field, column] of Object.entries(mapping)) if (typeof column === 'string' && column) clean[field.slice(0, 255)] = column.slice(0, 255)
        if (Object.keys(clean).length === 0) throw new OxeQueryError('invalid', 'Map at least one field.')
        const dryRun = input.dryRun === true
        if (!dryRun && connection.environment === 'prod' && input.confirmed !== true) {
          throw new OxeQueryError('confirm', 'Confirmation is required.', ['This connection is marked as production.', 'Import adds rows that cannot be taken back automatically.'])
        }
        return this.worker.call('import.run', connection, { importId, path: file.path, format: file.format, target, mapping: clean, dryRun, emptyAsNull: input.emptyAsNull !== false },
          progress => {
            const value = progress as { rows?: number }
            if (typeof value.rows === 'number') this.emit({ type: 'import-progress', importId, rows: value.rows })
          })
      }
      case 'export.cancel': {
        const exportId = str(input.exportId, 'Export', 64)
        return this.worker.call('export.cancel', undefined, { exportId })
      }
      case 'export.run': {
        const connection = this.resolve(input.connectionId)
        const exportId = str(input.exportId, 'Export', 64)
        const format = str(input.format, 'Format', 16)
        if (!['csv', 'json', 'ndjson', 'sql'].includes(format)) throw new OxeQueryError('invalid', 'Unsupported export format.')
        if (format === 'sql' && connection.engine !== 'postgres') throw new OxeQueryError('invalid', 'SQL export is for PostgreSQL tables and queries.')
        const source = record(input.source)
        let suggested = 'export'
        let normalized: Raw
        if (source.kind === 'sql' && connection.engine === 'postgres') {
          const sql = str(source.sql, 'SQL', 1024 * 1024)
          if (guardSql(sql).kind !== 'read') throw new OxeQueryError('invalid', 'Only a query that reads data can be exported.')
          normalized = { kind: 'sql', sql }
          suggested = 'query-result'
        } else if (source.kind === 'table' && connection.engine === 'postgres') {
          normalized = { kind: 'table', schema: str(source.schema, 'Schema', 255), table: str(source.table, 'Table', 255) }
          suggested = String(normalized.table)
        } else if (source.kind === 'collection' && connection.engine === 'mongodb') {
          normalized = { kind: 'collection', database: str(source.database, 'Database', 255), collection: str(source.collection, 'Collection', 255), filter: optionalString(source.filter) }
          suggested = String(normalized.collection)
        } else throw new OxeQueryError('invalid', 'That source cannot be exported from this connection.')
        if (!this.pickSavePath) throw new OxeQueryError('invalid', 'Saving files is not available here.')
        const path = await this.pickSavePath(suggested, format as 'csv' | 'json' | 'ndjson' | 'sql')
        if (!path) return { dismissed: true, rows: 0, bytes: 0, durationMs: 0 }
        const options = input.options && typeof input.options === 'object' ? input.options as Raw : {}
        const result = await this.worker.call<{ rows: number; bytes: number; durationMs: number; cancelled: boolean }>('export.run', connection, {
          exportId, source: normalized, format, path,
          options: {
            ...(options.delimiter === ';' || options.delimiter === '\t' || options.delimiter === ',' ? { delimiter: options.delimiter } : {}),
            ...(typeof options.header === 'boolean' ? { header: options.header } : {}), ...(typeof options.bom === 'boolean' ? { bom: options.bom } : {}),
            ...(optionalInt(options.maxRows, 1, 20_000_000) !== undefined ? { maxRows: options.maxRows } : {})
          }
        }, progress => {
          const value = progress as { exportId?: string; rows?: number; bytes?: number }
          if (typeof value.rows === 'number') this.emit({ type: 'export-progress', exportId, rows: value.rows, bytes: value.bytes ?? 0 })
        })
        return { ...result, ...(result.cancelled ? {} : { path, fileName: path.split(/[\\/]/).pop() }) }
      }
      case 'mongo.indexes': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.indexes', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255)
      }))
      default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')
    }
  }

  /** Structure only: the worker validates every column against the catalog. */
  private changeInput(input: Raw): { schema: string; table: string; changes: unknown[] } {
    if (!Array.isArray(input.changes)) throw new OxeQueryError('invalid', 'There are no changes to apply.')
    if (input.changes.length > 500) throw new OxeQueryError('invalid', 'At most 500 changes can be applied at once.')
    for (const change of input.changes) {
      const value = record(change)
      if (!['update', 'insert', 'delete'].includes(String(value.kind))) throw new OxeQueryError('invalid', 'Every change must be an update, insert or delete.')
    }
    return { schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255), changes: input.changes }
  }

  private importTarget(engine: ResolvedConnection['engine'], value: unknown): { kind: 'table'; schema: string; table: string } | { kind: 'collection'; database: string; collection: string } {
    const target = record(value)
    if (engine === 'postgres' && target.kind === 'table') return { kind: 'table', schema: str(target.schema, 'Schema', 255), table: str(target.table, 'Table', 255) }
    if (engine === 'mongodb' && target.kind === 'collection') return { kind: 'collection', database: str(target.database, 'Database', 255), collection: str(target.collection, 'Collection', 255) }
    throw new OxeQueryError('invalid', 'That destination does not fit this connection.')
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
