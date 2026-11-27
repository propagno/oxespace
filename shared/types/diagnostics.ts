export type DiagnosticTone = 'ok' | 'warning' | 'error'

export interface DiagnosticCheck {
  id: string
  label: string
  tone: DiagnosticTone
  detail: string
}

export interface DiagnosticsSnapshot {
  generatedAt: number
  appVersion: string
  platform: string
  arch: string
  nodeVersion: string
  electronVersion: string
  workspaceCount: number
  checks: DiagnosticCheck[]
}

export interface DiagnosticsApi {
  getSnapshot(): Promise<DiagnosticsSnapshot>
  exportReport(): Promise<string | null>
  /** The issue text for Help › Report a problem, built and redacted locally. Nothing is sent anywhere. */
  buildIssueReport(): Promise<import('../issue-report').IssueReport>
  /** Tells the main process the first screen has painted, closing its startup timeline. */
  reportInteractive(): Promise<void>
  /** Writes the local "time to first answer" to the runtime log on this computer. Nothing is sent anywhere. */
  recordFirstAnswer(input: FirstAnswerInput): Promise<void>
  /** Starts measuring for this window; nothing is measured without a subscription, and it ends when the window closes or reloads. */
  watch?(input?: { intervalMs?: number }): Promise<{ subscriptionId: string }>
  unwatch?(input: { subscriptionId: string }): Promise<void>
  onMetrics?(listener: (metrics: DiagnosticsMetrics) => void): () => void
  incidents?(input?: { since?: number; limit?: number }): Promise<DiagnosticsIncident[]>
  clearIncidents?(): Promise<void>
  onIncidentsChanged?(listener: (event: { count: number }) => void): () => void
  /** What the export would contain, already redacted, for the person to look at before saving. */
  previewBundle?(): Promise<DiagnosticsBundlePreview>
  /** Saves the bundle as a .zip where the person chooses; the path, or null when cancelled. Nothing is sent anywhere. */
  exportBundle?(): Promise<string | null>
  /** The Markdown "Ask for an analysis" attaches to a Thread: the same text `oxespace_diagnostics` returns. */
  analysisSummary?(): Promise<string>
  /** The window's frame and input times since its last report, for the local performance journal. Nothing is sent anywhere. */
  reportPerf?(batch: { stats: Record<string, { n: number; sum: number; max: number; b: number[] }> }): Promise<void>
  /**
   * A crash in the window, to the incident journal as `incident.window.rendererError` (OXE-366): which boundary caught
   * it, the component, the error's class name, a C3 code and a hash of the stack's shape. Never a message, a path or
   * any other text: main refuses a report with anything outside this contract. Nothing is sent anywhere.
   */
  reportRendererError?(input: RendererErrorInput): Promise<void>
  /** Renderer-only agent/subagent process monitoring and resource governance dispatch (OXE-450). */
  agentProcesses?(request: AgentProcessControlRequest): Promise<AgentProcessControlResponse>
}

/** Where a renderer crash was caught (an ErrorBoundary's `id`). `host` is one of the window's global hosts (OXE-366). */
export const RENDERER_ERROR_BOUNDARIES = ['root', 'window', 'conversations', 'mode-view', 'sidebar', 'settings-page', 'workspace-grid', 'workspace-panel', 'pane', 'terminal', 'title-bar', 'approvals', 'host'] as const
export type RendererErrorBoundary = typeof RENDERER_ERROR_BOUNDARIES[number]
export const RENDERER_ERROR_KINDS = ['boundary', 'uncaught', 'unhandledRejection'] as const
export type RendererErrorKind = typeof RENDERER_ERROR_KINDS[number]
/** One renderer crash, as names and a hash only. */
export interface RendererErrorInput {
  kind: RendererErrorKind
  /** Present only for kind 'boundary'. */
  boundary?: RendererErrorBoundary
  component?: string
  errorName: string
  code?: string
  stackHash?: string
}
/** A component or error class name. */
export const RENDERER_ERROR_IDENTIFIER = /^[A-Za-z_$][\w$.]{0,79}$/
/** The stack's shape, hashed (FNV-1a or longer), never the stack itself. */
export const RENDERER_ERROR_STACK_HASH = /^[0-9a-f]{8,64}$/
/** A C3 message code, such as `workspace.root.missing`. */
export const RENDERER_ERROR_CODE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+){1,5}$/

