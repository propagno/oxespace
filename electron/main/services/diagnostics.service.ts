import { app } from 'electron'
import { withheldSummary } from '../../../shared/env-scrub'
import { exportRuntimeDiagnostics, runtimeDiagnosticsAvailable } from './runtime-diagnostics'
import { statfsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AppDatabase } from '../db'
import type { InternalMcpStatus } from '../../../shared/types/mcp-internal'
import type { DiagnosticCheck, DiagnosticsSnapshot } from '../../../shared/types/diagnostics'
import { redactSecrets } from '../../../shared/secrets'
import { APP_VERSION } from './app-info'

export class DiagnosticsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly getMcpStatus: () => InternalMcpStatus
  ) {}

  getSnapshot(): DiagnosticsSnapshot {
    const checks: DiagnosticCheck[] = []
    checks.push({ id: 'runtime-log', label: 'Runtime diagnostics', tone: runtimeDiagnosticsAvailable() ? 'ok' : 'warning', detail: runtimeDiagnosticsAvailable() ? 'Local only · 1.5 MiB maximum · seven days' : 'Unavailable; restart after checking disk space and permissions' })
    try {
      const disk = statfsSync(app.getPath('userData'))
      const freeMiB = Math.floor(disk.bavail * disk.bsize / 1024 / 1024)
      checks.push({ id: 'disk', label: 'Available disk space', tone: freeMiB < 512 ? 'warning' : 'ok', detail: `${freeMiB} MiB` })
    } catch { checks.push({ id: 'disk', label: 'Available disk space', tone: 'warning', detail: 'Unavailable' }) }
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
    // Names only: which inherited variables the last agent launches left out (roadmap S7).
    const withheld = withheldSummary().filter(item => item.names.length)
    checks.push({ id: 'env-withheld', label: 'Withheld environment variables', tone: 'ok',
      detail: withheld.length ? withheld.map(item => `${item.scope}: ${item.names.slice(0, 12).join(', ')}${item.names.length > 12 ? ` +${item.names.length - 12}` : ''}`).join(' · ') : 'none since start' })
    checks.push({ id: 'sandbox', label: 'Renderer sandbox', tone: 'ok', detail: 'enabled · context isolation enabled' })

    const workspaceCount = (this.db.prepare('SELECT COUNT(*) AS count FROM workspaces').get() as { count: number }).count
    return {
      generatedAt: Date.now(),
      appVersion: APP_VERSION,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? 'unknown',
      workspaceCount,
      checks
    }
  }

  buildSanitizedReport(_logPath?: string | null): string {
    const snapshot = this.getSnapshot()
    // General logs and health error strings may contain user/provider content.
    const safeSnapshot = { ...snapshot, checks: snapshot.checks.map(({ id, label, tone }) => ({ id, label, tone })) }
    return [
      '# OXESpace diagnostics',
      '',
      '```json',
      JSON.stringify(safeSnapshot, null, 2),
      '```',
      '',
      '## Compact runtime events',
      'Local metadata only; up to 1.5 MiB, seven-day retention. Repeated events are counted; bursts may be omitted. No terminal output, prompts, arguments or environment. IDs are hashed. Child processes created inside agents are only visible when reported by the provider. General main-process logs are excluded.',
      '',
      '```text',
      exportRuntimeDiagnostics(),
      '```',
      ''
    ].join('\n')
  }
}

export function sanitizeDiagnosticText(value: string): string {
  const home = homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A pasted diagnostic should read naturally on the host it came from.
  const homeToken = process.platform === 'win32' ? '%USERPROFILE%' : '~'
  return redactSecrets(value
    .replace(new RegExp(home, 'gi'), homeToken)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|secret|password|authorization|api[_-]?key)["'\s:=]+)([^\s,"'}]+)/gi, '$1[REDACTED]'))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
