/**
 * OxeQuery: containers (Docker/Podman) plus PostgreSQL and MongoDB access.
 *
 * Everything crosses a single IPC call, `oxeQuery:call`, described by
 * `OxeQueryOps`. Secrets (database passwords) never appear in an output type.
 */

import type { MaintenanceAction, StructureAction, StructurePlan, StructureResult } from './oxequery-structure'

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

/** A Docker daemon this computer can reach: a named context or the system socket. */
export interface ContainerEngineCandidate {
  /** `context:<name>` or `socket:system`; the only values `containers.useCandidate` accepts. */
  id: string
  label: string
  endpoint: string
  /** The one the Docker CLI uses when nothing is chosen. */
  current: boolean
  /** The one OxeQuery is using now. */
  selected: boolean
  /** ready: answered; denied: the socket refuses this user; unreachable: no daemon; not-checked: remote endpoints are never contacted. */
  state: 'ready' | 'denied' | 'unreachable' | 'not-checked'
  containers?: number
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

export interface ContainerStat {
  id: string
  name: string
  cpuPercent: number
  memoryPercent: number
  memoryUsage: string
  netIO: string
  blockIO: string
  pids: number
}
export interface ImageInfo { id: string; repository: string; tag: string; size: string; created: string }
export interface VolumeInfo { name: string; driver: string }
export interface NetworkInfo { id: string; name: string; driver: string; scope: string }
export interface DiskUsageRow { type: string; total: number; active: number; size: string; reclaimable: string }
export type ResourceKind = 'image' | 'volume' | 'network'
export type PruneKind = 'containers' | 'images'
export interface CreateDatabaseInput {
  engine: DatabaseEngine
  /** Container name; also names the data volume. */
  name: string
  /** Image tag, e.g. `17` or `16-alpine`. */
  tag: string
  /** Host port; the next free one is chosen when omitted. */
  port?: number
  engineName?: ContainerEngine
}

/** One environment variable; `value` is absent when it is, or may be, a secret. */
export interface ContainerEnvEntry { name: string; value?: string }

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
  /** The environment with secrets already removed in the main process: a hidden value never reaches the renderer. */
  environment: ContainerEnvEntry[]
  /** `volume` names a named volume; it outlives the container. */
  mounts: { source: string; destination: string; mode?: string; volume?: string }[]
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
export type SshAuth = 'key' | 'password' | 'agent'
/** Identity colors for a connection's tab and bar; the page maps each to a design token. */
export const CONNECTION_COLORS = ['blue', 'violet', 'pink', 'amber', 'green', 'teal'] as const
export type ConnectionColor = typeof CONNECTION_COLORS[number]

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
  /** Folder in the connection list; empty for none. */
  group: string
  favorite: boolean
  color: ConnectionColor | ''
  /** Column or field names (any part of the name) the agent gateway hides for this connection. */
  maskPatterns: string[]
  lastUsedAt: number
  /** Seconds between keep-alive probes on the connection and its SSH tunnel; 0 turns them off. */
  keepaliveSeconds: number
  /** Connected for this session only: not saved, gone when the app closes. */
  ephemeral?: boolean
  createdAt: number
  updatedAt: number
}

/** OxeQuery's settings. */
export interface OxeQueryPreferences {
  /** Statements kept in each connection's history. */
  historyLimit: number
  /** Days the agent audit log is kept. */
  auditRetentionDays: number
  /** The most an agent may be given on a connection of each kind, whatever the connection says. */
  agentCeiling: Record<ConnectionEnvironment, AgentAccess>
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
  group?: string
  favorite?: boolean
  color?: ConnectionColor | ''
  maskPatterns?: string[]
  keepaliveSeconds?: number
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
  /** Why the rows stop: the row limit, or the size of the result. */
  limitedBy?: 'rows' | 'bytes'
  /** Exact number of rows a filtered table browse matches, when it was cheap to count. */
  totalRows?: number
  durationMs: number
  command?: string
  affectedRows?: number
  notices?: string[]
  /** Set while more rows can be read with `sql.more`; the editor's "Load more". */
  pageId?: string
}

export interface SqlRunInput {
  connectionId: string
  sql: string
  maxRows?: number
  /** The user confirmed a statement the guard flagged. */
  confirmed?: boolean
  /** Keep a long SELECT open so its next rows can be read with `sql.more`. */
  paged?: boolean
  /** Values for `$1`, `$2`…; text the server casts to the parameter's type (null is NULL). */
  params?: (string | null)[]
}