export interface FirstAnswerInput {
  durationMs: number
  /** Where the first answer came from. */
  kind: 'thread' | 'code'
}

/** Bounds of the subscription, the journal and the summary (B8.3). */
export const DIAGNOSTICS_LIMITS = {
  minIntervalMs: 2_000,
  defaultIntervalMs: 5_000,
  maxIntervalMs: 30_000,
  incidentRetentionMs: 30 * 24 * 60 * 60 * 1000,
  maxIncidents: 500,
  maxJournalBytes: 256 * 1024,
  maxIncidentsPage: 500,
  maxSummaryChars: 4_000
} as const

/**
 * `oxequery-worker` is reserved: the OxeQuery worker is a worker thread, so it is counted in `main` (the panel says so).
 */
export type DiagnosticsProcessKind = 'main' | 'renderer' | 'gpu' | 'oxequery-worker' | 'utility' | 'other'

export interface DiagnosticsProcess {
  kind: DiagnosticsProcessKind
  pid: number
  cpuPercent: number
  memoryBytes: number
}

/** One measurement while the panel is open. No paths, account names, e-mail addresses or host names. */
export interface DiagnosticsMetrics {
  at: number
  processes: DiagnosticsProcess[]
  terminals: { running: number; agents: number }
  /** The computer's own size, so meters can show a share. No name or path. */
  system: { totalMemoryBytes: number }
  storage: { freeBytes: number | null; diskTotalBytes: number | null; databaseBytes: number; logsBytes: number }
  connectivity: import('./app').AppConnectivity
  /** `null` until the remote gateway exists in this build. */
  gateway: { enabled: boolean; devices: number; connected: number } | null
  clis: { id: string; found: boolean; version?: string }[]
  accounts: { provider: string; signedIn: boolean }[]
  mcpServers: { total: number; healthy: number; quarantined: number; failing: number }
  /** On-demand managed and read-only external agent process snapshot (OXE-450). */
  agentProcesses?: AgentProcessesSnapshot
}

export type AgentProcessKind = 'chat' | 'terminal' | 'delegation' | 'automation'
export type AgentProcessPriority = 'normal' | 'belowNormal' | 'low'
export type AgentProcessState = 'active' | 'idle'

export interface ManagedAgentProcessTree {
  managed: true
  rootPid: number
  provider: string
  kind: AgentProcessKind
  contextId: string
  label: string
  childCount: number
  childPids: number[]
  cpuPercent: number
  memoryBytes: number
  priority: AgentProcessPriority
  state: AgentProcessState
  startedAt: number
  idleSinceMs: number | null
  jobGoverned: boolean
}

export interface ExternalAgentProcess {
  managed: false
  pid: number
  parentPid: number
  provider: string
  name: string
  cpuPercent: number
  memoryBytes: number
}

export interface AgentProcessGovernancePolicy {
  autoEcoBackground: boolean
  idleReaperEnabled: boolean
  idleTtlMinutes: number
  maxConcurrentAgents: number
}

export const AGENT_IDLE_TTL_CHOICES = [0, 5, 10, 15, 30, 60] as const

export const DEFAULT_AGENT_PROCESS_POLICY: AgentProcessGovernancePolicy = {
  autoEcoBackground: true,
  idleReaperEnabled: true,
  idleTtlMinutes: 15,
  maxConcurrentAgents: 8
}

export interface AgentProcessesTotals {
  managedCount: number
  activeCount: number
  idleCount: number
  externalCount: number
  managedCpuPercent: number
  managedMemoryBytes: number
  externalCpuPercent: number
  externalMemoryBytes: number
}

