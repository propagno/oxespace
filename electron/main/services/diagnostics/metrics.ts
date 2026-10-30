import { readdir, stat, statfs } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { AppConnectivity } from '../../../../shared/types/app'
import type { DiagnosticsMetrics, DiagnosticsProcess, DiagnosticsProcessKind } from '../../../../shared/types/diagnostics'

/**
 * One measurement for the diagnostics panel (B8.3). Built only when a window is subscribed or someone asks for the
 * summary; nothing here runs on its own. Counts, sizes and yes/no only: no path, account name, e-mail or host.
 */
export interface ProcessMetricLike {
  pid: number
  type: string
  cpu: { percentCPUUsage: number }
  memory: { workingSetSize: number }
}

export interface McpCounts { total: number; healthy: number; quarantined: number; failing: number }

export interface MetricsSources {
  appMetrics(): ProcessMetricLike[]
  /** Pids of processes the app starts itself, where a service exposes one. */
  knownPids?(): Partial<Record<'oxequery-worker' | 'codegraph', number | undefined>>
  terminals?(): { running: number; agents: number }
  storage(): Promise<DiagnosticsMetrics['storage']>
  connectivity(): AppConnectivity
  clis(): Promise<DiagnosticsMetrics['clis']>
  accounts(): DiagnosticsMetrics['accounts']
  mcpServers?(): McpCounts
}

const ELECTRON_KINDS: Record<string, DiagnosticsProcessKind> = { Browser: 'main', Tab: 'renderer', GPU: 'gpu', Utility: 'utility' }

export function classifyProcess(metric: Pick<ProcessMetricLike, 'pid' | 'type'>, known: ReturnType<NonNullable<MetricsSources['knownPids']>> = {}): DiagnosticsProcessKind {
  for (const kind of ['oxequery-worker', 'codegraph'] as const) if (known[kind] !== undefined && known[kind] === metric.pid) return kind
  return ELECTRON_KINDS[metric.type] ?? 'other'
}

const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

export async function collectMetrics(sources: MetricsSources, now = Date.now()): Promise<DiagnosticsMetrics> {
  const known = safe(() => sources.knownPids?.() ?? {}, {})
  const processes: DiagnosticsProcess[] = safe(() => sources.appMetrics(), []).map(metric => ({
    kind: classifyProcess(metric, known),
    pid: Math.trunc(finite(metric.pid)),
    cpuPercent: Math.round(finite(metric.cpu?.percentCPUUsage) * 10) / 10,
    // Electron reports kilobytes.
    memoryBytes: Math.round(finite(metric.memory?.workingSetSize) * 1024)
  }))
  const [storage, clis] = await Promise.all([
    sources.storage().catch(() => ({ freeBytes: null, databaseBytes: 0, logsBytes: 0 })),
    sources.clis().catch(() => [])
  ])
  return {
    at: now,
    processes,
    terminals: safe(() => sources.terminals?.() ?? { running: 0, agents: 0 }, { running: 0, agents: 0 }),
    storage,
    connectivity: safe(() => sources.connectivity(), { state: 'unknown', checkedAt: now }),
    gateway: null, // no remote gateway in this build
    clis,
    accounts: safe(() => sources.accounts(), []),
    mcpServers: safe(() => sources.mcpServers?.() ?? { total: 0, healthy: 0, quarantined: 0, failing: 0 }, { total: 0, healthy: 0, quarantined: 0, failing: 0 })
  }
}

function safe<T>(read: () => T, fallback: T): T {
  try { return read() } catch { return fallback }
}

/** Free space on the data volume (null where statfs is missing), the database with its WAL, and the log folders. */
export async function measureStorage(input: { dataDirectory: string; databaseFile: string; logDirectories: string[] }): Promise<DiagnosticsMetrics['storage']> {
  let freeBytes: number | null = null
  try {
    if (typeof statfs === 'function') {
      const disk = await statfs(input.dataDirectory)
      freeBytes = Number(disk.bavail) * Number(disk.bsize)
    }
  } catch { freeBytes = null }
  let databaseBytes = 0
  for (const suffix of ['', '-wal', '-shm']) databaseBytes += await fileSize(input.databaseFile + suffix)
  let logsBytes = 0
  for (const directory of input.logDirectories) {
    let names: string[]
    try { names = await readdir(directory) } catch { continue }
    for (const name of names) logsBytes += await fileSize(join(directory, name))
  }
  return { freeBytes, databaseBytes, logsBytes }
}

async function fileSize(path: string): Promise<number> {
  try { const info = await stat(path); return info.isFile() ? info.size : 0 } catch { return 0 }
}

/** The agent and tool CLIs the panel lists. */
export const DIAGNOSTICS_CLIS = ['claude', 'codex', 'gemini', 'copilot', 'gh', 'git', 'docker'] as const

/**
 * Whether each CLI is on PATH: stat only, no process started, and the answer kept for five minutes so a tick never
 * searches PATH again. The version comes from what another service already learned.
 */
export function cliFinder(version: (id: string) => string | undefined, env: NodeJS.ProcessEnv = process.env, platform = process.platform, ttlMs = 5 * 60_000) {
  let cached: { at: number; found: Map<string, boolean> } | null = null
  return async (now = Date.now()): Promise<DiagnosticsMetrics['clis']> => {
    if (!cached || now - cached.at > ttlMs) {
      const found = new Map<string, boolean>()
      const directories = (env.PATH ?? env.Path ?? env.path ?? '').split(delimiter).filter(Boolean).slice(0, 200)
      const extensions = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(item => item.toLowerCase())] : ['']
      for (const id of DIAGNOSTICS_CLIS) found.set(id, await onPath(id, directories, extensions))
      cached = { at: now, found }
    }
    return DIAGNOSTICS_CLIS.map(id => {
      const known = cached!.found.get(id) === true ? version(id) : undefined
      return { id, found: cached!.found.get(id) === true, ...(known ? { version: known } : {}) }
    })
  }
}

async function onPath(id: string, directories: string[], extensions: string[]): Promise<boolean> {
  for (const directory of directories) {
    for (const extension of extensions) {
      try { if ((await stat(join(directory, id + extension))).isFile()) return true } catch { /* not here */ }
    }
  }
  return false
}
