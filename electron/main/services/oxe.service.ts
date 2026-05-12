import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type {
  OxeArtifactGroup,
  OxeArtifactKind,
  OxeArtifactSummary,
  OxeEngineStatus,
  OxeFreshness,
  OxeStateSummary,
  OxeStatus,
  OxeWorkspaceInput
} from '../../../shared/types/ipc'
import { safeJoin } from '../utils/safe-join'

interface OxeServiceOptions {
  spawnVersion?: (command: string) => SpawnSyncReturns<string>
  spawnJson?: (command: string, args: string[], cwd: string) => SpawnSyncReturns<string>
  spawnGit?: (args: string[], cwd: string) => SpawnSyncReturns<string>
}

const KNOWN_ARTIFACTS: Array<{ kind: OxeArtifactKind; group: OxeArtifactGroup; label: string; relativePath: string; priority: number }> = [
  { kind: 'state', group: 'operational', label: 'STATE', relativePath: '.oxe/STATE.md', priority: 10 },
  { kind: 'activeRun', group: 'operational', label: 'ACTIVE-RUN', relativePath: '.oxe/ACTIVE-RUN.json', priority: 20 },
  { kind: 'plan', group: 'operational', label: 'PLAN', relativePath: '.oxe/PLAN.md', priority: 30 },
  { kind: 'spec', group: 'operational', label: 'SPEC', relativePath: '.oxe/SPEC.md', priority: 40 },
  { kind: 'other', group: 'rationality', label: 'IMPLEMENTATION-PACK', relativePath: '.oxe/IMPLEMENTATION-PACK.json', priority: 50 },
  { kind: 'other', group: 'rationality', label: 'REFERENCE-ANCHORS', relativePath: '.oxe/REFERENCE-ANCHORS.md', priority: 60 },
  { kind: 'other', group: 'rationality', label: 'FIXTURE-PACK', relativePath: '.oxe/FIXTURE-PACK.json', priority: 70 },
  { kind: 'verify', group: 'operational', label: 'VERIFY', relativePath: '.oxe/VERIFY.md', priority: 80 },
  { kind: 'events', group: 'runtime', label: 'OXE-EVENTS', relativePath: '.oxe/OXE-EVENTS.ndjson', priority: 90 },
  { kind: 'other', group: 'runtime', label: 'EXECUTION-RUNTIME', relativePath: '.oxe/EXECUTION-RUNTIME.md', priority: 100 },
  { kind: 'summary', group: 'operational', label: 'SUMMARY', relativePath: '.oxe/SUMMARY.md', priority: 110 },
  { kind: 'summary', group: 'runtime', label: 'RUN-SUMMARY', relativePath: '.oxe/RUN-SUMMARY.md', priority: 120 },
  { kind: 'summary', group: 'release', label: 'COMMIT-SUMMARY', relativePath: '.oxe/COMMIT-SUMMARY.md', priority: 130 },
  { kind: 'summary', group: 'release', label: 'PROMOTION-SUMMARY', relativePath: '.oxe/PROMOTION-SUMMARY.md', priority: 140 },
  { kind: 'other', group: 'context', label: 'Context packs', relativePath: '.oxe/context/packs', priority: 150 },
  { kind: 'other', group: 'context', label: 'Context summaries', relativePath: '.oxe/context/summaries', priority: 160 },
  { kind: 'other', group: 'evidence', label: 'Evidence', relativePath: '.oxe/evidence', priority: 170 },
  { kind: 'other', group: 'product', label: 'README', relativePath: 'README.md', priority: 200 },
  { kind: 'other', group: 'product', label: 'CHANGELOG', relativePath: 'CHANGELOG.md', priority: 210 },
  { kind: 'other', group: 'product', label: 'package.json', relativePath: 'package.json', priority: 220 },
  { kind: 'other', group: 'product', label: 'oxe-cc CLI', relativePath: 'bin/oxe-cc.js', priority: 230 },
  { kind: 'other', group: 'product', label: 'Workflows', relativePath: 'oxe/workflows', priority: 240 },
  { kind: 'other', group: 'product', label: 'Runtime package', relativePath: 'packages/runtime', priority: 250 },
  { kind: 'other', group: 'product', label: 'SDK', relativePath: 'lib/sdk', priority: 260 }
]

