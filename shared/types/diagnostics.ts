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
  /** Tells the main process the first screen has painted, closing its startup timeline. */
  reportInteractive(): Promise<void>
  /** Writes the local "time to first answer" to the runtime log on this computer. Nothing is sent anywhere. */
  recordFirstAnswer(input: FirstAnswerInput): Promise<void>
}

export interface FirstAnswerInput {
  durationMs: number
  /** Where the first answer came from. */
  kind: 'thread' | 'code'
}
