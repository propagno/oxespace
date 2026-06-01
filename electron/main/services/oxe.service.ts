import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type {
  OxeDashboardHandle,
  OxeDetect,
  OxeStatus,
  OxeStatusResult,
  OxeStatusSummary,
  OxeSummaryResult
} from '../../../shared/types/oxe'

/**
 * Thin bridge to the external `oxe-cc` CLI. Spawns `oxe ... --json` and reads
 * the parts the panel needs. Never bundles oxe-cc — it's an independently
 * versioned tool, so every call tolerates absence, non-zero exit, and JSON
 * drift. New capabilities (summary, embedded dashboard) are gated by the
 * detected version so an older oxe-cc degrades gracefully.
 */

// Short TTL: after the user installs oxe-cc the panel should reflect it on the
// next refresh without waiting a minute. The cache just avoids re-spawning
// `oxe --version` on rapid workspace switches.
const VERSION_TTL_MS = 8_000
const STATUS_TIMEOUT_MS = 20_000
const SUMMARY_TIMEOUT_MS = 12_000
const DASHBOARD_LINE_TIMEOUT_MS = 12_000
const WATCH_DEBOUNCE_MS = 500

// Capability floors (see oxe-build docs/INTEGRATION.md).
const MIN_SUMMARY_VERSION = '1.13.0'
const MIN_EMBED_DASHBOARD_VERSION = '1.14.0'

interface SpawnResult {
  stdout: string
  stderr: string
  code: number | null
  error: Error | null
}

