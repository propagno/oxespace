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
}

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

export type DiagnosticsProcessKind = 'main' | 'renderer' | 'gpu' | 'oxequery-worker' | 'codegraph' | 'utility' | 'other'

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
}

export const DIAGNOSTICS_AREAS = ['app', 'window', 'ipc', 'agent', 'mcp', 'database', 'oxequery', 'updater', 'interaction'] as const
export type DiagnosticsArea = typeof DIAGNOSTICS_AREAS[number]

/** Each kind of incident, with the area it belongs to. Its words are the C3 code's. */
export const DIAGNOSTICS_INCIDENT_CODES = {
  'incident.window.crashed': 'window',
  'incident.window.rendererGone': 'window',
  'incident.ipc.handlerFailed': 'ipc',
  'incident.agent.startFailed': 'agent',
  'incident.mcp.quarantined': 'mcp',
  'incident.database.busy': 'database',
  'incident.oxequery.timeout': 'oxequery',
  'incident.updater.failed': 'updater',
  'incident.interaction.overBudget': 'interaction',
  'incident.app.journalReset': 'app'
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
