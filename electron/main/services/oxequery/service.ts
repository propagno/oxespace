import { randomUUID } from 'node:crypto'
import { exportConnections, parseConnectionsFile, readImportFile, writeExportFile } from './connection-transfer'
import type { AppDatabase } from '../../db'
import type { ExecutionHost } from '../../runtime/execution-host'
import type {
  ContainerAction, ContainerEngine, OxeQueryConnection, OxeQueryConnectionInput, OxeQueryErrorInfo, OxeQueryEvent, OxeQueryOp, OxeQueryOps, OxeQueryResponse,
  SqlBrowseInput, SqlFilter, SqlFilterOp, SqlScriptResult
} from '../../../../shared/types/oxequery'
import { ConnectionInputError, ConnectionStore, type SecretCipher } from './connection-store'
import { ContainerRuntime, ContainerRuntimeError } from './container-runtime'
import { PreferenceInputError, PreferenceStore } from './preferences'
import { COMPOSE_ACTIONS, type ComposeAction } from './compose'
import { MongoInputError, OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { guardSql } from './sql-guard'
import type { OxeQueryWorkerClient } from './worker-client'
import { PickedFiles, type PickedKind } from './picked-files'
import { LibraryInputError, QueryLibrary } from './query-library'
import { WorkspaceInputError, WorkspaceStore } from './workspace-store'
import { AgentGateway } from './agent-gateway'
import { ApprovalBroker, type ApprovalPrompter } from '../agent-actions/approval-broker'
import { AuditLog } from './audit-log'
import type { ExportFormat } from '../../../../shared/types/oxequery'
import { stringifyMongoQuery, type MongoQueryText } from '../../../../shared/mongoQueryText'

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
/** CSV reading options from the page, each checked against what is allowed. */
function readOptions(value: unknown): { delimiter: string; hasHeader: boolean; encoding: string } {
  const raw = record(value ?? {})
  const delimiters = ['auto', ',', ';', '\t', '|']
  const encodings = ['auto', 'utf-8', 'utf-16le', 'utf-16be', 'windows-1252']
  return {
    delimiter: delimiters.includes(String(raw.delimiter)) ? String(raw.delimiter) : 'auto', hasHeader: raw.hasHeader !== false,
    encoding: encodings.includes(String(raw.encoding)) ? String(raw.encoding) : 'auto'
  }
}

/** What to do with rows whose key exists, or nothing for the default of refusing the import. */
function readConflict(value: unknown): { mode: 'skip' | 'update'; columns: string[] } | undefined {
  const raw = record(value ?? {})
  if (raw.mode !== 'skip' && raw.mode !== 'update') return undefined
  const columns = Array.isArray(raw.columns) ? raw.columns.map(entry => String(entry).slice(0, 255)).slice(0, 16) : []
  return { mode: raw.mode, columns }
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
const FILTER_OPS = new Set<string>(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'null', 'notNull', 'in'])

/** Values for `$1`, `$2`…: text or null, a bounded number of them. */
function sqlParams(value: unknown): (string | null)[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 100) throw new OxeQueryError('invalid', 'Invalid parameters.')
  return value.map(entry => {
    if (entry === null) return null
    if (typeof entry !== 'string' || entry.length > 65_536 || entry.includes('\0')) throw new OxeQueryError('invalid', 'A parameter must be text.')
    return entry
  })
}

function sqlFilters(value: unknown): SqlFilter[] {
  if (!Array.isArray(value) || value.length > 20) throw new OxeQueryError('invalid', 'Invalid filters.')
  return value.map(entry => {
    const item = record(entry)
    if (typeof item.op !== 'string' || !FILTER_OPS.has(item.op)) throw new OxeQueryError('invalid', 'Unsupported filter.')
    const filter: SqlFilter = { column: str(item.column, 'Column', 255), op: item.op as SqlFilterOp }
    if (item.value !== undefined && item.value !== null) {
      if (typeof item.value !== 'string' || item.value.length > 4096 || item.value.includes('\0')) throw new OxeQueryError('invalid', 'A filter value must be text.')
      filter.value = item.value
    }
    return filter
  })
}

function engine(value: unknown): ContainerEngine | undefined {
  if (value === undefined) return undefined
  if (value !== 'docker' && value !== 'podman') throw new OxeQueryError('invalid', 'Unknown container engine.')
  return value
}

