import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import type { ExecutionHost } from '../../runtime/execution-host'
import type {
  ConnectionSuggestion, ContainerAction, ContainerEngine, ContainerEngineCandidate, ContainerEngineInfo, ContainerExecResult, ContainerInspect, ContainerStat, ContainerSummary, DiskUsageRow, ImageInfo, NetworkInfo,
  OxeQueryEvent, ResourceKind, VolumeInfo
} from '../../../../shared/types/oxequery'
import { classifyProbe, isLocalEndpoint, parseContainerList, parseContexts, parseDiskUsage, parseImages, parseInspect, parseNetworks, parseStats, parseVolumes, suggestFromInspect } from './container-parse'
import { createServer } from 'node:net'
import { stat } from 'node:fs/promises'
import { composeArgs, composeTarget, type ComposeAction } from './compose'
import { randomBytes } from 'node:crypto'

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
    // Joined with an explicit separator: backslashes inside a template literal are escapes
    // (`\r` and `\b` would silently become control characters).
    const win = (...parts: string[]): string => parts.join('\\')
    return engine === 'docker'
      ? programFiles.map(base => win(base, 'Docker', 'Docker', 'resources', 'bin', `docker${exe}`))
      : [...programFiles.map(base => win(base, 'RedHat', 'Podman', `podman${exe}`)), ...programFiles.map(base => win(base, 'Podman', `podman${exe}`)), ...(local ? [win(local, 'Programs', 'Podman', `podman${exe}`)] : [])]
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

  /** The daemon a person picked when the default one is not where their containers are. */
  private selection: { id: string; args: string[] } | null = null

  /** Global flags that point the Docker CLI at the chosen daemon (never set for Podman). */
  private target(engine: ContainerEngine): string[] {
    return engine === 'docker' && this.selection ? this.selection.args : []
  }

  private runRaw(engine: ContainerEngine, args: string[], timeoutMs = 20_000, maxOutputBytes = 2 * 1024 * 1024, env?: Record<string, string>) {
    return this.options.host.exec(this.binaries.get(engine) ?? engine, args, { cwd: tmpdir(), timeoutMs, maxOutputBytes, ...(env ? { env } : {}) })
  }

  private run(engine: ContainerEngine, args: string[], timeoutMs = 20_000, maxOutputBytes = 2 * 1024 * 1024, env?: Record<string, string>) {
    return this.runRaw(engine, [...this.target(engine), ...args], timeoutMs, maxOutputBytes, env)
  }

  /**
   * The Docker daemons this computer can reach and whether this user may use them. A machine can
   * have Docker Desktop (an empty daemon) and the system engine (where the containers are, behind
   * the `docker` group): without this, the first one is all that is ever shown. Remote contexts
   * are listed but never contacted.
   */
  async candidates(): Promise<ContainerEngineCandidate[]> {
    await this.engines()
    if (!this.binaries.has('docker')) return []
    const listed = await this.runRaw('docker', ['context', 'ls', '--format', '{{json .}}'], 6000)
    const contexts = listed.code === 0 ? parseContexts(listed.stdout).slice(0, 12) : []
    const platform = this.options.platform ?? process.platform
    const systemSocket = 'unix:///var/run/docker.sock'
    const entries: { id: string; label: string; endpoint: string; current: boolean; args: string[] }[] = contexts.map(context => ({
      id: `context:${context.name}`, label: context.name, endpoint: context.endpoint, current: context.current, args: ['--context', context.name]
    }))
    if (platform === 'linux' && !entries.some(entry => entry.endpoint === systemSocket)) {
      entries.push({ id: 'socket:system', label: 'System Docker engine', endpoint: systemSocket, current: false, args: ['-H', systemSocket] })
    }
    const chosen = this.selection?.id ?? entries.find(entry => entry.current)?.id
    return Promise.all(entries.map(async (entry): Promise<ContainerEngineCandidate> => {
      const base = { id: entry.id, label: entry.label, endpoint: entry.endpoint, current: entry.current, selected: entry.id === chosen }
      if (!isLocalEndpoint(entry.endpoint)) return { ...base, state: 'not-checked' }
      const probe = await this.runRaw('docker', [...entry.args, 'ps', '--all', '--quiet'], 6000, 256 * 1024)
      const state = classifyProbe(probe.code, probe.stderr)
      return { ...base, state, ...(state === 'ready' ? { containers: probe.stdout.split(/\r?\n/).filter(Boolean).length } : {}) }
    }))
  }

  /** `null` goes back to the Docker CLI's own default. Only an id from `candidates()` is accepted. */
  async useCandidate(id: string | null): Promise<ContainerEngineCandidate[]> {
    if (id === null) this.selection = null
    else {
      const known = await this.candidates()
      const pick = known.find(entry => entry.id === id)
      if (!pick) throw new ContainerRuntimeError('invalid', 'That Docker engine is not available on this computer.')
      if (pick.state === 'not-checked') throw new ContainerRuntimeError('invalid', 'Remote Docker contexts are not used by OxeQuery.')
      this.selection = { id, args: id === 'socket:system' ? ['-H', 'unix:///var/run/docker.sock'] : ['--context', id.slice('context:'.length)] }
    }
    this.cache = null
    this.options.emit({ type: 'containers-changed' })
    return this.candidates()
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
    return { file: this.binaries.get(resolved) ?? resolved, args: [...this.target(resolved), 'exec', '-it', assertContainerId(id), shell], engine: resolved }
  }

  /** CPU and memory of the running containers, once. */
  async stats(engine?: ContainerEngine): Promise<ContainerStat[]> {
    const resolved = await this.resolve(engine)
    const result = await this.run(resolved, ['stats', '--no-stream', '--format', resolved === 'podman' ? 'json' : '{{json .}}'], 25_000)
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    return parseStats(result.stdout)
  }

  private async listing<T>(engine: ContainerEngine | undefined, args: string[], parse: (stdout: string) => T[]): Promise<T[]> {
    const resolved = await this.resolve(engine)
    const result = await this.run(resolved, [...args, '--format', '{{json .}}'])
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    return parse(result.stdout)
  }

  images(engine?: ContainerEngine): Promise<ImageInfo[]> { return this.listing(engine, ['images'], parseImages) }
  volumes(engine?: ContainerEngine): Promise<VolumeInfo[]> { return this.listing(engine, ['volume', 'ls'], parseVolumes) }
  networks(engine?: ContainerEngine): Promise<NetworkInfo[]> { return this.listing(engine, ['network', 'ls'], parseNetworks) }
  usage(engine?: ContainerEngine): Promise<DiskUsageRow[]> { return this.listing(engine, ['system', 'df'], parseDiskUsage) }

  /** Removes one unused image, volume or network. The engine itself refuses one that is in use. */
  async removeResource(kind: ResourceKind, id: string, engine?: ContainerEngine): Promise<void> {
    const resolved = await this.resolve(engine)
    const target = assertContainerId(id)
    const args = kind === 'image' ? ['image', 'rm', target] : kind === 'volume' ? ['volume', 'rm', target] : ['network', 'rm', target]
    if (kind !== 'image' && kind !== 'volume' && kind !== 'network') throw new ContainerRuntimeError('invalid', 'Unsupported resource kind')
    const result = await this.run(resolved, args, 60_000)
    if (result.code !== 0) throw explainEngineError(resolved, result.stderr)
    this.options.emit({ type: 'containers-changed' })
  }

  /**
   * Starts a PostgreSQL or MongoDB container bound to 127.0.0.1 on a free port, with a
   * named data volume and a generated password. The password goes to the engine
   * through the child's environment, not its command line.
   */
  async createDatabase(input: { engine: 'postgres' | 'mongodb'; name: string; tag: string; port?: number }, engine?: ContainerEngine): Promise<{ containerId: string; port: number; password: string; username: string; database: string }> {
    const name = input.name
    if (!/^[a-z0-9][a-z0-9_.-]{1,40}$/.test(name)) throw new ContainerRuntimeError('invalid', 'Use 2–41 lowercase letters, digits, "-", "_" or "." for the name.')
    if (!/^(latest|[0-9]{1,2}(\.[0-9]{1,2}){0,2}(-[a-z]{3,12})?)$/.test(input.tag)) throw new ContainerRuntimeError('invalid', 'That image tag is not accepted. Use a version such as 17 or 16-alpine.')
    const resolved = await this.resolve(engine)
    const inner = input.engine === 'postgres' ? 5432 : 27017
    const port = input.port ?? await freePort(inner)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new ContainerRuntimeError('invalid', 'Choose a port between 1024 and 65535.')
    const password = randomBytes(18).toString('base64url')
    const image = input.engine === 'postgres' ? `postgres:${input.tag}` : `mongo:${input.tag}`
    const volume = `${name}-data`
    const args = input.engine === 'postgres'
      ? ['run', '-d', '--name', name, '--label', 'oxequery.managed=1', '-p', `127.0.0.1:${port}:5432`, '-v', `${volume}:/var/lib/postgresql/data`, '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=app', image]
      : ['run', '-d', '--name', name, '--label', 'oxequery.managed=1', '-p', `127.0.0.1:${port}:27017`, '-v', `${volume}:/data/db`, '-e', 'MONGO_INITDB_ROOT_USERNAME=root', '-e', 'MONGO_INITDB_ROOT_PASSWORD', image]
    const result = await this.run(resolved, args, 300_000, 64 * 1024, { [input.engine === 'postgres' ? 'POSTGRES_PASSWORD' : 'MONGO_INITDB_ROOT_PASSWORD']: password })
    if (result.code !== 0) {
      if (/already in use|Conflict/i.test(result.stderr)) throw new ContainerRuntimeError('invalid', `A container named "${name}" already exists.`)
      if (/port is already allocated|address already in use/i.test(result.stderr)) throw new ContainerRuntimeError('invalid', `Port ${port} is already in use. Choose another.`)
      throw explainEngineError(resolved, result.stderr)
    }
    this.options.emit({ type: 'containers-changed' })
    return { containerId: result.stdout.trim().slice(0, 64), port, password, username: input.engine === 'postgres' ? 'postgres' : 'root', database: input.engine === 'postgres' ? 'app' : 'admin' }
  }

  /** The last lines of a container's log, once (for an agent); streaming is `logsStart`. */
  /**
   * Up, down, start, stop, restart or logs for the Compose project a container belongs to. The folder
   * and files are read from that container's own labels, so what runs is the project the engine
   * started, in the folder it started from; nothing about the path comes from the page.
   */
  async compose(id: string, action: ComposeAction, options: { tail?: number } = {}, engine?: ContainerEngine): Promise<{ output: string }> {
    const resolved = await this.resolve(engine)
    const target = composeTarget(await this.inspectRaw(resolved, id))
    if (!target) throw new ContainerRuntimeError('invalid', 'This container does not belong to a Compose project the engine can describe (it needs the project folder label).')
    const folder = await stat(target.directory).catch(() => null)
    if (!folder?.isDirectory()) throw new ContainerRuntimeError('failed', `The project folder ${target.directory} is not on this computer (or was moved). Run compose where the project lives.`)
    for (const file of target.files) if (!(await stat(file).catch(() => null))?.isFile()) throw new ContainerRuntimeError('failed', `The compose file ${file} no longer exists.`)
    const result = await this.options.host.exec(this.binaries.get(resolved) ?? resolved, [...this.target(resolved), ...composeArgs(target, action, options.tail)], {
      cwd: target.directory, timeoutMs: action === 'logs' ? 30_000 : 300_000, maxOutputBytes: 512 * 1024
    })
    if (result.timedOut) throw new ContainerRuntimeError('failed', `Compose ${action} took too long and was stopped. It may still be finishing in the engine.`)
    const output = `${result.stdout}${result.stdout && result.stderr ? '\n' : ''}${result.stderr}`.trim()
    if (result.code !== 0) throw new ContainerRuntimeError('failed', output.slice(-600) || `Compose ${action} failed (exit code ${result.code}). Is the compose plugin installed?`)
    if (action !== 'logs') this.options.emit({ type: 'containers-changed' })
    return { output }
  }

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
    const child = this.spawnProcess(this.binaries.get(resolved) ?? resolved, [...this.target(resolved), 'logs', '--follow', '--timestamps', '--tail', String(lines), assertContainerId(id)])
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

/** The preferred port when nothing listens on it, otherwise any free one. */
function freePort(preferred: number): Promise<number> {
  const attempt = (port: number): Promise<number> => new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { const { port: bound } = server.address() as { port: number }; server.close(() => resolve(bound)) })
  })
  return attempt(preferred).catch(() => attempt(0))
}