/** A script: every statement runs on its own, in order, and the run stops at the first one that fails. */
export interface SqlScriptInput { connectionId: string; sql: string; maxRows?: number; confirmed?: boolean }
export interface ScriptStatementResult {
  index: number
  /** Offsets of the statement in the script text. */
  start: number
  end: number
  /** The first characters of the statement. */
  sql: string
  result?: SqlResult
  error?: { code: string; message: string; position?: number; sqlState?: string; hint?: string }
}
export interface SqlScriptResult { statements: ScriptStatementResult[]; stoppedAt?: number }

/** The query tabs of a connection as they are saved: text only, never results. */
export interface WorkspaceState {
  v: 1
  activeId: string
  tabs: { id: string; title: string; sql: string; pinned?: boolean }[]
  /** Tables the person pinned to the top of the schema tree. */
  pinned?: { schema: string; name: string; kind: SqlTable['kind'] }[]
}

export interface SqlTxState { state: 'none' | 'open' | 'failed'; statements: number; since?: number }

export type SqlFilterOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith' | 'endsWith' | 'null' | 'notNull' | 'in'
/** One condition of the table filter bar. `value` is text the server casts to the column type. */
export interface SqlFilter { column: string; op: SqlFilterOp; value?: string }

export interface SqlGuardVerdict {
  kind: 'read' | 'write' | 'ddl' | 'destructive' | 'empty'
  reasons: string[]
  statements: number
}

export interface SqlTable { schema: string; name: string; kind: 'table' | 'view' | 'materialized view' | 'foreign table' | 'partitioned table'; approxRows?: number }
/** The tables of one schema; `total` is larger than `tables.length` when the list was cut. */
export interface SqlTables { tables: SqlTable[]; total: number }
export interface SqlColumnInfo { name: string; type: string; nullable: boolean; default?: string; primaryKey: boolean; position: number; identity?: 'always' | 'by-default'; generated?: string; comment?: string }
export interface SqlIndexInfo { name: string; definition: string; unique: boolean; primary: boolean }
export interface SqlConstraintInfo { name: string; kind: 'primary' | 'unique' | 'check' | 'exclusion'; definition: string }
export interface SqlTableProperties { kind: string; owner: string; comment?: string; sizeBytes: number; estimatedRows: number }
export interface SqlDependent { kind: 'foreign key' | 'view'; schema: string; name: string }
export interface SqlPrivilege { grantee: string; privilege: string; grantable: boolean }
export interface SqlTableDetails {
  columns: SqlColumnInfo[]; indexes: SqlIndexInfo[]; foreignKeys: { name: string; definition: string }[]; constraints: SqlConstraintInfo[]; properties: SqlTableProperties | null
  /** What breaks if the table is dropped: tables that reference it and views that read it. */
  dependents: SqlDependent[]
  privileges: SqlPrivilege[]
}
export interface SqlDatabaseInfo { name: string; owner: string; encoding: string; sizeBytes: number | null; connectionLimit: number; current: boolean }
export interface SqlRoleInfo { name: string; superuser: boolean; createDatabase: boolean; createRole: boolean; login: boolean; replication: boolean; connectionLimit: number; memberOf: string[] }

export interface SqlBrowseInput {
  connectionId: string
  schema: string
  table: string
  limit?: number
  offset?: number
  orderBy?: { column: string; direction: 'asc' | 'desc' }
  filters?: SqlFilter[]
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

export interface OxeQueryAuditEntry {
  id: number
  ts: number
  actor: string
  connectionId: string | null
  connectionName: string | null
  engine: string | null
  environment: string | null
  tool: string
  textHash: string | null
  /** Statement text with string literals replaced. */
  text: string | null
  decision: string
  outcome: string
  rows: number | null
  durationMs: number | null
  errorCode: string | null
}

export type ExportFormat = 'csv' | 'json' | 'ndjson' | 'sql' | 'xlsx'
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
/** How a CSV file is read. */
export interface ImportReadOptions {
  delimiter?: 'auto' | ',' | ';' | '\t' | '|'
  hasHeader?: boolean
  encoding?: 'auto' | 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
}
/** What to do with a row whose key already exists in a table. */
export interface ImportConflict { mode: 'error' | 'skip' | 'update'; columns: string[] }
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
  /** The options in force and what was guessed, for a CSV. */
  options?: ImportReadOptions
  detected?: { delimiter: string; encoding: string }
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
  options?: ImportReadOptions
  conflict?: ImportConflict
}
export interface ImportResult {
  dryRun: boolean
  inserted: number
  /** Rows that already existed and were changed (conflict mode update). */
  updated?: number
  /** Rows that already existed and were left alone (conflict mode skip). */
  skipped?: number
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
  skip?: number
}
export interface MongoBulkInput {
  connectionId: string
  database: string
  collection: string
  op: 'updateMany' | 'deleteMany'
  filter: string
  /** Update operators (or a short pipeline) for updateMany. */
  update?: string
  /** Count what would change and write nothing. */
  dryRun?: boolean
  /** The count the person saw and agreed to; a different count now means the data moved, so nothing runs. */
  expectedCount?: number
  confirmed?: boolean
}
export interface MongoBulkResult { matched: number; modified: number; deleted: number; dryRun: boolean }
export type MongoCollectionAction =
  | { kind: 'create'; capped?: boolean; sizeBytes?: number; maxDocuments?: number }
  | { kind: 'rename'; to: string }
  | { kind: 'drop' }
