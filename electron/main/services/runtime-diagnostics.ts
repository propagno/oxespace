import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const FILE_BYTES = 512 * 1024
const RETENTION_MS = 7 * 86400_000
const WINDOW_MS = 60_000
// Only these scalar fields can reach disk. Never pass arguments, output or error messages.
export interface RuntimeDetail {
  pid?: number; parentPid?: number; exitCode?: number; durationMs?: number; generation?: number
  thread?: string; turn?: string; task?: string; pane?: string; executable?: string
  state?: string; kind?: string
  version?: string
}
const states = new Set(['running', 'started', 'completed', 'failed', 'interrupted', 'closed', 'unknown', 'cancelled', 'pending', 'approval', 'crashed', 'killed', 'oom', 'launch-failed', 'clean-exit', 'abnormal-exit', 'integrity-failure'])
const kinds = new Set(['code', 'thread', 'agent', 'GPU', 'Utility', 'Renderer', 'Browser'])
export function diagnosticId(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 16) }
function safeDetail(input: RuntimeDetail): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  for (const key of ['pid', 'parentPid', 'exitCode', 'durationMs', 'generation'] as const) {
    const value = input[key]
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.trunc(value)
  }
  for (const key of ['thread', 'turn', 'task', 'pane'] as const) if (input[key]) result[key] = diagnosticId(input[key]!)
  if (input.executable) {
    let executable = input.executable
    try { executable = realpathSync(executable) } catch { /* failed launches may not resolve */ }
    const normalized = executable.replace(/\\/g, '/')
    let name = basename(normalized).toLowerCase().replace(/\.(exe|cmd|ps1)$/, '')
    if (/\/claude\/versions\/\d+\.\d+\.\d+$/.test(normalized)) { result.executableVersion = name; name = 'claude' }
    result.executable = ['claude', 'claude-desktop', 'codex', 'node', 'electron', 'oxespace', 'bash', 'zsh', 'sh', 'pwsh', 'powershell', 'cmd'].includes(name) ? name : 'custom'
    result.executableId = diagnosticId(executable)
  }
  if (input.state) result.state = states.has(input.state) ? input.state : 'unknown'
  if (input.kind) result.kind = kinds.has(input.kind) ? input.kind : 'agent'
  if (input.version && /^\d[\da-zA-Z.+-]{0,40}$/.test(input.version)) result.version = input.version
  return result
}

export type RuntimeEvent = 'app-start' | 'app-stop' | 'process-start' | 'process-exit' | 'process-error' | 'process-stop' | 'child-gone' | 'renderer-gone' | 'turn-submit' | 'turn-accepted' | 'completed' | 'continuation-started' | 'connection-closed' | 'tool' | 'subagent' | 'approval' | 'request' | 'request-resolved' | 'approval-resolved' | 'turn-interrupt'

/** Small local flight recorder: bounded files, rate, deduplication and memory; no console output. */
export class RuntimeDiagnostics {
  private readonly run = randomUUID()
  private windowStart: number
  private readonly repeated = new Map<string, { count: number; lastAt: number }>()
  private dropped = 0
  private disabled = false
  constructor(private readonly directory: string, private readonly now = Date.now, private readonly fileBytes = FILE_BYTES) {
    this.windowStart = now()
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); this.prune() } catch { this.disabled = true }
  }
  private path(index: number): string { return join(this.directory, `runtime.${index}.jsonl`) }
  record(event: RuntimeEvent, detail: RuntimeDetail = {}): void {
    if (this.disabled) return
    if (this.now() - this.windowStart >= WINDOW_MS) this.flush()
    const fields = safeDetail(detail), key = JSON.stringify([event, fields])
    const prior = this.repeated.get(key)
    if (prior) { prior.count++; prior.lastAt = this.now(); return }
    if (this.repeated.size >= 120) { this.dropped++; return }
    this.repeated.set(key, { count: 1, lastAt: this.now() })
    this.write({ at: this.now(), run: this.run, event, ...fields })
  }
  flush(): void {
    for (const [key, item] of this.repeated) if (item.count > 1) {
      const [event, fields] = JSON.parse(key)
      this.write({ at: this.now(), run: this.run, event, ...fields, repeats: item.count - 1, lastAt: item.lastAt })
    }
    if (this.dropped) this.write({ at: this.now(), run: this.run, event: 'rate-limited', count: this.dropped })
    this.repeated.clear(); this.dropped = 0; this.windowStart = this.now()
    try { this.prune() } catch { this.disabled = true }
  }
  private prune(): void {
    for (let i = 0; i < 3; i++) if (existsSync(this.path(i))) {
      const stat = statSync(this.path(i))
      if (stat.size > this.fileBytes || this.now() - stat.mtimeMs > RETENTION_MS) { rmSync(this.path(i)); continue }
      // Active files can span more than seven days even when their mtime is recent.
      const original = readFileSync(this.path(i), 'utf8')
      const retained = original.split('\n').filter(line => {
        try { return Number(JSON.parse(line).at) >= this.now() - RETENTION_MS } catch { return false }
      }).join('\n')
      if (!retained) rmSync(this.path(i))
      else if (retained + '\n' !== original) writeFileSync(this.path(i), retained + '\n', { mode: 0o600 })
    }
  }
  private write(value: object): void {
    if (this.disabled) return
    try {
      const line = JSON.stringify(value) + '\n'
      if ((existsSync(this.path(0)) ? statSync(this.path(0)).size : 0) + Buffer.byteLength(line) > this.fileBytes) {
        rmSync(this.path(2), { force: true })
        if (existsSync(this.path(1))) renameSync(this.path(1), this.path(2))
        if (existsSync(this.path(0))) renameSync(this.path(0), this.path(1))
      }
      appendFileSync(this.path(0), line, { mode: 0o600 })
    } catch { this.disabled = true } // ENOSPC must never cause a logging loop or fail agent work.
  }
  export(): string {
    this.flush()
    try {
      return [2, 1, 0].filter(i => existsSync(this.path(i))).map(i => readFileSync(this.path(i), 'utf8')).join('') || '(no runtime events)'
    } catch { return '(runtime diagnostics unavailable)' }
  }
  get available(): boolean { return !this.disabled }
}

let recorder: RuntimeDiagnostics | undefined
let timer: ReturnType<typeof setInterval> | undefined
export function startRuntimeDiagnostics(directory: string, version?: string): void {
  if (recorder) return
  recorder = new RuntimeDiagnostics(directory)
  recorder.record('app-start', { pid: process.pid, parentPid: process.ppid, version })
  timer = setInterval(() => recorder?.flush(), WINDOW_MS); timer.unref()
}
export function recordRuntime(event: RuntimeEvent, detail: RuntimeDetail = {}): void { recorder?.record(event, detail) }
export function exportRuntimeDiagnostics(): string { return recorder?.export() ?? '(runtime diagnostics unavailable)' }
export function runtimeDiagnosticsAvailable(): boolean { return recorder?.available ?? false }
export function stopRuntimeDiagnostics(): void { clearInterval(timer); recorder?.record('app-stop'); recorder?.flush() }
