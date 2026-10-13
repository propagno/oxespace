/**
 * OxeQuery: containers (Docker/Podman) plus PostgreSQL and MongoDB access.
 *
 * Everything crosses a single IPC call, `oxeQuery:call`, described by
 * `OxeQueryOps`. Secrets (database passwords) never appear in an output type.
 */

export type ContainerEngine = 'docker' | 'podman'
export type DatabaseEngine = 'postgres' | 'mongodb'

export type ContainerEngineState = 'ready' | 'missing' | 'stopped' | 'denied'

export interface ContainerEngineInfo {
  engine: ContainerEngine
  available: boolean
  /** ready: usable; missing: CLI not found; stopped: CLI found but the daemon does not answer; denied: socket permission. */
  state?: ContainerEngineState
  /** The executable that answered (a full path when PATH did not have it). */
  binary?: string
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

/**
 * disable / prefer: no TLS. require: encrypted but the certificate is NOT verified.
 * verify-ca: chain checked against the CA (host name not checked). verify-full: chain and host name.
 */
export type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
export type AgentAccess = 'off' | 'read' | 'write'
export type SshAuth = 'key' | 'password'

export interface SshSettings { host: string; port: number; user: string; auth: SshAuth; hasSecret: boolean; keyName?: string }
export interface MongoOptions { authSource: string; replicaSet: string; directConnection: boolean; srv: boolean; extraHosts: string[] }
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
  hasCa: boolean
  hasClientCert: boolean
  mongo: MongoOptions
  ssh?: SshSettings
  statementTimeoutMs: number
  maxRows: number
  agentAccess: AgentAccess
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
  /** Handles from `files.pick`; the file content never passes through the renderer. */
  caHandle?: string
  clearCa?: boolean
  clientCertHandle?: string
  clientKeyHandle?: string
  clearClientCert?: boolean
  mongo?: Partial<MongoOptions>
  ssh?: { enabled: boolean; host?: string; port?: number; user?: string; auth?: SshAuth; password?: string; keyHandle?: string; passphrase?: string; clearSecret?: boolean }
  statementTimeoutMs?: number
  maxRows?: number
  agentAccess?: AgentAccess
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  serverVersion?: string
  latencyMs?: number
  /** Set when the failure needs a decision, e.g. 'host-key-unknown' with the fingerprint in `reasons`. */
  code?: OxeQueryErrorInfo['code']
  reasons?: string[]
}

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

/** One edit to a table row. Values are text that the server casts to the column type, or null. */
export type SqlCellValue = string | number | boolean | null | Record<string, unknown> | unknown[]
export type SqlRowChange =
  | { kind: 'update'; key: Record<string, SqlCellValue>; set: Record<string, SqlCellValue>; old?: Record<string, SqlCellValue> }
  | { kind: 'insert'; values: Record<string, SqlCellValue> }
  | { kind: 'delete'; key: Record<string, SqlCellValue>; old?: Record<string, SqlCellValue> }
export interface SqlApplyInput { connectionId: string; schema: string; table: string; changes: SqlRowChange[]; confirmed?: boolean }
export interface SqlApplyResult { applied: number; statements: string[] }
export interface SqlEditability {
  editable: boolean
  /** Why not, in words for a person. */
  reason?: string
  columns: { name: string; type: string; nullable: boolean; hasDefault: boolean; generated: boolean; key: boolean }[]
}

export interface MongoWriteInput {
  connectionId: string
  database: string
  collection: string
  op: 'insert' | 'replace' | 'delete'
  /** EJSON text of the new document (insert, replace). */
  document?: string
  /** EJSON text of the document as the person saw it; a replace or delete is refused if it changed. */
  expected?: string
  confirmed?: boolean
}
export interface MongoWriteResult { matched: number; modified: number; deleted: number; insertedId?: string }

export interface PlanNode {
  nodeType: string
  relation?: string
  index?: string
  alias?: string
  joinType?: string
  /** The condition the node applies, in the words of the plan. */
  detail?: string
  startupCost: number
  totalCost: number
  planRows: number
  /** Present after EXPLAIN ANALYZE. */
  actualRows?: number
  actualMs?: number
  loops?: number
  /** Time spent in this node alone (ANALYZE only). */
  selfMs?: number
  selfCost?: number
  readBlocks?: number
  /** 0..1 of the whole plan's time (or cost) spent in this node alone. */
  selfCostShare: number
  children: PlanNode[]
}
export interface SqlExplain {
  analyze: boolean
  plan: PlanNode
  nodeCount: number
  planningMs?: number
  executionMs?: number
  hints: string[]
}
export interface SqlExplainInput { connectionId: string; sql: string; analyze?: boolean; confirmed?: boolean }