export interface MongoStats { documents: number; sizeBytes: number; avgDocumentBytes: number; storageBytes: number; indexes: number; indexBytes: number; capped: boolean }
export interface MongoValidation { validator: string | null; level: 'off' | 'moderate' | 'strict'; action: 'error' | 'warn' }
export interface MongoExplainSummary {
  stage: string
  index?: string
  keysExamined?: number
  docsExamined?: number
  returned?: number
  timeMs?: number
  stages: string[]
  warnings: string[]
  /** The server's answer as EJSON, for a person who wants all of it. */
  raw: string
}
export interface MongoExplainInput {
  connectionId: string
  database: string
  collection: string
  kind: 'find' | 'aggregate'
  filter?: string
  projection?: string
  sort?: string
  pipeline?: string
  verbosity?: 'queryPlanner' | 'executionStats'
}
export interface MongoResult {
  /** One EJSON (relaxed) string per document. */
  documents: string[]
  /** Positions of documents whose text was cut at 64 KB; they are fetched whole before an edit. */
  oversized?: { index: number; /** The document's `_id` as editable EJSON. */ id: string }[]
  truncated: boolean
  durationMs: number
  /** Total matching documents when it was cheap to learn. */
  total?: number
}
export interface MongoIndexInfo { name: string; keys: string; unique: boolean }
export interface MongoSchemaField { path: string; /** Percent of sampled documents that have the field. */ presence: number; types: { type: string; count: number }[] }
export interface MongoSchema { sampled: number; fields: MongoSchemaField[]; truncated: boolean }
export interface SqlFunctionInfo { oid: number; name: string; args: string; kind: 'function' | 'procedure' }
export interface SqlSequenceInfo { name: string; dataType: string; lastValue: number | null }
export interface SqlTypeInfo { oid: number; name: string; kind: 'enum' | 'composite' | 'domain' | 'range'; values?: string[] }
export interface SqlTriggerInfo { oid: number; name: string; table: string; definition: string; enabled: boolean }
export interface SqlObjects { sequences: SqlSequenceInfo[]; types: SqlTypeInfo[]; triggers: SqlTriggerInfo[]; truncated: boolean }
export interface SqlExtensionInfo { name: string; version: string; schema: string }
export interface SqlSearchHit { kind: SqlTable['kind'] | 'function' | 'procedure' | 'sequence' | 'type'; schema: string; name: string; args?: string; oid?: number }
export interface SqlSearchResult { hits: SqlSearchHit[]; truncated: boolean }
export type SqlDefinitionTarget =
  | { kind: 'table' | 'view' | 'sequence'; schema: string; name: string }
  | { kind: 'function'; oid: number }
  | { kind: 'trigger'; oid: number }
  | { kind: 'type'; oid: number }

export type ContainerLogEvent = { type: 'container-log'; streamId: string; lines: string[] } | { type: 'container-log-end'; streamId: string; reason: string }
export type OxeQueryEvent = ContainerLogEvent | { type: 'containers-changed' } | { type: 'export-progress'; exportId: string; rows: number; bytes: number } | { type: 'import-progress'; importId: string; rows: number }

export type PickKind = 'ca' | 'cert' | 'key' | 'sshKey'
export interface KnownHost { host: string; port: number; fingerprint: string; firstSeen: number }