function spawnOxe(args: string[], cwd: string | undefined, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('oxe', args, {
        cwd,
        // npm-global bins on Windows are `.cmd` shims — resolve via the shell.
        shell: process.platform === 'win32',
        windowsHide: true,
        env: process.env
      })
    } catch (error) {
      resolve({ stdout: '', stderr: '', code: null, error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (code: number | null, error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code, error })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish(null, new Error(`oxe ${args[0]} exceeded ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (c: string) => { stdout += c })
    child.stderr?.on('data', (c: string) => { stderr += c })
    child.on('error', (err) => finish(null, err))
    child.on('close', (code) => finish(code, null))
  })
}

/** Numeric `a >= b` compare for dotted versions (no pre-release handling). */
function versionGte(a: string | null, b: string): boolean {
  if (!a) return false
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

export class OxeService {
  private detectCache: { value: OxeDetect; at: number } | null = null
  private dashboards = new Map<string, { child: ChildProcess; handle: OxeDashboardHandle }>()
  private watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>()

  /** Broadcast callback for .oxe change events (wired by the IPC layer). */
  constructor(private readonly onEventsChanged: (rootPath: string) => void = () => {}) {}

  async detect(force = false): Promise<OxeDetect> {
    if (!force && this.detectCache && Date.now() - this.detectCache.at < VERSION_TTL_MS) {
      return this.detectCache.value
    }
    const result = await spawnOxe(['--version'], undefined, 10_000)
    const match = /v?(\d+\.\d+\.\d+)/.exec(`${result.stdout} ${result.stderr}`)
    const value: OxeDetect = {
      installed: result.error === null && result.code === 0 && match !== null,
      version: match ? match[1] : null
    }
    this.detectCache = { value, at: Date.now() }
    return value
  }

  async status(rootPath: string, force = false): Promise<OxeStatusResult> {
    const detected = await this.detect(force)
    const isOxeProject = Boolean(rootPath) && existsSync(join(rootPath, '.oxe'))
    if (!detected.installed) {
      return { installed: false, version: detected.version, isOxeProject, status: null, error: null }
    }
    if (!isOxeProject) {
      return { installed: true, version: detected.version, isOxeProject: false, status: null, error: null }
    }
    const result = await spawnOxe(['status', '--json'], rootPath, STATUS_TIMEOUT_MS)
    if (result.error) {
      return { installed: true, version: detected.version, isOxeProject: true, status: null, error: result.error.message }
    }
    const parsed = extractJson<OxeStatus>(result.stdout)
    if (!parsed) {
      return { installed: true, version: detected.version, isOxeProject: true, status: null, error: 'Could not parse `oxe status --json` output.' }
    }
    return { installed: true, version: detected.version, isOxeProject: true, status: parsed, error: null }
  }

  /**
   * Cheap hot-path projection via `oxe status --json --summary` (oxe-cc ≥ 1.13).
   * On older oxe-cc (or a parse failure) `supportsSummary` is false and the
   * renderer falls back to the full `status()` call.
   */
  async statusSummary(rootPath: string, force = false): Promise<OxeSummaryResult> {
    const detected = await this.detect(force)
    const isOxeProject = Boolean(rootPath) && existsSync(join(rootPath, '.oxe'))
    const base = { installed: detected.installed, version: detected.version, isOxeProject }
    if (!detected.installed || !isOxeProject) {
      return { ...base, summary: null, supportsSummary: false, error: null }
    }
    if (!versionGte(detected.version, MIN_SUMMARY_VERSION)) {
      // Old oxe-cc: --summary is an unknown flag; don't even try.
      return { ...base, summary: null, supportsSummary: false, error: null }
    }
    const result = await spawnOxe(['status', '--json', '--summary'], rootPath, SUMMARY_TIMEOUT_MS)
    if (result.error) {
      return { ...base, summary: null, supportsSummary: true, error: result.error.message }
    }
    const parsed = extractJson<OxeStatusSummary>(result.stdout)
    if (!parsed || typeof parsed.oxeSummarySchema !== 'number') {
      // Flag accepted but no recognizable schema — treat as unsupported.
      return { ...base, summary: null, supportsSummary: false, error: null }
    }
    return { ...base, summary: parsed, supportsSummary: true, error: null }
  }

  /** Legacy fire-and-forget — opens the dashboard in the external browser. */
  async openDashboard(rootPath: string): Promise<{ ok: boolean; error: string | null }> {
    const result = await spawnOxe(['dashboard'], rootPath, 30_000)
    return { ok: result.error === null && (result.code === 0 || result.code === null), error: result.error?.message ?? null }
  }

  /**
   * Start (or reuse) an embedded dashboard server for a workspace root. Spawns
   * `oxe dashboard --no-open --port 0 --json` (oxe-cc ≥ 1.14), reads the first
   * JSON line for the live URL/port, and keeps the process alive. Falls back to
   * the external browser on older oxe-cc.
   */
  async startDashboard(rootPath: string): Promise<OxeDashboardHandle> {
    const existing = this.dashboards.get(rootPath)
    if (existing && existing.child.exitCode === null && !existing.child.killed) {
      return existing.handle
    }
    this.stopDashboard(rootPath)

    const detected = await this.detect(false)
    if (!detected.installed) {
      return { ok: false, url: null, port: null, mode: null, error: 'oxe-cc não está instalado.' }
    }
    if (!versionGte(detected.version, MIN_EMBED_DASHBOARD_VERSION)) {
      const ext = await this.openDashboard(rootPath)
      return { ok: ext.ok, url: null, port: null, mode: 'external', error: ext.error }
    }

    let child: ChildProcess
    try {
      child = spawn('oxe', ['dashboard', '--no-open', '--port', '0', '--json'], {
        cwd: rootPath,
        shell: process.platform === 'win32',
        windowsHide: true,
        env: process.env
      })
    } catch (error) {
      return { ok: false, url: null, port: null, mode: null, error: error instanceof Error ? error.message : String(error) }
    }

    const handle = await new Promise<OxeDashboardHandle>((resolve) => {
      let settled = false
      const done = (h: OxeDashboardHandle): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        rl.close()
        resolve(h)
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* gone */ }
        done({ ok: false, url: null, port: null, mode: null, error: 'dashboard não respondeu a tempo.' })
      }, DASHBOARD_LINE_TIMEOUT_MS)
      child.stdout?.setEncoding('utf8')
      const rl = createInterface({ input: child.stdout! })
      rl.on('line', (line) => {
        const parsed = extractJson<{ url?: string; port?: number }>(line)
        if (parsed && parsed.url) {
          done({ ok: true, url: parsed.url, port: parsed.port ?? null, mode: 'embedded', error: null })
        }
      })
      child.on('error', (err) => done({ ok: false, url: null, port: null, mode: null, error: err.message }))
      child.on('exit', () => done({ ok: false, url: null, port: null, mode: null, error: 'dashboard encerrou antes de servir.' }))
    })

    if (handle.ok) {
      this.dashboards.set(rootPath, { child, handle })
      child.on('exit', () => { this.dashboards.delete(rootPath) })
    } else {
      try { child.kill() } catch { /* gone */ }
    }
    return handle
  }

  stopDashboard(rootPath: string): { ok: boolean } {
    const entry = this.dashboards.get(rootPath)
    if (entry) {
      try { entry.child.kill() } catch { /* gone */ }
      this.dashboards.delete(rootPath)
    }
    return { ok: true }
  }

  /**
   * Watch a workspace's `.oxe/` for changes (events, STATE.md, ACTIVE-RUN.json)
   * and fire `onEventsChanged` (debounced). Lets the renderer re-fetch the cheap
   * summary so the panel reflects the agent's progress live.
   */
  watchEvents(rootPath: string): { ok: boolean } {
    if (!rootPath || this.watchers.has(rootPath)) return { ok: true }
    const oxeDir = join(rootPath, '.oxe')
    if (!existsSync(oxeDir)) return { ok: false }
    const fire = (): void => {
      const w = this.watchers.get(rootPath)
      if (!w) return
      if (w.timer) clearTimeout(w.timer)
      w.timer = setTimeout(() => this.onEventsChanged(rootPath), WATCH_DEBOUNCE_MS)
    }
    try {
      // Recursive catches session-scoped logs (.oxe/<session>/execution/…).
      // Recursive watch is supported on win32/darwin; fall back to flat on Linux.
      let watcher: FSWatcher
      try {
        watcher = watch(oxeDir, { recursive: true }, fire)
      } catch {
        watcher = watch(oxeDir, fire)
      }
      watcher.on('error', () => this.unwatchEvents(rootPath))
      this.watchers.set(rootPath, { watcher, timer: null })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  unwatchEvents(rootPath: string): { ok: boolean } {
    const entry = this.watchers.get(rootPath)
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer)
      try { entry.watcher.close() } catch { /* gone */ }
      this.watchers.delete(rootPath)
    }
    return { ok: true }
  }

  /** Tear down every dashboard process and watcher (call on app quit). */
  disposeAll(): void {
    for (const [, entry] of this.dashboards) {
      try { entry.child.kill() } catch { /* gone */ }
    }
    this.dashboards.clear()
    for (const [, entry] of this.watchers) {
      if (entry.timer) clearTimeout(entry.timer)
      try { entry.watcher.close() } catch { /* gone */ }
    }
    this.watchers.clear()
  }
}

/**
 * `oxe ... --json` prints pure JSON, but a banner or stray log line can sneak
 * onto stdout in some shells — slice from the first `{` to the last `}`.
 */
function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
