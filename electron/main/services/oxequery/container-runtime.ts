import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { ExecutionHost } from '../../runtime/execution-host'
import type {
  ConnectionSuggestion, ContainerAction, ContainerEngine, ContainerEngineInfo, ContainerExecResult, ContainerInspect, ContainerSummary, OxeQueryEvent
} from '../../../../shared/types/oxequery'
import { parseContainerList, parseInspect, suggestFromInspect } from './container-parse'

const ENGINES: ContainerEngine[] = ['docker', 'podman']
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const ACTIONS = new Set<ContainerAction>(['start', 'stop', 'restart', 'pause', 'unpause'])
const LOG_FLUSH_MS = 100
const LOG_MAX_LINES_PER_FLUSH = 500
const LOG_MAX_LINE = 4000
const LOG_MAX_STREAMS = 4

export class ContainerRuntimeError extends Error {
  constructor(readonly code: 'engine-missing' | 'daemon' | 'not-found' | 'invalid' | 'failed', message: string) { super(message) }
}

export function assertContainerId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new ContainerRuntimeError('invalid', 'Invalid container identifier')
  return value
}

export function assertExecArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new ContainerRuntimeError('invalid', 'A command needs 1 to 64 arguments')
  return value.map(item => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 4096 || item.includes('\0')) throw new ContainerRuntimeError('invalid', 'Invalid command argument')
    return item
  })
}

/** Turns CLI stderr into something a person can act on. */
export function explainEngineError(engine: ContainerEngine, stderr: string): ContainerRuntimeError {
  const message = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 400)
  if (/cannot connect to the docker daemon|error during connect|docker daemon is not running|is the docker daemon running|dockerDesktopLinuxEngine|connection refused|no such host/i.test(message)) {
    return new ContainerRuntimeError('daemon', `${engine} is installed but its daemon is not reachable. Start ${engine === 'docker' ? 'Docker Desktop or the Docker service' : 'the Podman machine'} and try again.`)
  }
  if (/permission denied/i.test(message)) return new ContainerRuntimeError('daemon', `Permission denied talking to ${engine}. Add your user to the docker group or fix the socket permissions.`)
  if (/no such (container|object)|not found/i.test(message)) return new ContainerRuntimeError('not-found', 'That container no longer exists.')
  return new ContainerRuntimeError('failed', message || `${engine} failed`)
}

interface LogStream { child: ChildProcessWithoutNullStreams; timer: ReturnType<typeof setInterval>; buffer: string[]; pending: string }

export type SpawnProcess = (command: string, args: string[]) => ChildProcessWithoutNullStreams

export interface ContainerRuntimeOptions {
  host: ExecutionHost
  emit: (event: OxeQueryEvent) => void
  spawnProcess?: SpawnProcess
  preferred?: () => ContainerEngine | undefined
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

/** Known CLI locations by platform; only used when the bare command is not on PATH. */
export function engineInstallPaths(engine: ContainerEngine, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const exe = platform === 'win32' ? '.exe' : ''
  if (platform === 'win32') {
    const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter((value): value is string => Boolean(value))
    const local = env.LOCALAPPDATA
    return engine === 'docker'
      ? programFiles.map(base => `${base}\Docker\Docker\resources\bin\docker${exe}`)
      : [...programFiles.map(base => `${base}\RedHat\Podman\podman${exe}`), ...programFiles.map(base => `${base}\Podman\podman${exe}`), ...(local ? [`${local}\Programs\Podman\podman${exe}`] : [])]
  }
  if (platform === 'darwin') {
    return engine === 'docker'
      ? ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker']
      : ['/opt/homebrew/bin/podman', '/usr/local/bin/podman', '/opt/podman/bin/podman']
  }
  return engine === 'docker' ? ['/usr/bin/docker', '/usr/local/bin/docker', '/snap/bin/docker'] : ['/usr/bin/podman', '/usr/local/bin/podman']
}

/**
 * The container side of OxeQuery. It drives the `docker`/`podman` CLI with an
 * argv array (never a shell string) and a fixed set of subcommands, so a hostile
 * container name cannot become a different command.
 */
export class ContainerRuntime {
  private readonly streams = new Map<string, LogStream>()
  private readonly spawnProcess: SpawnProcess
  private cache: ContainerEngineInfo[] | null = null

  constructor(private readonly options: ContainerRuntimeOptions) {
    this.spawnProcess = options.spawnProcess ?? ((command, args) => spawn(command, args, { shell: false, windowsHide: true, stdio: 'pipe' }))
  }

  /** The executable that answered for each engine: the bare name when PATH has it, else a known install path. */
  private readonly binaries = new Map<ContainerEngine, string>()
  private cachedAt = 0

