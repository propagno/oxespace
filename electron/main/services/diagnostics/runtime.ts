import { app, net } from 'electron'
import log from 'electron-log/main.js'
import { hostname, release, userInfo } from 'node:os'
import { APP_VERSION } from '../app-info'
import { dirname, join } from 'node:path'
import { mainMessage } from '../../../../shared/messages'
import type { AppConnectivity } from '../../../../shared/types/app'
import type {
  AgentProcessControlRequest,
  AgentProcessControlResponse,
  AgentProcessesSnapshot,
  DiagnosticsMetrics,
  DiagnosticsSnapshot
} from '../../../../shared/types/diagnostics'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import { getAppUpdateState } from '../../updater'
import { sharedProjectMemoryEnabled } from '../experimental-features'
import { exportRuntimeDiagnostics } from '../runtime-diagnostics'
import { perfJournal, summarize } from '../perf/perf-journal'
import { AgentIdleReaper } from './agent-idle-reaper'
import { AgentProcessController, type ProcessGovernanceBackend } from './agent-process-control'
import { AgentProcessPolicyStore } from './agent-process-policy'
import { managedAgentProcessRegistry, type ManagedAgentProcessRecord, type ManagedAgentProcessRegistry } from './agent-process-registry'
import { collectAgentProcesses, sampleOsProcesses, type OsProcessSampler } from './agent-processes'
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
  agentProcessRegistry?: ManagedAgentProcessRegistry
  agentProcessSampler?: OsProcessSampler
  agentProcessGovernance?: ProcessGovernanceBackend
  hibernateManagedAgent?: (entry: ManagedAgentProcessRecord) => Promise<boolean>
  enableAgentProcesses?: boolean
  enableIdleReaperTimer?: boolean
  databaseFile: string
  userData: string
}

const AGENT_SNAPSHOT_CACHE_MS = 1_500

export class DiagnosticsRuntime {
  readonly watcher: MetricsWatcher
  readonly policyStore: AgentProcessPolicyStore
  readonly processController: AgentProcessController
  readonly idleReaper: AgentIdleReaper
  private readonly registry: ManagedAgentProcessRegistry
  private readonly sampler: OsProcessSampler
  private readonly detachAutoEco: () => void
  private readonly sources: MetricsSources
  private policyLoaded = false
  private cachedAgentSnapshot: { at: number; snapshot: AgentProcessesSnapshot } | null = null

  constructor(private readonly deps: DiagnosticsDependencies) {
    const clis = cliFinder(knownCliVersion)
    this.registry = deps.agentProcessRegistry ?? managedAgentProcessRegistry
    this.sampler = deps.agentProcessSampler ?? (() => sampleOsProcesses())
    this.policyStore = new AgentProcessPolicyStore(join(deps.userData, 'agent-process-policy.json'))
    this.processController = new AgentProcessController({
      registry: this.registry,
      sampler: this.sampler,
      getPolicy: () => this.policyStore.get(),
      governance: deps.agentProcessGovernance,
      hibernateManaged: deps.hibernateManagedAgent
    })
    this.idleReaper = new AgentIdleReaper({
      registry: this.registry,
      getPolicy: () => this.policyStore.get(),
      hibernateManaged: deps.hibernateManagedAgent ?? (async entry => {
        if (entry.stop) { await entry.stop(); return true }
        return false
      })
    })
    this.detachAutoEco = this.processController.attachAutoEco()
    if (deps.enableIdleReaperTimer) this.idleReaper.start()
    this.sources = {
      appMetrics: () => app.getAppMetrics(),
      knownPids: deps.knownPids,
      terminals: deps.terminals,
      mcpServers: deps.mcpServers,
      storage: () => measureStorage({ dataDirectory: deps.userData, databaseFile: deps.databaseFile, logDirectories: [dirname(logFile()), join(deps.userData, 'diagnostics')] }),
      connectivity,
      clis: () => clis(),
      accounts: knownAccounts,
      agentProcesses: () => this.sampleAgentProcessesOnDemand()
    }
    this.watcher = new MetricsWatcher(() => this.metrics(), IPC_CHANNELS.diagnostics.onMetrics)
  }

  private async ensurePolicyLoaded(): Promise<void> {
    if (this.policyLoaded) return
    this.policyLoaded = true
    await this.policyStore.load()
  }

  private async sampleAgentProcessesOnDemand(force = false): Promise<AgentProcessesSnapshot | undefined> {
    const enabled = this.deps.enableAgentProcesses === true || Boolean(this.deps.agentProcessSampler) || this.registry.listManaged().length > 0
    if (!force && (!enabled || (this.watcher.size === 0 && this.registry.listManaged().length === 0 && !this.deps.agentProcessSampler))) {
      return undefined
    }
    const now = Date.now()
    if (!force && this.cachedAgentSnapshot && now - this.cachedAgentSnapshot.at < AGENT_SNAPSHOT_CACHE_MS) {
      return this.cachedAgentSnapshot.snapshot
    }
    await this.ensurePolicyLoaded()
    const snapshot = await collectAgentProcesses({
      registry: this.registry,
      sampler: this.sampler,
      policy: this.policyStore.get(),
      now
    })
    this.cachedAgentSnapshot = { at: now, snapshot }
    return snapshot
  }

  async handleAgentProcesses(request: AgentProcessControlRequest): Promise<AgentProcessControlResponse> {
    await this.ensurePolicyLoaded()
    switch (request.op) {
      case 'snapshot':
        return (await this.sampleAgentProcessesOnDemand(true))!
      case 'getPolicy':
        return this.policyStore.get()
      case 'setPolicy': {
        const next = await this.policyStore.update(request.policy)
        this.cachedAgentSnapshot = null
        return next
      }
      case 'setPriority': {
        const res = await this.processController.setPriority(request.rootPid, request.priority)
        this.cachedAgentSnapshot = null
        return res
      }
      case 'hibernate': {
        const res = await this.processController.hibernate(request.rootPid)
        this.cachedAgentSnapshot = null
        return res
      }
      case 'killTree': {
        const res = await this.processController.killTree(request.rootPid)
        this.cachedAgentSnapshot = null
        return res
      }
      case 'reapIdle': {
        const report = await this.idleReaper.sweep()
        this.cachedAgentSnapshot = null
        return { ok: true, reapedPids: report.reaped.map(item => item.rootPid) }
      }
    }
  }

  dispose(): void {
    this.watcher.stopAll()
    this.idleReaper.stop()
    this.detachAutoEco()
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
      performance: () => { const lines = perfJournal()?.export() ?? ''; return `${summarize(lines)}\n## Lines\n\n${lines}` },
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