export class OxeService {
  private readonly spawnVersion: (command: string) => SpawnSyncReturns<string>
  private readonly spawnJson: (command: string, args: string[], cwd: string) => SpawnSyncReturns<string>
  private readonly spawnGit: (args: string[], cwd: string) => SpawnSyncReturns<string>
  private readonly lastRefreshByRoot = new Map<string, { at: string; mtimeMs: number | null }>()

  constructor(options: OxeServiceOptions = {}) {
    this.spawnVersion = options.spawnVersion ?? ((command) =>
      spawnSync(command, ['--version'], {
        encoding: 'utf8',
        shell: true,
        timeout: 2500,
        windowsHide: true
      }))
    this.spawnJson = options.spawnJson ?? ((command, args, cwd) =>
      spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        shell: true,
        timeout: 8000,
        windowsHide: true
      }))
    this.spawnGit = options.spawnGit ?? ((args, cwd) =>
      spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        shell: true,
        timeout: 2500,
        windowsHide: true
      }))
  }

  getStatus(input: OxeWorkspaceInput): OxeStatus {
    const rootPath = safeJoin(input.rootPath)
    const artifacts = this.listArtifactsRich({ ...input, rootPath })
    const isOxeProject = existsSync(safeJoin(rootPath, '.oxe'))
    const stateArtifact = artifacts.find((artifact) => artifact.kind === 'state' && artifact.exists)
    const warnings: string[] = []
    let state: OxeStateSummary | null = null
    const engine = this.detectEngine(rootPath)
    const cliStatus = engine.available ? this.readCliStatus(rootPath, engine.command) : null

    if (cliStatus) {
      const freshness = this.getFreshness({ ...input, rootPath })
      this.lastRefreshByRoot.set(rootPath, {
        at: new Date().toISOString(),
        mtimeMs: freshness.latestWorkspaceMtimeMs
      })
      const cliIsOxeProject = cliStatus.isOxeProject === true
      return {
        workspaceId: input.workspaceId,
        rootPath,
        isOxeProject: cliIsOxeProject || isOxeProject,
        engine,
        state: cliIsOxeProject || isOxeProject ? stateFromCliStatus(cliStatus) : null,
        artifacts,
        warnings: compactWarnings(cliStatus),
        updatedAt: new Date().toISOString(),
        rawStatusJson: cliStatus,
        healthStatus: stringOrNull(cliStatus.healthStatus),
        nextStep: stringOrNull(cliStatus.nextStep),
        cursorCmd: stringOrNull(cliStatus.cursorCmd),
        executionRationality: cliStatus.executionRationality ?? null,
        activeRun: cliStatus.activeRun ?? null,
        contextQuality: cliStatus.contextQuality ?? null,
        diagnostics: cliStatus.diagnostics ?? null,
        semanticsDrift: cliStatus.semanticsDrift ?? null,
        packFreshness: cliStatus.packFreshness ?? null,
        freshness
      }
    }

    if (stateArtifact?.exists) {
      try {
        state = parseState(readFileSync(safeJoin(rootPath, stateArtifact.relativePath), 'utf8'))
      } catch (error) {
        warnings.push(toMessage(error))
      }
    } else if (isOxeProject) {
      warnings.push('Projeto OXE sem .oxe/STATE.md')
    }

    return {
      workspaceId: input.workspaceId,
      rootPath,
      isOxeProject,
      engine,
      state,
      artifacts,
      warnings,
      updatedAt: new Date().toISOString(),
      freshness: this.getFreshness({ ...input, rootPath })
    }
  }

  listArtifacts(input: OxeWorkspaceInput): OxeArtifactSummary[] {
    return this.listArtifactsRich(input).filter((artifact) => artifact.priority !== undefined && artifact.priority <= 110)
  }

  listArtifactsRich(input: OxeWorkspaceInput): OxeArtifactSummary[] {
    const rootPath = safeJoin(input.rootPath)
    return KNOWN_ARTIFACTS.map((artifact) => {
      const filePath = safeJoin(rootPath, artifact.relativePath)
      if (!existsSync(filePath)) {
        return { ...artifact, exists: false, size: null, mtimeMs: null }
      }
      const fileStat = statSync(filePath)
      return {
        ...artifact,
        exists: fileStat.isFile() || fileStat.isDirectory(),
        size: fileStat.isFile() ? fileStat.size : null,
        mtimeMs: fileStat.mtimeMs
      }
    }).filter((artifact) => artifact.group !== 'product' || this.isOxeBuildProductRoot(rootPath))
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  }

  getFreshness(input: OxeWorkspaceInput): OxeFreshness {
    const rootPath = safeJoin(input.rootPath)
    const latestWorkspaceMtimeMs = latestMtime(rootPath)
    const lastRefresh = this.lastRefreshByRoot.get(rootPath) ?? null
    const dirtyFiles = this.gitDirtyFiles(rootPath)
    const state = dirtyFiles.length > 0
      ? 'dirty'
      : lastRefresh && latestWorkspaceMtimeMs !== null && lastRefresh.mtimeMs !== null && latestWorkspaceMtimeMs > lastRefresh.mtimeMs
        ? 'stale'
        : 'fresh'
    const reason =
      state === 'dirty'
        ? 'Workspace has uncommitted changes outside the current OXE view.'
        : state === 'stale'
          ? 'Workspace files changed after the last OXE status refresh.'
          : null

    return {
      state,
      reason,
      lastStatusAt: lastRefresh?.at ?? null,
      latestWorkspaceMtimeMs,
      dirtyFiles,
      suggestedActions: suggestedActionsForFreshness(state)
    }
  }

  detectEngine(rootPath?: string): OxeEngineStatus {
    const candidates = rootPath ? this.engineCandidates(rootPath) : ['oxe-cc']
    for (const command of candidates) {
      const result = command.startsWith('node ') ? this.spawnJson(command, ['--version'], rootPath ?? process.cwd()) : this.spawnVersion(command)
      if (result.status === 0) {
        const version = `${result.stdout ?? result.stderr ?? ''}`.trim().split(/\s+/).find((part) => /^v?\d+\.\d+\.\d+/.test(part)) ?? null
        return {
          available: true,
          version,
          command,
          message: null
        }
      }
    }

    const result = this.spawnVersion('oxe-cc')
    if (result.status === 0) {
      const version = `${result.stdout ?? result.stderr ?? ''}`.trim().split(/\s+/).find((part) => /^v?\d+\.\d+\.\d+/.test(part)) ?? null
      return {
        available: true,
        version,
        command: 'oxe-cc',
        message: null
      }
    }

    return {
      available: false,
      version: null,
      command: 'oxe-cc',
      message: result.error?.message || `${result.stderr || result.stdout || 'oxe-cc not found'}`.trim()
    }
  }

  private readCliStatus(rootPath: string, command: string): Record<string, unknown> | null {
    const result = this.spawnJson(command, ['status', '--json', '--dir', rootPath], rootPath)
    if (result.status !== 0) return null
    try {
      return JSON.parse(result.stdout)
    } catch {
      return null
    }
  }

  private engineCandidates(rootPath: string): string[] {
    const candidates: string[] = []
    const configured = process.env.OXESPACE_OXE_CLI
    if (configured) {
      candidates.push(configured.endsWith('.js') ? `node "${configured}"` : configured)
    }
    const sibling = join(dirname(rootPath), 'oxe-build', 'bin', 'oxe-cc.js')
    if (existsSync(sibling)) {
      candidates.push(`node "${sibling}"`)
    }
    candidates.push('oxe-cc')
    return Array.from(new Set(candidates))
  }

  private gitDirtyFiles(rootPath: string): string[] {
    const result = this.spawnGit(['status', '--porcelain'], rootPath)
    if (result.status !== 0) return []
    return `${result.stdout ?? ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 50)
  }

  private isOxeBuildProductRoot(rootPath: string): boolean {
    return existsSync(safeJoin(rootPath, 'bin/oxe-cc.js')) && existsSync(safeJoin(rootPath, 'oxe/workflows')) && existsSync(safeJoin(rootPath, 'packages/runtime'))
  }
}

function parseState(content: string): OxeStateSummary {
  return {
    status: readBullet(content, 'Status da run'),
    runId: readBullet(content, 'Run ID') ?? readBullet(content, 'run_id'),
    runtimeStatus: readBullet(content, 'runtime_status'),
    lifecycleStatus: readBullet(content, 'lifecycle_status'),
    nextStep: readSectionFirstBullet(content, 'Proximo passo') ?? readSectionFirstBullet(content, 'Próximo passo')
  }
}

function readBullet(content: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`- \\*\\*${escaped}:\\*\\*\\s*(.+)`))
  return match ? cleanMarkdown(match[1]) : null
}

function readSectionFirstBullet(content: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`## ${escaped}[\\s\\S]*?\\n\\s*-\\s+(.+)`, 'm'))
  return match ? cleanMarkdown(match[1]) : null
}

