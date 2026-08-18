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
}
