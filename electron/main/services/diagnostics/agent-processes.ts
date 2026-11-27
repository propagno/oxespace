import { execFile } from 'node:child_process'
import { cpus } from 'node:os'
import { win32 } from 'node:path'
import type {
  AgentProcessGovernancePolicy,
  AgentProcessesSnapshot,
  ExternalAgentProcess,
  ManagedAgentProcessTree
} from '../../../../shared/types/diagnostics'
import type { ManagedAgentProcessRegistry } from './agent-process-registry'

export interface OsProcessSample {
  pid: number
  ppid: number
  name: string
  cpuPercent: number
  memoryBytes: number
}

export type OsProcessSampler = () => Promise<OsProcessSample[]>

export const EXTERNAL_AGENT_EXECUTABLES = ['agy', 'claude', 'codex', 'copilot', 'cursor'] as const
export const ANTIVIRUS_HIGH_CPU_THRESHOLD = 15

const MAX_WALK_PIDS = 4096
const SAMPLE_TIMEOUT_MS = 4_000
const POWERSHELL = win32.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const PS = '/bin/ps'

// Queries live process table + formatted CPU% via CIM in one bounded non-interactive command; never uses ELECTRON_RUN_AS_NODE.
const WIN32_SAMPLE_SCRIPT = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$perf = @{}',
  'foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process) { if ($p.IDProcess -gt 0) { $perf[[int]$p.IDProcess] = [double]$p.PercentProcessorTime } }',
  '$rows = foreach ($proc in Get-CimInstance Win32_Process) {',
  '  $id = [int]$proc.ProcessId',
  '  if ($id -le 0) { continue }',
  '  [pscustomobject]@{ pid = $id; ppid = [int]$proc.ParentProcessId; name = [string]$proc.Name; cpuPercent = [double]($perf[$id]); memoryBytes = [int64]$proc.WorkingSetSize }',
  '}',
  '$rows | ConvertTo-Json -Compress'
].join('; ')

const round1 = (value: number): number => Math.round(finiteNonNegative(value) * 10) / 10
const finiteNonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

export function normalizeExecutableName(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '')
    .trim()
    .toLowerCase() ?? ''
}

export function externalProviderForName(rawName: string): string | null {
  const norm = normalizeExecutableName(rawName)
  if (!norm) return null
  if (norm === 'antigravity') return 'antigravity'
  for (const exe of EXTERNAL_AGENT_EXECUTABLES) {
    if (norm === exe) return exe === 'agy' ? 'agy' : exe
  }
  return null
}

/** BFS walk of all live descendant PIDs under `rootPid` with cycle guard and bounded cap. */
export function walkDescendants(samples: readonly OsProcessSample[], rootPid: number): number[] {
  const byParent = new Map<number, number[]>()
  for (const sample of samples) {
    if (!Number.isInteger(sample.pid) || sample.pid <= 1) continue
    const list = byParent.get(sample.ppid) ?? []
    list.push(sample.pid)
    byParent.set(sample.ppid, list)
  }
  const seen = new Set<number>([rootPid])
  const queue = [rootPid]
  const descendants: number[] = []
  for (let i = 0; i < queue.length && descendants.length < MAX_WALK_PIDS; i++) {
    for (const child of byParent.get(queue[i]) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      descendants.push(child)
      queue.push(child)
      if (descendants.length >= MAX_WALK_PIDS) break
    }
  }
  return descendants
}

/** Parses `ps -A -o pid=,ppid=,pcpu=,rss=,comm=` output (RSS is reported in KiB). */
export function parsePosixPsOutput(output: string): OsProcessSample[] {
  const out: OsProcessSample[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(.+)$/.exec(trimmed)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const cpuPercent = round1(Number(match[3]))
    const rssKb = Number(match[4])
    const name = match[5].trim()
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid)) continue
    out.push({
      pid,
      ppid,
      name,
      cpuPercent,
      memoryBytes: Math.round(finiteNonNegative(rssKb) * 1024)
    })
  }
  return out
}

/** Parses Windows PowerShell CIM JSON output, normalizing PercentProcessorTime by logical CPU count. */
export function parseWindowsProcessJson(output: string, logicalCpus = Math.max(1, cpus().length)): OsProcessSample[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const divisor = Math.max(1, logicalCpus)
  const out: OsProcessSample[] = []
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const pid = Math.trunc(Number(row.pid ?? row.ProcessId))
    const ppid = Math.trunc(Number(row.ppid ?? row.ParentProcessId))
    const name = String(row.name ?? row.Name ?? '').trim()
    if (!Number.isSafeInteger(pid) || pid <= 0 || !name) continue
    const rawCpu = finiteNonNegative(Number(row.cpuPercent ?? row.PercentProcessorTime ?? 0))
    const memoryBytes = Math.round(finiteNonNegative(Number(row.memoryBytes ?? row.WorkingSetSize ?? 0)))
    out.push({
      pid,
      ppid: Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : 0,
      name,
      cpuPercent: round1(rawCpu / divisor),
      memoryBytes
    })
  }
  return out
}