function cleanMarkdown(value: string): string {
  return value.replace(/`/g, '').trim()
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro ao ler estado OXE'
}

function stateFromCliStatus(status: Record<string, unknown>): OxeStateSummary | null {
  const activeRun = asRecord(status.activeRun)
  return {
    status: stringOrNull(status.phase) ?? stringOrNull(status.healthStatus),
    runId: stringOrNull(activeRun?.run_id),
    runtimeStatus: stringOrNull(asRecord(activeRun?.canonical_state)?.run ? asRecord(asRecord(activeRun?.canonical_state)?.run)?.status : null),
    lifecycleStatus: stringOrNull(activeRun?.status),
    nextStep: stringOrNull(status.nextStep) ?? stringOrNull(status.cursorCmd)
  }
}

function compactWarnings(status: Record<string, unknown>): string[] {
  const diagnostics = asRecord(status.diagnostics)
  const warningArrays = [
    status.criticalExecutionGaps,
    diagnostics?.runtimeWarnings,
    diagnostics?.planWarnings,
    diagnostics?.reviewWarnings,
    diagnostics?.copilotWarnings,
    diagnostics?.codexWarnings
  ]
  return warningArrays.flatMap((value) => (Array.isArray(value) ? value.map(String) : [])).slice(0, 12)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function latestMtime(rootPath: string): number | null {
  try {
    let latest = existsSync(rootPath) ? statSync(rootPath).mtimeMs : null
    const entries = readdirSync(rootPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out' || entry.name === '.git') continue
      const fullPath = join(rootPath, entry.name)
      const stat = statSync(fullPath)
      latest = latest === null ? stat.mtimeMs : Math.max(latest, stat.mtimeMs)
    }
    return latest
  } catch {
    return null
  }
}

function suggestedActionsForFreshness(state: OxeFreshness['state']) {
  if (state === 'fresh') {
    return [{ label: 'Refresh status', command: 'npx oxe-cc status --json', mode: 'terminal' as const }]
  }
  return [
    { label: 'Refresh status', command: 'npx oxe-cc status --json', mode: 'terminal' as const },
    { label: 'Replan if code changed', command: '/prompts:oxe-plan --replan', mode: 'copy' as const },
    { label: 'Verify current state', command: '/prompts:oxe-verify', mode: 'copy' as const }
  ]
}