export interface AgentProcessesSnapshot {
  collectedAt: number
  managed: ManagedAgentProcessTree[]
  external: ExternalAgentProcess[]
  totals: AgentProcessesTotals
  antivirusHighCpu?: boolean
  antivirusCpuPercent?: number
  policy: AgentProcessGovernancePolicy
}

export type AgentProcessControlRequest =
  | { op: 'snapshot' }
  | { op: 'getPolicy' }
  | { op: 'setPolicy'; policy: Partial<AgentProcessGovernancePolicy> }
  | { op: 'setPriority'; rootPid: number; priority: AgentProcessPriority }
  | { op: 'hibernate'; rootPid: number }
  | { op: 'killTree'; rootPid: number }
  | { op: 'reapIdle' }

export interface AgentProcessPriorityResult {
  ok: boolean
  rootPid: number
  priority: AgentProcessPriority
  appliedPids: number[]
  failedPids: number[]
  jobGoverned: boolean
  error?: string
}

export interface AgentProcessActionResult {
  ok: boolean
  rootPid?: number
  reapedPids?: number[]
  terminatedPids?: number[]
  error?: string
}

export type AgentProcessControlResponse =
  | AgentProcessesSnapshot
  | AgentProcessGovernancePolicy
  | AgentProcessPriorityResult
  | AgentProcessActionResult

export const DIAGNOSTICS_AREAS = ['app', 'window', 'ipc', 'agent', 'mcp', 'database', 'oxequery', 'updater', 'interaction', 'policy'] as const
export type DiagnosticsArea = typeof DIAGNOSTICS_AREAS[number]

/** Each kind of incident, with the area it belongs to. Its words are the C3 code's. */
export const DIAGNOSTICS_INCIDENT_CODES = {
  'incident.window.crashed': 'window',
  'incident.window.rendererGone': 'window',
  /** A React crash in the window, reported by the window itself (OXE-366): a boundary caught it, or nothing did. */
  'incident.window.rendererError': 'window',
  'incident.ipc.handlerFailed': 'ipc',
  'incident.ipc.validationRejected': 'ipc',
  'incident.ipc.senderRefused': 'ipc',
  'incident.agent.startFailed': 'agent',
  'incident.mcp.quarantined': 'mcp',
  'incident.mcp.toolGroupOff': 'mcp',
  'incident.database.busy': 'database',
  'incident.oxequery.timeout': 'oxequery',
  'incident.oxequery.restartDeferred': 'oxequery',
  'incident.updater.failed': 'updater',
  'incident.interaction.overBudget': 'interaction',
  'incident.app.journalReset': 'app',
  'incident.app.closeUnanswered': 'app',
  'incident.app.closeRendererGone': 'app',
  'incident.app.closeGuardFailed': 'app',
  'incident.window.externalRefused': 'window',
  'incident.window.externalRateLimited': 'window',
  'incident.window.externalOpenFailed': 'window',
  'incident.window.openDenied': 'window',
  'incident.window.navigationDenied': 'window',
  'incident.policy.changedOutside': 'policy'
} as const satisfies Record<string, DiagnosticsArea>
export type DiagnosticsIncidentCode = keyof typeof DIAGNOSTICS_INCIDENT_CODES

/**
 * One kind of problem, grouped: the same code, area and subject add to `count` and move `lastAt`. Never content, an
 * argument or a raw error message; `subject` is a hashed id (8 hex characters), as in runtime-diagnostics.
 */
export interface DiagnosticsIncident {
  id: string
  code: DiagnosticsIncidentCode
  area: DiagnosticsArea
  firstAt: number
  lastAt: number
  count: number
  subject?: string
}

export interface DiagnosticsBundlePreview {
  /** `summary` says what the file holds, as a code the window translates (`bundle.file.*`). */
  files: { name: string; bytes: number; summary: import('../messages').MainMessage }[]
  /** How many values the redaction replaced. */
  redactions: number
}