export function toErrorInfo(error: unknown): OxeQueryErrorInfo {
  if (error instanceof OxeQueryError) return { code: error.code, message: error.message, ...(error.reasons.length ? { reasons: error.reasons } : {}), ...error.detail }
  if (error instanceof ContainerRuntimeError) return { code: error.code, message: error.message }
  if (error instanceof ConnectionInputError || error instanceof PreferenceInputError || error instanceof MongoInputError || error instanceof LibraryInputError || error instanceof WorkspaceInputError) return { code: 'invalid', message: error.message }
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
  pickSavePath?: (suggestedName: string, format: ExportFormat) => Promise<string | null>
  /** Native open dialog for an import file. */
  pickImportPath?: () => Promise<string | null>
  /** How a person is asked to approve an agent's request. Without one, every approval is denied. */
  approvalPrompter?: ApprovalPrompter
}

/** Validates every operation, resolves secrets, and routes to containers or the database worker. */
export class OxeQueryService {
  readonly connections: ConnectionStore
  readonly containers: ContainerRuntime
  private readonly worker: OxeQueryServiceOptions['worker']
  private readonly shells = new Map<string, { file: string; args: string[] }>()
  private readonly picked = new PickedFiles()
  private readonly library: QueryLibrary
  private readonly preferences: PreferenceStore
  private readonly workspaces: WorkspaceStore
  private readonly auditLog: AuditLog
  /** What the internal MCP tools call; policy and approval live inside it. */
  readonly agent: AgentGateway
  readonly approvals: ApprovalBroker
  private readonly pickFile?: OxeQueryServiceOptions['pickFile']
  private readonly pickSavePath?: OxeQueryServiceOptions['pickSavePath']
  private readonly pickImportPath?: OxeQueryServiceOptions['pickImportPath']
  /** Files the person chose to import, by opaque id; the page never sees a path. */
  private readonly imports = new Map<string, { path: string; format: 'csv' | 'ndjson' | 'json'; expires: number }>()
  private readonly emit: (event: OxeQueryEvent) => void