export interface SavedQuery { id: string; connectionId: string; name: string; sql: string; createdAt: number; updatedAt: number }
export interface QueryHistoryItem { id: number; sql: string; ranAt: number; durationMs: number | null; rows: number | null; ok: boolean }

export type ExportFormat = 'csv' | 'json' | 'ndjson' | 'sql'
export type ExportSource =
  | { kind: 'sql'; sql: string }
  | { kind: 'table'; schema: string; table: string }
  | { kind: 'collection'; database: string; collection: string; filter?: string }
export interface ExportInput {
  connectionId: string
  /** Chosen by the caller so progress events and a cancel can be matched to this export. */
  exportId: string
  source: ExportSource
  format: ExportFormat
  options?: { delimiter?: ',' | ';' | '\t'; header?: boolean; bom?: boolean; maxRows?: number }
}
export interface ExportResult {
  /** True when the person closed the save dialog; nothing was written. */
  dismissed?: boolean
  cancelled?: boolean
  path?: string
  fileName?: string
  rows: number
  bytes: number
  durationMs: number
}

export type ImportTarget =
  | { kind: 'table'; schema: string; table: string }
  | { kind: 'collection'; database: string; collection: string }
export interface ImportPreview {
  /** Handle for the chosen file; the page never learns its path. */
  importId: string
  fileName: string
  format: 'csv' | 'ndjson' | 'json'
  bytes: number
  /** Field names found in the file, in order. */
  fields: string[]
  /** Up to ten rows as text. */
  sample: string[][]
  /** Columns of the destination table (empty for a collection). */
  targetColumns: { name: string; type: string; nullable: boolean; hasDefault: boolean; generated: boolean }[]
  /** Suggested file field → column mapping (same name, case-insensitive). */
  mapping: Record<string, string>
  dismissed?: boolean
}
export interface ImportRunInput {
  connectionId: string
  importId: string
  target: ImportTarget
  /** File field → destination column. A field that is absent is not imported. */
  mapping: Record<string, string>
  /** Runs everything in a transaction and rolls it back, reporting what would happen. */
  dryRun?: boolean
  emptyAsNull?: boolean
  confirmed?: boolean
}
export interface ImportResult {
  dryRun: boolean
  inserted: number
  rejected: number
  /** First rejected rows with the reason. */
  rejects: { row: number; reason: string }[]
  /** File with every rejected row, written next to the source file. */
  rejectsPath?: string
  cancelled?: boolean
  durationMs: number
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
export interface MongoSchemaField { path: string; /** Percent of sampled documents that have the field. */ presence: number; types: { type: string; count: number }[] }
export interface MongoSchema { sampled: number; fields: MongoSchemaField[]; truncated: boolean }
export interface SqlFunctionInfo { oid: number; name: string; args: string; kind: 'function' | 'procedure' }
export type SqlDefinitionTarget =
  | { kind: 'table' | 'view'; schema: string; name: string }
  | { kind: 'function'; oid: number }

export type ContainerLogEvent = { type: 'container-log'; streamId: string; lines: string[] } | { type: 'container-log-end'; streamId: string; reason: string }
export type OxeQueryEvent = ContainerLogEvent | { type: 'containers-changed' } | { type: 'export-progress'; exportId: string; rows: number; bytes: number } | { type: 'import-progress'; importId: string; rows: number }

export type PickKind = 'ca' | 'cert' | 'key' | 'sshKey'
export interface KnownHost { host: string; port: number; fingerprint: string; firstSeen: number }

export interface OxeQueryOps {
  /** Proves the database worker loads and its bundled drivers are present. */
  'system.ping': { input: Record<string, never>; output: { ok: true; drivers: { postgres: boolean; mongodb: boolean; ssh: boolean }; node: string } }
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
  /** Trust the host key the SSH server of this connection presented, after the person compared the fingerprint. */
  'connections.trustHostKey': { input: { id: string; fingerprint: string }; output: { ok: true } }
  'connections.knownHosts': { input: Record<string, never>; output: KnownHost[] }
  'connections.forgetHostKey': { input: { host: string; port: number }; output: { ok: true } }
  /** Opens a native chooser. Returns a handle for `connections.save`; the content stays in the main process. */
  'files.pick': { input: { kind: PickKind }; output: { handle: string; name: string } | null }
  'connections.fromContainer': { input: { engine?: ContainerEngine; id: string; name?: string }; output: OxeQueryConnection }
  'sql.schemas': { input: { connectionId: string }; output: string[] }
  'sql.tables': { input: { connectionId: string; schema: string }; output: SqlTable[] }
  'sql.table': { input: { connectionId: string; schema: string; table: string }; output: SqlTableDetails }
  'sql.run': { input: SqlRunInput; output: SqlResult }
  'sql.browse': { input: SqlBrowseInput; output: SqlResult }
  'sql.cancel': { input: { connectionId: string }; output: { cancelled: boolean } }
  'sql.editability': { input: { connectionId: string; schema: string; table: string }; output: SqlEditability }
  /** The statements a set of changes would run, with values written in. Executes nothing. */
  'sql.previewChanges': { input: SqlApplyInput; output: { statements: string[] } }
  'sql.apply': { input: SqlApplyInput; output: SqlApplyResult }
  'sql.check': { input: { connectionId: string; sql: string }; output: SqlGuardVerdict }
  'mongo.databases': { input: { connectionId: string }; output: MongoDatabaseInfo[] }
  'mongo.collections': { input: { connectionId: string; database: string }; output: MongoCollectionInfo[] }
  'mongo.find': { input: MongoFindInput; output: MongoResult }
  'mongo.aggregate': { input: MongoAggregateInput; output: MongoResult }
  'mongo.indexes': { input: { connectionId: string; database: string; collection: string }; output: MongoIndexInfo[] }
  'mongo.schema': { input: { connectionId: string; database: string; collection: string; sampleSize?: number }; output: MongoSchema }
  'mongo.createIndex': { input: { connectionId: string; database: string; collection: string; keys: string; unique?: boolean; confirmed?: boolean }; output: { name: string } }
  'mongo.dropIndex': { input: { connectionId: string; database: string; collection: string; name: string; confirmed?: boolean }; output: { dropped: boolean } }
  'sql.functions': { input: { connectionId: string; schema: string }; output: SqlFunctionInfo[] }
  'sql.definition': { input: { connectionId: string } & SqlDefinitionTarget; output: { text: string } }
  'mongo.write': { input: MongoWriteInput; output: MongoWriteResult }
  'export.run': { input: ExportInput; output: ExportResult }
  'sql.explain': { input: SqlExplainInput; output: SqlExplain }
  'library.list': { input: { connectionId: string }; output: { saved: SavedQuery[]; history: QueryHistoryItem[] } }
  'library.save': { input: { connectionId: string; id?: string; name: string; sql: string }; output: SavedQuery }
  'library.delete': { input: { connectionId: string; id: string }; output: { deleted: boolean } }
  'library.clearHistory': { input: { connectionId: string }; output: { deleted: number } }
  'export.cancel': { input: { exportId: string }; output: { cancelled: boolean } }
  'import.preview': { input: { connectionId: string; target: ImportTarget }; output: ImportPreview }
  'import.run': { input: ImportRunInput; output: ImportResult }
  'import.cancel': { input: { importId: string }; output: { cancelled: boolean } }
}

export type OxeQueryOp = keyof OxeQueryOps

export interface OxeQueryErrorInfo {
  code: 'engine-missing' | 'daemon' | 'not-found' | 'invalid' | 'failed' | 'read-only' | 'confirm' | 'connect' | 'query' | 'timeout' | 'cancelled'
    | 'host-key-unknown' | 'host-key-changed' | 'tunnel' | 'conflict'
  message: string
  /** Why a statement was flagged, when code is 'confirm' or 'read-only'. */
  reasons?: string[]
  /** 1-based character offset of the error in the statement the server received. */
  position?: number
  /** PostgreSQL SQLSTATE, e.g. 42P01. */
  sqlState?: string
  hint?: string
}

/** Errors travel as data so the renderer keeps their code (a rejected IPC call loses it). */
export type OxeQueryResponse<T> = { ok: true; value: T } | { ok: false; error: OxeQueryErrorInfo }

export interface OxeQueryApi {
  call<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']): Promise<OxeQueryResponse<OxeQueryOps[K]['output']>>
  onEvent(listener: (event: OxeQueryEvent) => void): () => void
}
