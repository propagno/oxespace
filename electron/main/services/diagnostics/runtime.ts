import { app, net } from 'electron'
import log from 'electron-log/main.js'
import { hostname, release, userInfo } from 'node:os'
import { APP_VERSION } from '../app-info'
import { dirname, join } from 'node:path'
import { mainMessage } from '../../../../shared/messages'
import type { AppConnectivity } from '../../../../shared/types/app'
import type { DiagnosticsMetrics, DiagnosticsSnapshot } from '../../../../shared/types/diagnostics'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import { getAppUpdateState } from '../../updater'
import { sharedProjectMemoryEnabled } from '../experimental-features'
import { exportRuntimeDiagnostics } from '../runtime-diagnostics'
import { buildBundle, type Bundle } from './bundle'
import { knownAccounts, knownCliVersion } from './facts'
import type { IncidentJournal } from './incident-journal'
import { cliFinder, collectMetrics, measureStorage, type McpCounts, type MetricsSources } from './metrics'
import { buildAnalysisSummary } from './summary'
import { MetricsWatcher } from './watcher'

/**
 * Everything behind the B8.3 channels, loaded the first time the panel or the tool needs it. Electron and the app's
 * services are reached here; the pieces it composes take plain functions so they are tested without Electron.
 */
export interface DiagnosticsDependencies {
  snapshot(): DiagnosticsSnapshot
  journal(): Promise<IncidentJournal | null>
  terminals?(): { running: number; agents: number }
  mcpServers?(): McpCounts
  knownPids?: MetricsSources['knownPids']
  databaseFile: string
  userData: string
}

export class DiagnosticsRuntime {
  readonly watcher: MetricsWatcher
  private readonly sources: MetricsSources

  constructor(private readonly deps: DiagnosticsDependencies) {
    const clis = cliFinder(knownCliVersion)
    this.sources = {
      appMetrics: () => app.getAppMetrics(),
      knownPids: deps.knownPids,
      terminals: deps.terminals,
      mcpServers: deps.mcpServers,
      storage: () => measureStorage({ dataDirectory: deps.userData, databaseFile: deps.databaseFile, logDirectories: [dirname(logFile()), join(deps.userData, 'diagnostics')] }),
      connectivity,
      clis: () => clis(),
      accounts: knownAccounts
    }
    this.watcher = new MetricsWatcher(() => this.metrics(), IPC_CHANNELS.diagnostics.onMetrics)
  }

  metrics(): Promise<DiagnosticsMetrics> { return collectMetrics(this.sources) }

  async incidents(input: { since?: number; limit?: number } = {}) {
    return (await this.deps.journal())?.list(input) ?? []
  }

  /** The one summary: the window's "Ask for an analysis" and `oxespace_diagnostics` both return this text. */
  async analysisSummary(): Promise<string> {
    const [incidents, metrics] = await Promise.all([this.incidents(), this.metrics()])
    return buildAnalysisSummary({ incidents, metrics, version: APP_VERSION, platform: process.platform, arch: process.arch, now: Date.now() })
  }

  async bundle(): Promise<Bundle> {
    const journal = await this.deps.journal()
    return buildBundle({
      snapshot: () => this.deps.snapshot(),
      metrics: () => this.metrics(),
      incidents: () => journal?.list() ?? [],
      runtimeEvents: exportRuntimeDiagnostics,
      logFiles: () => { const file = logFile(); return [join(dirname(file), 'main.old.log'), file] },
      about,
      configuration: () => {
        const preferences = getAppUpdateState().preferences
        return {
          updates: preferences ? { mode: preferences.mode, channel: preferences.channel, pinned: preferences.pinnedVersion !== null } : null,
          sharedProjectMemory: sharedProjectMemoryEnabled(),
          packaged: app.isPackaged,
          workspaces: safe(() => this.deps.snapshot().workspaceCount, null),
          mcpServers: safe(() => this.deps.mcpServers?.() ?? null, null)
        }
      },
      names: () => [safe(() => hostname(), ''), safe(() => userInfo().username, '')]
    })
  }
}

/** Whether the system reports a network route. A seam over `net.isOnline()` until the app-info connectivity watcher (#168) lands. */
function connectivity(): AppConnectivity {
  const checkedAt = Date.now()
  try {
    return net.isOnline() ? { state: 'online', checkedAt } : { state: 'offline', checkedAt, reason: mainMessage('app.connectivity.offline', {}) }
  } catch { return { state: 'unknown', checkedAt } }
}

/** Versions only, as About shows them: no path, account or machine name. */
function about(): Record<string, unknown> {
  return {
    name: 'OXESpace', version: APP_VERSION, packaged: app.isPackaged,
    versions: { electron: process.versions.electron ?? null, chrome: process.versions.chrome ?? null, node: process.versions.node, v8: process.versions.v8 },
    platform: process.platform, arch: process.arch, osRelease: safe(() => release(), null)
  }
}

function logFile(): string {
  try { return log.transports.file.getFile().path } catch { return join(app.getPath('logs'), 'main.log') }
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}