  constructor(options: OxeQueryServiceOptions) {
    this.connections = new ConnectionStore(options.db, options.cipher, this.picked)
    this.preferences = new PreferenceStore(options.db)
    this.library = new QueryLibrary(options.db, Date.now, () => this.preferences.get().historyLimit)
    this.workspaces = new WorkspaceStore(options.db)
    this.library.scrubHistory()
    this.pickFile = options.pickFile
    this.pickSavePath = options.pickSavePath
    this.pickImportPath = options.pickImportPath
    this.emit = options.emit
    this.containers = options.runtime ?? new ContainerRuntime({ host: options.host, emit: options.emit, preferred: options.preferredEngine })
    this.worker = options.worker
    this.auditLog = new AuditLog(options.db)
    this.auditLog.prune(this.preferences.get().auditRetentionDays)
    this.approvals = new ApprovalBroker(options.approvalPrompter)
    this.agent = new AgentGateway({
      list: () => this.connections.list(),
      ceiling: environment => this.preferences.get().agentCeiling[environment],
      resolve: id => this.connections.resolve(id),
      call: (op, connection, input) => this.worker.call(op, connection, input),
      containers: {
        list: () => this.containers.list(),
        logsTail: (id, tail) => this.containers.logsTail(id, tail),
        action: (id, action) => this.containers.action(id, action)
      },
      broker: this.approvals,
      audit: this.auditLog
    })
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
      case 'containers.engines': return this.containers.engines(input.refresh === true)
      case 'containers.candidates': return this.containers.candidates()
      case 'containers.useCandidate': return this.containers.useCandidate(input && typeof input === 'object' && typeof (input as { id?: unknown }).id === 'string' ? (input as { id: string }).id : null)
      case 'containers.list': return this.containers.list(engine(input.engine))
      case 'containers.inspect': return this.containers.inspect(str(input.id, 'Container', 128), engine(input.engine))
      case 'containers.stats': return this.containers.stats(engine(input.engine))
      case 'resources.images': return this.containers.images(engine(input.engine))
      case 'resources.volumes': return this.containers.volumes(engine(input.engine))
      case 'resources.networks': return this.containers.networks(engine(input.engine))
      case 'resources.usage': return this.containers.usage(engine(input.engine))
      case 'resources.remove': {
        const kind = str(input.kind, 'Kind', 16)
        if (kind !== 'image' && kind !== 'volume' && kind !== 'network') throw new OxeQueryError('invalid', 'Unsupported resource kind.')
        // A volume is somebody's data: the main process asks for the confirmation itself.
        if (kind === 'volume' && input.confirmed !== true) throw new OxeQueryError('confirm', 'Removing a volume deletes the data in it.', ['Removing a volume deletes the data in it for good.'])
        await this.containers.removeResource(kind, str(input.id, 'Resource', 200), engine(input.engine))
        return { ok: true }
      }
      case 'containers.createDatabase': {
        const kind = str(input.engine, 'Engine', 16)
        if (kind !== 'postgres' && kind !== 'mongodb') throw new OxeQueryError('invalid', 'Choose PostgreSQL or MongoDB.')
        const name = str(input.name, 'Name', 41)
        const created = await this.containers.createDatabase({ engine: kind, name, tag: str(input.tag, 'Version', 24), ...(typeof input.port === 'number' ? { port: input.port } : {}) }, engine(input.engineName))
        // A fresh server needs a moment before it accepts logins; the connection is saved now and the workbench retries.
        return this.connections.save({
          name, engine: kind, host: '127.0.0.1', port: created.port, database: created.database, username: created.username, password: created.password,
          readOnly: false, environment: 'local', containerRef: name
        })
      }
      case 'containers.action': {
        const action = str(input.action, 'Action', 16)
        if (!ACTIONS.has(action)) throw new OxeQueryError('invalid', 'Unsupported container action.')
        await this.containers.action(str(input.id, 'Container', 128), action as ContainerAction, engine(input.engine))
        return { ok: true }
      }
      case 'containers.compose': {
        const action = str(input.action, 'Action', 16)
        if (!COMPOSE_ACTIONS.has(action)) throw new OxeQueryError('invalid', 'Unsupported Compose action.')
        if (action === 'down' && input.confirmed !== true) {
          throw new OxeQueryError('confirm', 'Taking a project down removes its containers and networks.', ['Named volumes are kept.', 'Anything running from this project stops.'])
        }
        return this.containers.compose(str(input.id, 'Container', 128), action as ComposeAction, { ...(optionalInt(input.tail, 1, 500) !== undefined ? { tail: optionalInt(input.tail, 1, 500) } : {}) }, engine(input.engine))
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
      case 'preferences.get': return this.preferences.get()
      case 'preferences.set': {
        const next = this.preferences.set(input)
        this.auditLog.prune(next.auditRetentionDays)
        return next
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
      case 'connections.update': return this.connections.update(str(input.id, 'Connection', 64), {
        ...(typeof input.group === 'string' ? { group: input.group } : {}), ...(typeof input.favorite === 'boolean' ? { favorite: input.favorite } : {}),
        ...(typeof input.color === 'string' ? { color: input.color } : {})
      })
      case 'connections.duplicate': return this.connections.duplicate(str(input.id, 'Connection', 64))
      case 'connections.connectEphemeral': return this.connections.saveEphemeral(input as unknown as OxeQueryConnectionInput)
      case 'connections.reconnect': {
        // Drop the sessions (and any tunnel) and dial again, so a connection the network cut can be picked up without a restart.
        const connection = this.resolve(input.id)
        await this.worker.call('close', connection).catch(() => undefined)
        return this.worker.call('test', connection)
      }
      case 'connections.export': {
        if (!this.pickSavePath) throw new OxeQueryError('invalid', 'Saving files is not available here.')
        const wanted = Array.isArray(input.ids) ? new Set(input.ids.map(String)) : null
        const list = this.connections.list().filter(item => !wanted || wanted.has(item.id))
        const path = await this.pickSavePath('oxequery-connections.json', 'json')
        if (!path) return { saved: false, count: 0 }
        await writeExportFile(path, exportConnections(list))
        return { saved: true, count: list.filter(item => !item.ephemeral).length }
      }
      case 'connections.import': {
        if (!this.pickImportPath) throw new OxeQueryError('invalid', 'Choosing files is not available here.')
        const path = await this.pickImportPath()
        if (!path) return { imported: 0, skipped: 0 }
        let text: string
        try { text = await readImportFile(path) } catch (error) { throw new OxeQueryError('invalid', error instanceof Error ? error.message : 'That file cannot be read.') }
        let parsed: ReturnType<typeof parseConnectionsFile>
        try { parsed = parseConnectionsFile(text) } catch (error) { throw new OxeQueryError('invalid', error instanceof Error ? error.message : 'That file cannot be imported.') }
        let imported = 0, skipped = parsed.skipped
        for (const entry of parsed.inputs) {
          try { this.connections.save(entry); imported++ } catch { skipped++ }
        }
        return { imported, skipped }
      }
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
      case 'sql.run': return this.requireEngine(input.connectionId, 'postgres', async connection => {
        const sql = str(input.sql, 'SQL', 1024 * 1024)
        const started = Date.now()
        try {
          const result = await this.worker.call<{ columns: unknown[]; rowCount: number; affectedRows?: number }>('sql.run', connection, {
            sql, maxRows: optionalInt(input.maxRows, 1, 100_000), confirmed: input.confirmed === true, params: sqlParams(input.params)
          })
          this.remember(connection.id, { sql, durationMs: Date.now() - started, rows: result.columns.length ? result.rowCount : result.affectedRows ?? null, ok: true })
          return result
        } catch (error) {
          // A statement waiting for confirmation did not run, so it is not history yet.
          if (!(error instanceof OxeQueryError && error.code === 'confirm')) this.remember(connection.id, { sql, durationMs: Date.now() - started, rows: null, ok: false })
          throw error
        }
      })
      case 'sql.script': return this.requireEngine(input.connectionId, 'postgres', async connection => {
        const sql = str(input.sql, 'SQL', 1024 * 1024)
        const started = Date.now()
        const outcome = await this.worker.call<SqlScriptResult>('sql.script', connection, { sql, maxRows: optionalInt(input.maxRows, 1, 100_000), confirmed: input.confirmed === true })
        // Every statement that ran is history on its own, so a statement can be found and run again.
        for (const entry of outcome.statements) {
          const text = sql.slice(entry.start, entry.end)
          this.remember(connection.id, { sql: text, durationMs: entry.result?.durationMs ?? Date.now() - started, rows: entry.result ? (entry.result.columns.length ? entry.result.rowCount : entry.result.affectedRows ?? null) : null, ok: !entry.error })
        }
        return outcome
      })
      case 'sql.tx': return this.requireEngine(input.connectionId, 'postgres', connection => {
        const action = str(input.action, 'Action', 16)
        if (!['begin', 'commit', 'rollback', 'status'].includes(action)) throw new OxeQueryError('invalid', 'Unsupported transaction action.')
        return this.worker.call('sql.tx', connection, { action })
      })
      // An unsaved connection keeps no workspace, saved queries or history: those belong to saved connections.
      case 'workspace.load': { const id = this.resolve(input.connectionId).id; return { state: this.connections.isEphemeral(id) ? null : this.workspaces.load(id) } }
      case 'workspace.save': { const id = this.resolve(input.connectionId).id; if (!this.connections.isEphemeral(id)) this.workspaces.save(id, input.state); return { ok: true } }
      case 'audit.list': return this.auditLog.list({ ...(typeof input.connectionId === 'string' ? { connectionId: input.connectionId.slice(0, 64) } : {}), limit: optionalInt(input.limit, 1, 500) })
      case 'library.list': { const id = this.resolve(input.connectionId).id; return this.connections.isEphemeral(id) ? { saved: [], history: [] } : this.library.list(id) }
      case 'library.save': if (this.connections.isEphemeral(this.resolve(input.connectionId).id)) throw new OxeQueryError('invalid', 'Save this connection to keep queries.'); return this.library.save({
        connectionId: this.resolve(input.connectionId).id, name: str(input.name, 'Name', 120), sql: str(input.sql, 'SQL', 100_000),
        ...(typeof input.id === 'string' && input.id ? { id: input.id.slice(0, 64) } : {})
      })
      case 'library.delete': { const id = this.resolve(input.connectionId).id; return { deleted: this.connections.isEphemeral(id) ? false : this.library.remove(id, str(input.id, 'Query', 64)) } }
      case 'library.clearHistory': { const id = this.resolve(input.connectionId).id; return { deleted: this.connections.isEphemeral(id) ? 0 : this.library.clearHistory(id) } }
      case 'sql.browse': {
        const browse: SqlBrowseInput = {
          connectionId: str(input.connectionId, 'Connection', 64), schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255),
          limit: optionalInt(input.limit, 1, 1000), offset: optionalInt(input.offset, 0, 10_000_000)
        }
        if (input.orderBy !== undefined) {
          const order = record(input.orderBy)
          browse.orderBy = { column: str(order.column, 'Column', 255), direction: order.direction === 'desc' ? 'desc' : 'asc' }
        }
        if (input.filters !== undefined) browse.filters = sqlFilters(input.filters)
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
      case 'sql.structure.preview': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.structure.preview', connection, this.structureInput(input)))
      case 'sql.structure.apply': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.structure.apply', connection, { ...this.structureInput(input), confirmed: input.confirmed === true }))
      case 'sql.maintenance': return this.requireEngine(input.connectionId, 'postgres', connection => {
        const action = str(input.action, 'Action', 32)
        if (!['vacuum', 'analyze', 'vacuum-analyze', 'reindex'].includes(action)) throw new OxeQueryError('invalid', 'Unsupported maintenance action.')
        return this.worker.call('sql.maintenance', connection, { schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255), action, confirmed: input.confirmed === true })
      })
      case 'mongo.databases': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.databases', connection))
      case 'mongo.collections': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.collections', connection, { database: str(input.database, 'Database', 255) }))
      case 'mongo.find': return this.requireEngine(input.connectionId, 'mongodb', connection => this.recordMongo(connection.id, optionalInt(input.skip, 0, 10_000_000), () => ({
        kind: 'find' as const, database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), filter: optionalString(input.filter),
        projection: optionalString(input.projection), sort: optionalString(input.sort)
      }), query => this.worker.call<{ documents: unknown[] }>('mongo.find', connection, {
        database: query.database, collection: query.collection, filter: query.filter, projection: query.projection, sort: query.sort,
        limit: optionalInt(input.limit, 1, 1000), skip: optionalInt(input.skip, 0, 10_000_000)
      })))
      case 'mongo.aggregate': return this.requireEngine(input.connectionId, 'mongodb', connection => this.recordMongo(connection.id, optionalInt(input.skip, 0, 10_000_000), () => ({
        kind: 'aggregate' as const, database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), pipeline: str(input.pipeline, 'Pipeline', 262_144)
      }), query => this.worker.call<{ documents: unknown[] }>('mongo.aggregate', connection, {
        database: query.database, collection: query.collection, pipeline: query.pipeline, limit: optionalInt(input.limit, 1, 1000), skip: optionalInt(input.skip, 0, 10_000_000)
      })))
      case 'mongo.document': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.document', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), id: str(input.id, 'Document id', 4096)
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
        const preview = await this.worker.call<{ fields: string[]; sample: string[][]; targetColumns: { name: string }[]; detected?: { delimiter: string; encoding: string } }>('import.preview', connection, { path, format, target })
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
        return { importId, fileName: path.split(/[\\/]/).pop() ?? 'file', format, bytes, ...preview, mapping, options: { delimiter: 'auto', hasHeader: true, encoding: 'auto' } }
      }
      case 'import.reparse': {
        // The same file read another way: a different delimiter, no header row, another encoding.
        const connection = this.resolve(input.connectionId)
        const target = this.importTarget(connection.engine, input.target)
        const file = this.imports.get(str(input.importId, 'Import', 80))
        if (!file || file.expires < Date.now()) throw new OxeQueryError('invalid', 'Choose the file again; this selection expired.')
        const options = readOptions(input.options)
        const preview = await this.worker.call<{ fields: string[]; sample: string[][]; targetColumns: { name: string }[]; detected?: { delimiter: string; encoding: string } }>('import.preview', connection, { path: file.path, format: file.format, target, options })
        const lower = new Map(preview.targetColumns.map(column => [column.name.toLowerCase(), column.name]))
        const mapping: Record<string, string> = {}
        for (const field of preview.fields) {
          const match = target.kind === 'table' ? lower.get(field.toLowerCase()) : field
          if (match) mapping[field] = match
        }
        return { importId: str(input.importId, 'Import', 80), fileName: file.path.split(/[\\/]/).pop() ?? 'file', format: file.format, bytes: 0, ...preview, mapping, options }
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
        return this.worker.call('import.run', connection, { importId, path: file.path, format: file.format, target, mapping: clean, dryRun, emptyAsNull: input.emptyAsNull !== false, options: readOptions(input.options), ...(readConflict(input.conflict) ? { conflict: readConflict(input.conflict) } : {}) },
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
        if (!['csv', 'json', 'ndjson', 'sql', 'xlsx'].includes(format)) throw new OxeQueryError('invalid', 'Unsupported export format.')
        if (format === 'sql' && connection.engine !== 'postgres') throw new OxeQueryError('invalid', 'SQL export is for PostgreSQL tables and queries.')
        const source = record(input.source)
        let suggested: string
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
        const path = await this.pickSavePath(suggested, format as ExportFormat)
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
      case 'mongo.schema': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.schema', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), sampleSize: optionalInt(input.sampleSize, 10, 1000)
      }))
      case 'mongo.createIndex':
      case 'mongo.dropIndex': return this.requireEngine(input.connectionId, 'mongodb', connection => {
        if ((connection.environment === 'prod' || op === 'mongo.dropIndex') && input.confirmed !== true) {
          throw new OxeQueryError('confirm', 'Confirmation is required.', [
            ...(connection.environment === 'prod' ? ['This is a production connection.'] : []),
            ...(op === 'mongo.dropIndex' ? ['Dropping an index can make queries much slower.'] : ['Building an index on a large collection can take a while and use disk and memory.'])
          ])
        }
        return this.worker.call(op, connection, op === 'mongo.createIndex'
          ? { database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), keys: str(input.keys, 'Index keys', 4096), unique: input.unique === true }
          : { database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), name: str(input.name, 'Index name', 255) })
      })
      case 'sql.functions': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.functions', connection, { schema: str(input.schema, 'Schema', 255) }))
      case 'sql.databases': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.databases', connection))
      case 'sql.roles': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.roles', connection))
      case 'sql.createDatabase': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.createDatabase', connection, {
        name: str(input.name, 'Name', 63), ...(typeof input.owner === 'string' && input.owner ? { owner: input.owner.slice(0, 63) } : {}),
        ...(typeof input.template === 'string' && input.template ? { template: input.template.slice(0, 63) } : {}), ...(typeof input.encoding === 'string' && input.encoding ? { encoding: input.encoding.slice(0, 20) } : {})
      }))
      case 'sql.dropDatabase': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.dropDatabase', connection, { name: str(input.name, 'Name', 63), confirmed: input.confirmed === true }))
      case 'sql.objects': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.objects', connection, { schema: str(input.schema, 'Schema', 255) }))
      case 'sql.extensions': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.extensions', connection))
      case 'sql.search': return this.requireEngine(input.connectionId, 'postgres', connection => this.worker.call('sql.search', connection, { query: str(input.query, 'Search', 200) }))
      case 'sql.definition': return this.requireEngine(input.connectionId, 'postgres', connection => {
        const kind = str(input.kind, 'Kind', 16)
        if (kind === 'function' || kind === 'trigger' || kind === 'type') return this.worker.call('sql.definition', connection, { kind, oid: Number(input.oid) })
        if (kind !== 'table' && kind !== 'view' && kind !== 'sequence') throw new OxeQueryError('invalid', 'Unsupported object kind.')
        return this.worker.call('sql.definition', connection, { kind, schema: str(input.schema, 'Schema', 255), name: str(input.name, 'Name', 255) })
      })
      case 'mongo.bulk': return this.requireEngine(input.connectionId, 'mongodb', connection => {
        const op = str(input.op, 'Operation', 16)
        if (op !== 'updateMany' && op !== 'deleteMany') throw new OxeQueryError('invalid', 'Unsupported bulk operation.')
        return this.worker.call('mongo.bulk', connection, {
          database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), op, filter: str(input.filter, 'Filter', 262_144),
          ...(typeof input.update === 'string' ? { update: input.update.slice(0, 262_144) } : {}), dryRun: input.dryRun === true,
          ...(Number.isInteger(input.expectedCount) ? { expectedCount: input.expectedCount } : {}), confirmed: input.confirmed === true
        })
      })
      case 'mongo.collection': return this.requireEngine(input.connectionId, 'mongodb', connection => {
        const action = record(input.action)
        const kind = str(action.kind, 'Action', 16)
        if (kind !== 'create' && kind !== 'rename' && kind !== 'drop') throw new OxeQueryError('invalid', 'Unsupported collection action.')
        return this.worker.call('mongo.collection', connection, {
          database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), confirmed: input.confirmed === true,
          action: kind === 'rename' ? { kind, to: str(action.to, 'New name', 255) }
            : kind === 'create' ? { kind, capped: action.capped === true, ...(optionalInt(action.sizeBytes, 1, 1 << 40) !== undefined ? { sizeBytes: optionalInt(action.sizeBytes, 1, 1 << 40) } : {}), ...(optionalInt(action.maxDocuments, 1, 1_000_000_000) !== undefined ? { maxDocuments: optionalInt(action.maxDocuments, 1, 1_000_000_000) } : {}) }
              : { kind }
        })
      })
      case 'mongo.stats': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.stats', connection, { database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255) }))
      case 'mongo.validation': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.validation', connection, { database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255) }))
      case 'mongo.setValidation': return this.requireEngine(input.connectionId, 'mongodb', connection => {
        const level = str(input.level, 'Level', 16), action = str(input.action, 'Action', 16)
        if (!['off', 'moderate', 'strict'].includes(level) || !['error', 'warn'].includes(action)) throw new OxeQueryError('invalid', 'Unsupported validation level or action.')
        return this.worker.call('mongo.setValidation', connection, {
          database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255),
          validator: typeof input.validator === 'string' ? input.validator.slice(0, 262_144) : null, level, action
        })
      })
      case 'mongo.explain': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.explain', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255), kind: input.kind === 'aggregate' ? 'aggregate' : 'find',
        filter: optionalString(input.filter), projection: optionalString(input.projection), sort: optionalString(input.sort), pipeline: optionalString(input.pipeline),
        verbosity: input.verbosity === 'queryPlanner' ? 'queryPlanner' : 'executionStats'
      }))
      case 'mongo.cancel': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.cancel', connection))
      case 'mongo.indexes': return this.requireEngine(input.connectionId, 'mongodb', connection => this.worker.call('mongo.indexes', connection, {
        database: str(input.database, 'Database', 255), collection: str(input.collection, 'Collection', 255)
      }))
      default: throw new OxeQueryError('invalid', 'Unknown OxeQuery operation.')
    }
  }

  /** History belongs to saved connections: an unsaved one leaves none. */
  private remember(connectionId: string, entry: Parameters<QueryLibrary['record']>[1]): void {
    if (!this.connections.isEphemeral(connectionId)) this.library.record(connectionId, entry)
  }

  /**
   * A MongoDB read, kept in the connection's history as it was typed. Only the first page counts: turning
   * pages is not a new query.
   */
  private async recordMongo<Query extends Omit<MongoQueryText, 'v'>>(connectionId: string, skip: number | undefined, build: () => Query, run: (query: Query) => Promise<{ documents: unknown[] }>): Promise<{ documents: unknown[] }> {
    const query = build()
    const started = Date.now()
    const record = (rows: number | null, ok: boolean): void => {
      if (!skip) this.remember(connectionId, { sql: stringifyMongoQuery(query), durationMs: Date.now() - started, rows, ok })
    }
    try {
      const result = await run(query)
      record(result.documents.length, true)
      return result
    } catch (error) {
      record(null, false)
      throw error
    }
  }

  /** The shape only: ddl-builder validates every name, type and expression before any statement exists. */
  private structureInput(input: Raw): { schema: string; table: string; action: unknown } {
    const action = record(input.action)
    if (!['create', 'alter', 'drop', 'truncate', 'duplicate'].includes(String(action.kind))) throw new OxeQueryError('invalid', 'Unsupported structure action.')
    return { schema: str(input.schema, 'Schema', 255), table: str(input.table, 'Table', 255), action }
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
    this.connections.touch(connection.id)
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