  private run(engine: ContainerEngine, args: string[], timeoutMs = 20_000, maxOutputBytes = 2 * 1024 * 1024) {
    return this.options.host.exec(this.binaries.get(engine) ?? engine, args, { cwd: tmpdir(), timeoutMs, maxOutputBytes })
  }

  /** PATH first, then the places each platform installs the CLI. GUI launches often have a trimmed PATH. */
  private async locate(engine: ContainerEngine): Promise<{ binary: string; version: string; stderr: string } | null> {
    const platform = this.options.platform ?? process.platform
    for (const candidate of [engine, ...engineInstallPaths(engine, platform, this.options.env ?? process.env)]) {
      const result = await this.options.host.exec(candidate, ['version', '--format', '{{.Client.Version}}'], { cwd: tmpdir(), timeoutMs: 8000, maxOutputBytes: 64 * 1024 })
      // Exit 1 with a client version still means "installed, daemon down".
      if (result.code !== -1 || result.stdout.trim()) return { binary: candidate, version: result.stdout.trim(), stderr: result.stderr }
    }
    return null
  }

  /**
   * Engines are re-checked often enough that starting Docker Desktop is noticed
   * without restarting the app: a healthy answer is cached for 10 s, a failing one
   * for 1 s.
   */
  async engines(refresh = false): Promise<ContainerEngineInfo[]> {
    const healthy = this.cache?.some(info => info.available) ?? false
    if (this.cache && !refresh && Date.now() - this.cachedAt < (healthy ? 10_000 : 1_000)) return this.cache
    this.cache = await Promise.all(ENGINES.map(async (engine): Promise<ContainerEngineInfo> => {
      const found = await this.locate(engine)
      if (!found) {
        this.binaries.delete(engine)
        return { engine, available: false, state: 'missing', error: `${engine} was not found. Install ${engine === 'docker' ? 'Docker Desktop or Docker Engine' : 'Podman'} to see containers.` }
      }
      this.binaries.set(engine, found.binary)
      const server = await this.run(engine, ['info', '--format', '{{.ServerVersion}}'], 8000)
      const context = engine === 'docker' ? (await this.run(engine, ['context', 'show'], 4000)).stdout.trim() : ''
      if (server.code !== 0) {
        const error = explainEngineError(engine, server.stderr || found.stderr)
        return { engine, available: false, state: error.code === 'daemon' && /permission/i.test(error.message) ? 'denied' : 'stopped', binary: found.binary,
          ...(found.version ? { version: found.version } : {}), ...(context ? { context } : {}), error: error.message }
      }
      return { engine, available: true, state: 'ready', binary: found.binary, version: server.stdout.trim() || found.version, ...(context ? { context } : {}) }
    }))
    this.cachedAt = Date.now()
    return this.cache
  }

  async resolve(requested?: ContainerEngine): Promise<ContainerEngine> {
    if (requested) {
      if (!ENGINES.includes(requested)) throw new ContainerRuntimeError('invalid', 'Unknown container engine')
      return requested
    }
    const infos = await this.engines()
    const preferred = this.options.preferred?.()
    const usable = infos.filter(info => info.available)
    const pick = usable.find(info => info.engine === preferred) ?? usable[0]
    if (pick) return pick.engine
    const blocked = infos.find(info => info.state === 'stopped' || info.state === 'denied')
    if (blocked) throw new ContainerRuntimeError('daemon', blocked.error ?? `${blocked.engine} is installed but not running.`)
    throw new ContainerRuntimeError('engine-missing', 'Docker or Podman was not found. Install Docker Desktop, Docker Engine or Podman to see containers.')
  }

  async list(engine?: ContainerEngine): Promise<{ engine: ContainerEngine; containers: ContainerSummary[] }> {
    const resolved = await this.resolve(engine)
    const result = await this.run(resolved, ['ps', '--all', '--no-trunc', '--format', resolved === 'podman' ? 'json' : '{{json .}}'])
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    return { engine: resolved, containers: parseContainerList(result.stdout) }
  }

  private async inspectRaw(engine: ContainerEngine, id: string): Promise<string> {
    const result = await this.run(engine, ['inspect', '--type', 'container', assertContainerId(id)])
    if (result.code !== 0) throw explainEngineError(engine, result.stderr)
    return result.stdout
  }

  async inspect(id: string, engine?: ContainerEngine): Promise<ContainerInspect> {
    const resolved = await this.resolve(engine)
    const parsed = parseInspect(await this.inspectRaw(resolved, id))
    if (!parsed) throw new ContainerRuntimeError('failed', 'The engine returned an unreadable description of this container.')
    return parsed
  }

  /** Main-process only: the result may carry a password. */
  async suggestConnection(id: string, engine?: ContainerEngine): Promise<{ suggestion: ConnectionSuggestion; password?: string } | null> {
    const resolved = await this.resolve(engine)
    return suggestFromInspect(await this.inspectRaw(resolved, id))
  }