function defaultExec(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise(resolve => {
    try {
      execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => {
        resolve(typeof stdout === 'string' ? stdout : '')
      })
    } catch {
      resolve('')
    }
  })
}

export async function sampleOsProcesses(options: {
  platform?: NodeJS.Platform
  exec?: (file: string, args: string[], timeoutMs: number) => Promise<string>
  logicalCpus?: number
} = {}): Promise<OsProcessSample[]> {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? defaultExec
  if (platform === 'win32') {
    const out = await exec(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', WIN32_SAMPLE_SCRIPT], SAMPLE_TIMEOUT_MS)
    return parseWindowsProcessJson(out, options.logicalCpus)
  }
  const out = await exec(PS, ['-A', '-o', 'pid=,ppid=,pcpu=,rss=,comm='], SAMPLE_TIMEOUT_MS)
  return parsePosixPsOutput(out)
}

export interface CollectAgentProcessesInput {
  registry: ManagedAgentProcessRegistry
  sampler?: OsProcessSampler
  policy: AgentProcessGovernancePolicy
  now?: number
}

/**
 * On-demand snapshot of managed OXESpace agent process trees and read-only external agent processes.
 * Invoked only when Diagnostics is subscribed or explicitly queried.
 */
export async function collectAgentProcesses(input: CollectAgentProcessesInput): Promise<AgentProcessesSnapshot> {
  const now = input.now ?? Date.now()
  const samples = await (input.sampler ? input.sampler() : sampleOsProcesses()).catch(() => [] as OsProcessSample[])
  const byPid = new Map<number, OsProcessSample>()
  for (const sample of samples) byPid.set(sample.pid, sample)

  const claimedPids = new Set<number>()
  const managed: ManagedAgentProcessTree[] = []

  for (const record of input.registry.listManaged()) {
    const childPids = walkDescendants(samples, record.rootPid)
    claimedPids.add(record.rootPid)
    for (const childPid of childPids) claimedPids.add(childPid)

    const rootSample = byPid.get(record.rootPid)
    let cpu = rootSample?.cpuPercent ?? 0
    let mem = rootSample?.memoryBytes ?? 0
    for (const childPid of childPids) {
      const childSample = byPid.get(childPid)
      if (!childSample) continue
      cpu += childSample.cpuPercent
      mem += childSample.memoryBytes
    }
    managed.push({
      managed: true,
      rootPid: record.rootPid,
      provider: record.provider,
      kind: record.kind,
      contextId: record.contextId,
      label: record.label,
      childCount: childPids.length,
      childPids,
      cpuPercent: round1(cpu),
      memoryBytes: Math.round(finiteNonNegative(mem)),
      priority: record.priority,
      state: record.state,
      startedAt: record.startedAt,
      idleSinceMs: record.idleSinceMs,
      jobGoverned: record.jobGoverned
    })
  }

  managed.sort((a, b) => b.memoryBytes - a.memoryBytes || b.cpuPercent - a.cpuPercent || a.rootPid - b.rootPid)

  const external: ExternalAgentProcess[] = []
  let defenderCpu = 0
  for (const sample of samples) {
    if (normalizeExecutableName(sample.name) === 'msmpeng') {
      defenderCpu += sample.cpuPercent
    }
    if (claimedPids.has(sample.pid)) continue
    const provider = externalProviderForName(sample.name)
    if (!provider) continue
    external.push({
      managed: false,
      pid: sample.pid,
      parentPid: sample.ppid,
      provider,
      name: sample.name,
      cpuPercent: round1(sample.cpuPercent),
      memoryBytes: Math.round(finiteNonNegative(sample.memoryBytes))
    })
  }

  external.sort((a, b) => b.memoryBytes - a.memoryBytes || b.cpuPercent - a.cpuPercent || a.pid - b.pid)

  const activeCount = managed.filter(item => item.state === 'active').length
  const idleCount = managed.length - activeCount
  const managedCpuPercent = round1(managed.reduce((sum, item) => sum + item.cpuPercent, 0))
  const managedMemoryBytes = managed.reduce((sum, item) => sum + item.memoryBytes, 0)
  const externalCpuPercent = round1(external.reduce((sum, item) => sum + item.cpuPercent, 0))
  const externalMemoryBytes = external.reduce((sum, item) => sum + item.memoryBytes, 0)
  const antivirusCpuPercent = round1(defenderCpu)
  const antivirusHighCpu = antivirusCpuPercent > ANTIVIRUS_HIGH_CPU_THRESHOLD

  return {
    collectedAt: now,
    managed,
    external,
    totals: {
      managedCount: managed.length,
      activeCount,
      idleCount,
      externalCount: external.length,
      managedCpuPercent,
      managedMemoryBytes,
      externalCpuPercent,
      externalMemoryBytes
    },
    ...(antivirusHighCpu ? { antivirusHighCpu: true, antivirusCpuPercent } : {}),
    policy: { ...input.policy }
  }
}
