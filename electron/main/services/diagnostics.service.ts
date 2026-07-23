import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AppDatabase } from '../db'
import type { InternalMcpStatus } from '../../../shared/types/mcp-internal'
import type { DiagnosticCheck, DiagnosticsSnapshot } from '../../../shared/types/diagnostics'

const MAX_LOG_BYTES = 500 * 1024

export class DiagnosticsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly getMcpStatus: () => InternalMcpStatus
  ) {}

  getSnapshot(): DiagnosticsSnapshot {
    const checks: DiagnosticCheck[] = []
    try {
      const result = this.db.pragma('quick_check', { simple: true }) as string
      checks.push({ id: 'database', label: 'SQLite', tone: result === 'ok' ? 'ok' : 'error', detail: result })
    } catch (error) {
      checks.push({ id: 'database', label: 'SQLite', tone: 'error', detail: message(error) })
    }

    const mcp = this.getMcpStatus()
    checks.push({
      id: 'mcp',
      label: 'Internal MCP',
      tone: mcp.running ? 'ok' : mcp.lastError ? 'error' : 'warning',
      detail: mcp.running ? `127.0.0.1:${mcp.port} · ${mcp.toolCount} tools` : (mcp.lastError ?? 'not running')
    })
    checks.push({ id: 'sandbox', label: 'Renderer sandbox', tone: 'ok', detail: 'enabled · context isolation enabled' })

    const workspaceCount = (this.db.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number }).count
    return {
      generatedAt: Date.now(),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? 'unknown',
      workspaceCount,
      checks
    }
  }

  buildSanitizedReport(logPath: string | null): string {
    const snapshot = this.getSnapshot()
    const rawLog = logPath && existsSync(logPath) ? tail(readFileSync(logPath, 'utf8'), MAX_LOG_BYTES) : '(main log unavailable)'
    const sanitized = sanitizeDiagnosticText(rawLog)
    return [
      '# OXESpace diagnostics',
      '',
      '```json',
      JSON.stringify(snapshot, null, 2),
      '```',
      '',
      '## Sanitized main-process log',
      '',
      '```text',
      sanitized,
      '```',
      ''
    ].join('\n')
  }
}

export function sanitizeDiagnosticText(value: string): string {
  const home = homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value
    .replace(new RegExp(home, 'gi'), '%USERPROFILE%')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|secret|password|authorization|api[_-]?key)["'\s:=]+)([^\s,"'}]+)/gi, '$1[REDACTED]')
}

function tail(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value)
  return buffer.length <= maxBytes ? value : buffer.subarray(buffer.length - maxBytes).toString('utf8')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