  async action(id: string, action: ContainerAction, engine?: ContainerEngine): Promise<void> {
    if (!ACTIONS.has(action)) throw new ContainerRuntimeError('invalid', 'Unsupported container action')
    const resolved = await this.resolve(engine)
    const result = await this.run(resolved, [action, assertContainerId(id)], 60_000)
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    this.options.emit({ type: 'containers-changed' })
  }

  async exec(id: string, argv: string[], timeoutMs = 30_000, engine?: ContainerEngine): Promise<ContainerExecResult> {
    const resolved = await this.resolve(engine)
    const maxOutput = 256 * 1024
    const result = await this.run(resolved, ['exec', assertContainerId(id), ...assertExecArgv(argv)], Math.min(Math.max(timeoutMs, 1000), 120_000), maxOutput)
    if (result.code === -1 && !result.stdout && !result.timedOut) throw explainEngineError(resolved, result.stderr)
    return {
      exitCode: result.timedOut ? null : result.code,
      stdout: result.stdout, stderr: result.stderr,
      truncated: result.stdout.length >= maxOutput || result.stderr.length >= maxOutput,
      timedOut: result.timedOut
    }
  }

  /** Executable and argv for an interactive shell; the PTY itself belongs to the terminal service. */
  async shellCommand(id: string, shell: 'sh' | 'bash' = 'sh', engine?: ContainerEngine): Promise<{ file: string; args: string[]; engine: ContainerEngine }> {
    const resolved = await this.resolve(engine)
    if (shell !== 'sh' && shell !== 'bash') throw new ContainerRuntimeError('invalid', 'Unsupported shell')
    return { file: this.binaries.get(resolved) ?? resolved, args: ['exec', '-it', assertContainerId(id), shell], engine: resolved }
  }

  /** The last lines of a container's log, once (for an agent); streaming is `logsStart`. */
  async logsTail(id: string, tail = 100, engine?: ContainerEngine): Promise<string> {
    const resolved = await this.resolve(engine)
    const lines = Math.max(1, Math.min(Math.trunc(tail), 500))
    const result = await this.run(resolved, ['logs', '--timestamps', '--tail', String(lines), assertContainerId(id)], 15_000, 256 * 1024)
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    // `docker logs` sends the container's stderr to its own stderr.
    return `${result.stdout}${result.stdout && result.stderr ? '\n' : ''}${result.stderr}`
  }

  async logsStart(id: string, tail = 200, engine?: ContainerEngine): Promise<string> {
    if (this.streams.size >= LOG_MAX_STREAMS) throw new ContainerRuntimeError('failed', 'Too many log streams are open. Close one first.')
    const resolved = await this.resolve(engine)
    const streamId = randomUUID()
    const lines = Math.max(0, Math.min(Math.trunc(tail), 5000))
    const child = this.spawnProcess(this.binaries.get(resolved) ?? resolved, ['logs', '--follow', '--timestamps', '--tail', String(lines), assertContainerId(id)])
    const stream: LogStream = { child, buffer: [], pending: '', timer: setInterval(() => this.flush(streamId), LOG_FLUSH_MS) }
    this.streams.set(streamId, stream)
    const feed = (chunk: Buffer): void => {
      stream.pending += chunk.toString('utf8')
      const parts = stream.pending.split(/\r?\n/)
      stream.pending = parts.pop() ?? ''
      for (const line of parts) if (stream.buffer.length < LOG_MAX_LINES_PER_FLUSH * 4) stream.buffer.push(line.slice(0, LOG_MAX_LINE))
    }
    // `docker logs` writes the container's stderr to its own stderr; both are log output.
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', error => this.end(streamId, error.message))
    child.on('close', code => this.end(streamId, code === 0 || code === null ? 'closed' : `The engine exited with code ${code}`))
    return streamId
  }

  private flush(streamId: string): void {
    const stream = this.streams.get(streamId)
    if (!stream || stream.buffer.length === 0) return
    const lines = stream.buffer.splice(0, LOG_MAX_LINES_PER_FLUSH)
    this.options.emit({ type: 'container-log', streamId, lines })
  }

  private end(streamId: string, reason: string): void {
    const stream = this.streams.get(streamId)
    if (!stream) return
    if (stream.pending) stream.buffer.push(stream.pending.slice(0, LOG_MAX_LINE))
    stream.pending = ''
    this.flush(streamId)
    clearInterval(stream.timer)
    this.streams.delete(streamId)
    this.options.emit({ type: 'container-log-end', streamId, reason })
  }

  logsStop(streamId: string): void {
    const stream = this.streams.get(streamId)
    if (!stream) return
    try { stream.child.kill() } catch { /* already gone */ }
    this.end(streamId, 'stopped')
  }

  dispose(): void {
    for (const streamId of [...this.streams.keys()]) this.logsStop(streamId)
  }
}