export interface OxeQueryOps {
  /** Proves the database worker loads and its bundled drivers are present. */
  'system.ping': { input: Record<string, never>; output: { ok: true; drivers: { postgres: boolean; mongodb: boolean; ssh: boolean }; node: string } }
  'containers.engines': { input: { refresh?: boolean }; output: ContainerEngineInfo[] }
  'containers.candidates': { input: Record<string, never>; output: ContainerEngineCandidate[] }
  'containers.useCandidate': { input: { id: string | null }; output: ContainerEngineCandidate[] }
  'containers.list': { input: { engine?: ContainerEngine }; output: { engine: ContainerEngine; containers: ContainerSummary[] } }
  'containers.inspect': { input: { engine?: ContainerEngine; id: string }; output: ContainerInspect }
  'containers.compose': { input: { engine?: ContainerEngine; id: string; action: 'up' | 'down' | 'start' | 'stop' | 'restart' | 'logs'; confirmed?: boolean; tail?: number }; output: { output: string } }
  'containers.action': { input: { engine?: ContainerEngine; id: string; action: ContainerAction }; output: { ok: true } }
  'containers.exec': { input: { engine?: ContainerEngine; id: string; argv: string[]; timeoutMs?: number }; output: ContainerExecResult }
  'containers.logsStart': { input: { engine?: ContainerEngine; id: string; tail?: number }; output: { streamId: string } }
  'containers.logsStop': { input: { streamId: string }; output: { ok: true } }
  'containers.shell': { input: { engine?: ContainerEngine; id: string; shell?: 'sh' | 'bash' }; output: { paneId: string } }
  'containers.suggestConnection': { input: { engine?: ContainerEngine; id: string }; output: ConnectionSuggestion | null }
  'connections.list': { input: Record<string, never>; output: OxeQueryConnection[] }
  'connections.update': { input: { id: string; group?: string; favorite?: boolean; color?: ConnectionColor | '' }; output: OxeQueryConnection }
  'connections.duplicate': { input: { id: string }; output: OxeQueryConnection }
  'connections.connectEphemeral': { input: OxeQueryConnectionInput; output: OxeQueryConnection }
  'connections.reconnect': { input: { id: string }; output: ConnectionTestResult }
  'connections.export': { input: { ids?: string[] }; output: { saved: boolean; count: number } }
  'connections.import': { input: Record<string, never>; output: { imported: number; skipped: number } }
  'preferences.get': { input: Record<string, never>; output: OxeQueryPreferences }
  'preferences.set': { input: Partial<Omit<OxeQueryPreferences, 'agentCeiling'>> & { agentCeiling?: Partial<OxeQueryPreferences['agentCeiling']> }; output: OxeQueryPreferences }
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
  'sql.tables': { input: { connectionId: string; schema: string }; output: SqlTables }
  'sql.table': { input: { connectionId: string; schema: string; table: string }; output: SqlTableDetails }
  'sql.run': { input: SqlRunInput; output: SqlResult }
  'sql.browse': { input: SqlBrowseInput; output: SqlResult }
  'sql.cancel': { input: { connectionId: string }; output: { cancelled: boolean } }
  'sql.more': { input: { connectionId: string; pageId: string; maxRows?: number }; output: SqlResult }
  'sql.script': { input: SqlScriptInput; output: SqlScriptResult }
  'workspace.load': { input: { connectionId: string }; output: { state: WorkspaceState | null } }
  'workspace.save': { input: { connectionId: string; state: WorkspaceState }; output: { ok: true } }
  'sql.tx': { input: { connectionId: string; action: 'begin' | 'commit' | 'rollback' | 'status' }; output: SqlTxState }
  'sql.editability': { input: { connectionId: string; schema: string; table: string }; output: SqlEditability }
  /** The statements a set of changes would run, with values written in. Executes nothing. */
  'sql.previewChanges': { input: SqlApplyInput; output: { statements: string[] } }
  'sql.apply': { input: SqlApplyInput; output: SqlApplyResult }
  'sql.structure.preview': { input: { connectionId: string; schema: string; table: string; action: StructureAction }; output: StructurePlan }
  'sql.structure.apply': { input: { connectionId: string; schema: string; table: string; action: StructureAction; confirmed?: boolean }; output: StructureResult }
  'sql.maintenance': { input: { connectionId: string; schema: string; table: string; action: MaintenanceAction; confirmed?: boolean }; output: { statement: string; durationMs: number } }
  'sql.check': { input: { connectionId: string; sql: string }; output: SqlGuardVerdict }
  'mongo.databases': { input: { connectionId: string }; output: MongoDatabaseInfo[] }
  'mongo.collections': { input: { connectionId: string; database: string }; output: MongoCollectionInfo[] }
  'mongo.find': { input: MongoFindInput; output: MongoResult }
  'mongo.aggregate': { input: MongoAggregateInput; output: MongoResult }
  'mongo.bulk': { input: MongoBulkInput; output: MongoBulkResult }
  'mongo.collection': { input: { connectionId: string; database: string; collection: string; action: MongoCollectionAction; confirmed?: boolean }; output: { ok: true } }
  'mongo.stats': { input: { connectionId: string; database: string; collection: string }; output: MongoStats }
  'mongo.validation': { input: { connectionId: string; database: string; collection: string }; output: MongoValidation }
  'mongo.setValidation': { input: { connectionId: string; database: string; collection: string; validator: string | null; level: MongoValidation['level']; action: MongoValidation['action'] }; output: { ok: true } }
  'mongo.explain': { input: MongoExplainInput; output: MongoExplainSummary }
  'mongo.cancel': { input: { connectionId: string }; output: { cancelled: boolean } }
  'mongo.indexes': { input: { connectionId: string; database: string; collection: string }; output: MongoIndexInfo[] }
  'mongo.schema': { input: { connectionId: string; database: string; collection: string; sampleSize?: number }; output: MongoSchema }
  'mongo.createIndex': { input: { connectionId: string; database: string; collection: string; keys: string; unique?: boolean; confirmed?: boolean }; output: { name: string } }
  'mongo.dropIndex': { input: { connectionId: string; database: string; collection: string; name: string; confirmed?: boolean }; output: { dropped: boolean } }
  'sql.functions': { input: { connectionId: string; schema: string }; output: SqlFunctionInfo[] }
  'sql.databases': { input: { connectionId: string }; output: SqlDatabaseInfo[] }
  'sql.createDatabase': { input: { connectionId: string; name: string; owner?: string; template?: string; encoding?: string }; output: { ok: true } }
  'sql.dropDatabase': { input: { connectionId: string; name: string; confirmed?: boolean }; output: { ok: true } }
  'sql.roles': { input: { connectionId: string }; output: SqlRoleInfo[] }
  'sql.objects': { input: { connectionId: string; schema: string }; output: SqlObjects }
  'sql.extensions': { input: { connectionId: string }; output: SqlExtensionInfo[] }
  'sql.search': { input: { connectionId: string; query: string }; output: SqlSearchResult }
  'sql.definition': { input: { connectionId: string } & SqlDefinitionTarget; output: { text: string } }
  'mongo.write': { input: MongoWriteInput; output: MongoWriteResult }
  'mongo.document': { input: { connectionId: string; database: string; collection: string; id: string }; output: { text: string } }
  'export.run': { input: ExportInput; output: ExportResult }
  'sql.explain': { input: SqlExplainInput; output: SqlExplain }
  'containers.stats': { input: { engine?: ContainerEngine }; output: ContainerStat[] }
  'resources.images': { input: { engine?: ContainerEngine }; output: ImageInfo[] }
  'resources.volumes': { input: { engine?: ContainerEngine }; output: VolumeInfo[] }
  'resources.networks': { input: { engine?: ContainerEngine }; output: NetworkInfo[] }
  'resources.usage': { input: { engine?: ContainerEngine }; output: DiskUsageRow[] }
  'resources.remove': { input: { kind: ResourceKind; id: string; engine?: ContainerEngine; confirmed?: boolean }; output: { ok: true } }
  /** Stopped containers or dangling images, all at once. Refused unless the person confirmed. */
  'resources.prune': { input: { kind: PruneKind; engine?: ContainerEngine; confirmed?: boolean }; output: { output: string } }
  /** Removes one container (stopping it first). Its volumes stay. Refused unless the person confirmed. */
  'containers.remove': { input: { id: string; engine?: ContainerEngine; confirmed?: boolean }; output: { ok: true } }
  'containers.createDatabase': { input: CreateDatabaseInput; output: OxeQueryConnection }
  'audit.list': { input: { connectionId?: string; limit?: number }; output: OxeQueryAuditEntry[] }
  'library.list': { input: { connectionId: string }; output: { saved: SavedQuery[]; history: QueryHistoryItem[] } }
  'library.save': { input: { connectionId: string; id?: string; name: string; sql: string }; output: SavedQuery }
  'library.delete': { input: { connectionId: string; id: string }; output: { deleted: boolean } }
  'library.clearHistory': { input: { connectionId: string }; output: { deleted: number } }
  'export.cancel': { input: { exportId: string }; output: { cancelled: boolean } }
  'import.preview': { input: { connectionId: string; target: ImportTarget }; output: ImportPreview }
  'import.reparse': { input: { connectionId: string; importId: string; target: ImportTarget; options: ImportReadOptions }; output: ImportPreview }
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
