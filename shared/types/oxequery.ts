/**
 * OxeQuery: containers (Docker/Podman) plus PostgreSQL and MongoDB access.
 *
 * Everything crosses a single IPC call, `oxeQuery:call`, described by
 * `OxeQueryOps`. Secrets (database passwords) never appear in an output type.
 */

export type ContainerEngine = 'docker' | 'podman'
export type DatabaseEngine = 'postgres' | 'mongodb'

export interface ContainerEngineInfo {
  engine: ContainerEngine
  available: boolean
  version?: string
  /** `docker context show`; a remote context means the daemon is not local. */
  context?: string
  error?: string
}

export interface ContainerPort {
  hostIp?: string
  hostPort?: number
  containerPort: number
  protocol: 'tcp' | 'udp'
}

export type ContainerState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'removing' | 'unknown'

export interface ContainerSummary {
  id: string
  name: string
  image: string
  state: ContainerState
  status: string
  ports: ContainerPort[]
  createdAt?: number
  labels: Record<string, string>
}

export interface ContainerInspect {
  id: string
  name: string
  image: string
  state: ContainerState
  startedAt?: number
  restartPolicy?: string
  health?: string
  command: string
  workingDir?: string
  /** Names only. Values are never sent to the renderer. */
  envNames: string[]
  mounts: { source: string; destination: string; mode?: string }[]
  networks: string[]
  ports: ContainerPort[]
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export interface ContainerExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}

export interface ConnectionSuggestion {
  engine: DatabaseEngine
  name: string
  host: string
  port: number
  database?: string
  username?: string
  /** True when the container environment holds a password the main process can use. */
  hasPassword: boolean
}

export type SslMode = 'disable' | 'prefer' | 'require'
export type ConnectionEnvironment = 'local' | 'dev' | 'prod'

export interface OxeQueryConnection {
  id: string
  name: string
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  username: string
  sslMode: SslMode
  readOnly: boolean
  environment: ConnectionEnvironment
  containerRef?: string
  hasPassword: boolean
  createdAt: number
  updatedAt: number
}

export interface OxeQueryConnectionInput {
  id?: string
  name: string
  engine: DatabaseEngine
  host: string
  port: number
  database?: string
  username?: string
  sslMode?: SslMode
  readOnly?: boolean
  environment?: ConnectionEnvironment
  containerRef?: string
  /** Write-only. Omit to keep the stored password. */
  password?: string
  clearPassword?: boolean
}

export interface ConnectionTestResult { ok: boolean; message: string; serverVersion?: string; latencyMs?: number }

export interface SqlColumn { name: string; type: string }
export interface SqlResult {
  columns: SqlColumn[]
  rows: unknown[][]
  rowCount: number
  /** More rows exist than were returned. */
  truncated: boolean
  durationMs: number
  command?: string
  affectedRows?: number
  notices?: string[]
}

export interface SqlRunInput {
  connectionId: string
  sql: string
  maxRows?: number
  /** The user confirmed a statement the guard flagged. */
  confirmed?: boolean
}

export interface SqlGuardVerdict {
  kind: 'read' | 'write' | 'ddl' | 'destructive' | 'empty'
  reasons: string[]
  statements: number
}

export interface SqlTable { schema: string; name: string; kind: 'table' | 'view' | 'materialized view' | 'foreign table' | 'partitioned table'; approxRows?: number }
export interface SqlColumnInfo { name: string; type: string; nullable: boolean; default?: string; primaryKey: boolean; position: number }
export interface SqlIndexInfo { name: string; definition: string; unique: boolean; primary: boolean }
export interface SqlTableDetails { columns: SqlColumnInfo[]; indexes: SqlIndexInfo[]; foreignKeys: { name: string; definition: string }[] }

export interface SqlBrowseInput {
  connectionId: string
  schema: string
  table: string
  limit?: number
  offset?: number
  orderBy?: { column: string; direction: 'asc' | 'desc' }
}

export interface MongoDatabaseInfo { name: string; sizeOnDisk?: number; empty?: boolean }
export interface MongoCollectionInfo { name: string; type: string }

export interface MongoFindInput {
  connectionId: string
  database: string
  collection: string
  /** EJSON text. */
  filter?: string
  projection?: string
  sort?: string
  limit?: number
  skip?: number
}
export interface MongoAggregateInput {
  connectionId: string
  database: string
  collection: string
  /** EJSON array text. */
  pipeline: string
  limit?: number
}
export interface MongoResult {
  /** One EJSON (relaxed) string per document. */
  documents: string[]
  truncated: boolean
  durationMs: number
  /** Total matching documents when it was cheap to learn. */
  total?: number
}
export interface MongoIndexInfo { name: string; keys: string; unique: boolean }

export type ContainerLogEvent = { type: 'container-log'; streamId: string; lines: string[] } | { type: 'container-log-end'; streamId: string; reason: string }
export type OxeQueryEvent = ContainerLogEvent | { type: 'containers-changed' }

export interface OxeQueryOps {
  'containers.engines': { input: Record<string, never>; output: ContainerEngineInfo[] }
  'containers.list': { input: { engine?: ContainerEngine }; output: { engine: ContainerEngine; containers: ContainerSummary[] } }
  'containers.inspect': { input: { engine?: ContainerEngine; id: string }; output: ContainerInspect }
  'containers.action': { input: { engine?: ContainerEngine; id: string; action: ContainerAction }; output: { ok: true } }
  'containers.exec': { input: { engine?: ContainerEngine; id: string; argv: string[]; timeoutMs?: number }; output: ContainerExecResult }
  'containers.logsStart': { input: { engine?: ContainerEngine; id: string; tail?: number }; output: { streamId: string } }
  'containers.logsStop': { input: { streamId: string }; output: { ok: true } }
  'containers.shell': { input: { engine?: ContainerEngine; id: string; shell?: 'sh' | 'bash' }; output: { paneId: string } }
  'containers.suggestConnection': { input: { engine?: ContainerEngine; id: string }; output: ConnectionSuggestion | null }
  'connections.list': { input: Record<string, never>; output: OxeQueryConnection[] }
  'connections.save': { input: OxeQueryConnectionInput; output: OxeQueryConnection }
  'connections.delete': { input: { id: string }; output: { ok: true } }
  'connections.test': { input: { id: string }; output: ConnectionTestResult }
  'connections.fromContainer': { input: { engine?: ContainerEngine; id: string; name?: string }; output: OxeQueryConnection }
  'sql.schemas': { input: { connectionId: string }; output: string[] }
  'sql.tables': { input: { connectionId: string; schema: string }; output: SqlTable[] }
  'sql.table': { input: { connectionId: string; schema: string; table: string }; output: SqlTableDetails }
  'sql.run': { input: SqlRunInput; output: SqlResult }
  'sql.browse': { input: SqlBrowseInput; output: SqlResult }
  'sql.cancel': { input: { connectionId: string }; output: { cancelled: boolean } }
  'sql.check': { input: { connectionId: string; sql: string }; output: SqlGuardVerdict }
  'mongo.databases': { input: { connectionId: string }; output: MongoDatabaseInfo[] }
  'mongo.collections': { input: { connectionId: string; database: string }; output: MongoCollectionInfo[] }
  'mongo.find': { input: MongoFindInput; output: MongoResult }
  'mongo.aggregate': { input: MongoAggregateInput; output: MongoResult }
  'mongo.indexes': { input: { connectionId: string; database: string; collection: string }; output: MongoIndexInfo[] }
}

export type OxeQueryOp = keyof OxeQueryOps

export interface OxeQueryErrorInfo {
  code: 'engine-missing' | 'daemon' | 'not-found' | 'invalid' | 'failed' | 'read-only' | 'confirm' | 'connect' | 'query' | 'timeout' | 'cancelled'
  message: string
  /** Why a statement was flagged, when code is 'confirm' or 'read-only'. */
  reasons?: string[]
}

/** Errors travel as data so the renderer keeps their code (a rejected IPC call loses it). */
export type OxeQueryResponse<T> = { ok: true; value: T } | { ok: false; error: OxeQueryErrorInfo }

export interface OxeQueryApi {
  call<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']): Promise<OxeQueryResponse<OxeQueryOps[K]['output']>>
  onEvent(listener: (event: OxeQueryEvent) => void): () => void
}
