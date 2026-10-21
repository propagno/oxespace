import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AppDatabase } from '../db/index'
import type {
  CreateMcpServerInput,
  McpCallToolInput,
  McpCallToolResult,
  McpHealthStatus,
  McpHttpConfig,
  McpServer,
  McpServerConfig,
  McpServerHealthEvent,
  McpStdioConfig,
  McpToolDescriptor,
  McpTransport,
  UpdateMcpServerInput
} from '../../../shared/types/mcp'
import { McpConfigSync } from './mcp-sync.service'
import { unbridgeRemoteMcpServers, upgradeRetiredMcpEndpoints } from './mcp-retired-endpoints'
import { probeHttpServer } from './mcp-http-probe'

interface McpServerRow {
  id: string
  workspace_id: string | null
  name: string
  transport: McpTransport
  config_json: string
  enabled: number
  trusted: number
  created_at: number
  updated_at: number
}

interface RuntimeServer {
  server: McpServer
  process: ChildProcessWithoutNullStreams | null
  buffer: string
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>
  requestSeq: number
  initialized: boolean
  /** Browser sign-in page announced by an OAuth bridge such as mcp-remote. */
  authUrl?: string
  browserOpened?: boolean
  // Ring of last stderr lines. When the server dies before responding to
  // `initialize`, this is the only honest signal about WHY it died — npm
  // packages like @modelcontextprotocol/server-github abort with "X env var
  // required" on stderr and exit with code null on Windows (the wrapper
  // shell loses the original code). Surfacing it in healthMessage gives
  // the user something actionable instead of "exited (null)".
  stderr: string[]
  lastActivity: number
  sleepTimer?: NodeJS.Timeout
}

/** The outcome of the last test, kept for this run of the app only. */
interface TestResult { health: McpHealthStatus; message: string | null; tools: McpToolDescriptor[]; at: number }

const STDERR_RING_SIZE = 10
const STDERR_LINE_MAX = 240

interface McpManagerOptions {
  emitHealth?: (event: McpServerHealthEvent) => void
}

const PROTOCOL_VERSION = '2025-06-18'
const INIT_TIMEOUT_MS = 15_000
/** Remote servers (mcp-remote) wait for a person to sign in; that takes minutes, not seconds. */
const AUTH_INIT_TIMEOUT_MS = 5 * 60_000
const SIGN_IN_FALLBACK_MS = 4_000
const REQUEST_TIMEOUT_MS = 30_000
const SLEEP_TIMEOUT_MS = 15 * 60 * 1000
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.ps1']
// Anti-OOM guard for the line-delimited stdout buffer: a misbehaving server that
// streams a huge blob without a newline would otherwise grow `runtime.buffer`
// unbounded. If an incomplete line passes this, we drop it and resync on the
// next newline rather than accumulate forever.
const MAX_STDOUT_BUFFER_BYTES = 5 * 1024 * 1024

/**
 * MCP (Model Context Protocol) cliente — speaks JSON-RPC 2.0 over child-process stdio.
 *
 * Currently supports the `stdio` transport only — HTTP/SSE require a streaming HTTP client
 * which is heavier. They're declared in the type system but `start()` throws for them.
 * Servers persist in `mcp_servers` table; tools are cached per-runtime after a successful
 * handshake (initialize → notifications/initialized → tools/list).
 */
export class McpManager {
  private readonly runtimes = new Map<string, RuntimeServer>()
  /** Starts in flight, so a second click joins the first instead of killing a sign-in half way. */
  private readonly starting = new Map<string, Promise<McpToolDescriptor[]>>()
  private readonly tested = new Map<string, TestResult>()
  private readonly emitHealth: (event: McpServerHealthEvent) => void
  private readonly configSync: McpConfigSync

  constructor(private readonly db: AppDatabase, options: McpManagerOptions = {}) {
    this.emitHealth = options.emitHealth ?? (() => undefined)
    this.configSync = new McpConfigSync(db)
    // NOTE: the initial .mcp.json sync is deferred — see primeConfigs(), called
    // from the deferred startup hook after the window paints. syncAll() does
    // N workspaces × (DB reads + sync file writes), which previously blocked
    // first paint when run here in the constructor.
  }

  /**
   * Refresh every workspace's .mcp.json so the file stays in sync when the user
   * has been editing MCPs across sessions (it may be stale if hand-edited or
   * written by an older OXESpace). Idempotent and non-fatal — safe to call once
   * after boot. Must run BEFORE the internal MCP server's start() so start()'s
   * live-port rewrite of its own row lands last.
   */
  primeConfigs(): void {
    try {
      // Before the sync, so the rewritten .mcp.json files already carry the current endpoints.
      upgradeRetiredMcpEndpoints(this.db)
      unbridgeRemoteMcpServers(this.db)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mcp] could not update retired endpoints:', err instanceof Error ? err.message : err)
    }
    try {
      this.configSync.syncAll()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mcp] initial .mcp.json sync failed:', err instanceof Error ? err.message : err)
    }
  }

  /** Re-materializes `.mcp.json` for the workspace (or all workspaces if global). */
  private syncFile(workspaceId: string | null): void {
    try {
      this.configSync.syncForServer(workspaceId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[mcp] failed to sync .mcp.json:', err instanceof Error ? err.message : err)
    }
  }

  list(workspaceId: string | null): McpServer[] {
    // Returns global servers (workspace_id null) plus this workspace's own.
    const rows = this.db
      .prepare(
        `SELECT * FROM mcp_servers
         WHERE workspace_id IS NULL OR workspace_id = ?
         ORDER BY workspace_id IS NULL DESC, name ASC`
      )
      .all(workspaceId) as McpServerRow[]
    return rows.map((row) => this.hydrateServer(mapRow(row)))
  }

  get(id: string): McpServer | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow | undefined
    return row ? this.hydrateServer(mapRow(row)) : null
  }

  create(input: CreateMcpServerInput): McpServer {
    const id = randomUUID()
    const now = Date.now()
    validateConfig(input.transport, input.config, input.trusted === true)
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.workspaceId, input.name.trim(), input.transport, JSON.stringify(input.config), input.enabled === false ? 0 : 1, input.trusted === true ? 1 : 0, now, now)
    this.syncFile(input.workspaceId)
    return this.get(id)!
  }

  update(input: UpdateMcpServerInput): McpServer {
    const current = this.get(input.id)
    if (!current) throw new Error(`MCP server ${input.id} not found`)
    const transport = input.transport ?? current.transport
    const config = input.config ?? current.config
    validateConfig(transport, config, input.trusted ?? current.trusted)
    this.db
      .prepare(
        `UPDATE mcp_servers
         SET name = COALESCE(?, name),
             transport = ?,
             config_json = ?,
             enabled = COALESCE(?, enabled),
             trusted = COALESCE(?, trusted),
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name?.trim() ?? null,
        transport,
        JSON.stringify(config),
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        input.trusted === undefined ? null : input.trusted ? 1 : 0,
        Date.now(),
        input.id
      )
    // If runtime is running, restart so changes take effect
    this.stopRuntime(input.id)
    this.tested.delete(input.id)
    this.syncFile(current.workspaceId)
    return this.get(input.id)!
  }

  delete(id: string): void {
    const current = this.get(id)
    this.stopRuntime(id)
    this.tested.delete(id)
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    if (current) this.syncFile(current.workspaceId)
  }

  /** Starts (or restarts) a server and runs its handshake. Returns the live tools list. */
  async start(id: string): Promise<McpToolDescriptor[]> {
    const server = this.get(id)
    if (!server) throw new Error(`MCP server ${id} not found`)
    if (!server.trusted) throw new Error('MCP server is not trusted. Review its command/env and mark it trusted before starting.')
    if (server.transport !== 'stdio') {
      throw new Error('Only the stdio transport is supported in this version. HTTP and SSE are not available yet.')
    }
    const inFlight = this.starting.get(id)
    if (inFlight) return inFlight
    if (this.runtimes.has(id)) this.stopRuntime(id)
    const run = this.startStdio(server).finally(() => { this.starting.delete(id) })
    this.starting.set(id, run)
    return run
  }

  /**
   * Checks that a server answers and lists its tools, then lets it go. The agent
   * runs its own connection to the server; OXESpace does not keep a second copy
   * alive, so this is a check on request, not a status. Never throws: the
   * outcome is on the returned server.
   */
  async test(id: string): Promise<McpServer> {
    const server = this.get(id)
    if (!server) throw new Error(`MCP server ${id} not found`)
    const record = (health: McpHealthStatus, message: string | null, tools: McpToolDescriptor[] = []): McpServer => {
      this.tested.set(id, { health, message, tools, at: Date.now() })
      this.emitHealth({ serverId: id, status: health, message })
      return this.get(id)!
    }
    if (!server.trusted) return record('unhealthy', 'Not trusted yet. Review its command and trust it before testing.')
    if (server.transport !== 'stdio') {
      this.emitHealth({ serverId: id, status: 'starting', message: null })
      try {
        const result = await probeHttpServer(server.config as McpHttpConfig)
        if (result.status === 'needs-auth') return record('needs-auth', 'Answers and asks for a sign-in. The agent opens it on first use.')
        if (result.status === 'reachable') return record('healthy', 'Answers. Its tools show once the agent connects.')
        return record('healthy', `${result.tools.length} tool(s)`, result.tools)
      } catch (err) {
        return record('unhealthy', err instanceof Error ? err.message : String(err))
      }
    }
    try {
      const tools = await this.start(id)
      this.stopRuntime(id, true)
      return record('healthy', `${tools.length} tool(s)`, tools)
    } catch (err) {
      return record('unhealthy', err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * The Node.js version a server started through node, npx or npm would run on, with its own
   * variables and PATH; null for other commands or when no Node.js is found.
   */
  async nodeVersion(id: string): Promise<string | null> {
    const server = this.get(id)
    if (!server || server.transport !== 'stdio') return null
    const config = server.config as McpStdioConfig
    if (!/^(?:node|npx|npm|pnpm|pnpx)(?:\.(?:exe|cmd))?$/i.test(path.basename(config.command.trim()))) return null
    const env = buildProcessEnv(config.env)
    const node = resolveExecutable('node', env)
    return new Promise(resolve => {
      execFile(node, ['--version'], { env, timeout: 5000, windowsHide: true, shell: shouldUseWindowsCommandShell(node) }, (error, stdout) => {
        const version = String(stdout).trim()
        resolve(error || !/^v\d+\.\d+/.test(version) ? null : version)
      })
    })
  }

  /** Reopens the browser sign-in page of a server that is waiting for authentication. */
  openSignIn(id: string): boolean {
    const url = this.runtimes.get(id)?.authUrl
    if (!url || !/^https:\/\//i.test(url)) return false
    void shell.openExternal(url)
    return true
  }

  stopAll(): void {
    for (const id of [...this.runtimes.keys()]) this.stopRuntime(id)
  }

  private touchRuntime(runtime: RuntimeServer): void {
    runtime.lastActivity = Date.now()
    if (runtime.sleepTimer) clearTimeout(runtime.sleepTimer)
    runtime.sleepTimer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(`[mcp] hibernating server ${runtime.server.name} (${runtime.server.id}) due to inactivity`)
      this.stopRuntime(runtime.server.id)
    }, SLEEP_TIMEOUT_MS)
  }

  /** `quiet`: the caller reports the outcome itself (a finished test). */
  stopRuntime(id: string, quiet = false): void {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    if (runtime.sleepTimer) clearTimeout(runtime.sleepTimer)
    // Detach first: the exit handler of a process stopped on purpose must not report it as a crash.
    this.runtimes.delete(id)
    killProcessTree(runtime.process)
    runtime.pending.forEach(({ reject }) => reject(new Error('MCP server stopped')))
    runtime.pending.clear()
    if (!quiet) this.emitHealth({ serverId: id, status: 'unknown', message: null })
  }

  async callTool(input: McpCallToolInput): Promise<McpCallToolResult> {
    let runtime = this.runtimes.get(input.serverId)
    if (!runtime) {
      // Lazy start on demand
      await this.start(input.serverId)
      runtime = this.runtimes.get(input.serverId)
    }
    if (!runtime || !runtime.initialized) throw new Error('MCP server not initialized')
    if (!runtime.server.trusted) throw new Error('MCP server is not trusted')

    this.touchRuntime(runtime)

    const result = await this.request<McpCallToolResult>(runtime, 'tools/call', {
      name: input.toolName,
      arguments: input.arguments
    })
    return result
  }

  private async startStdio(server: McpServer): Promise<McpToolDescriptor[]> {
    if (server.transport !== 'stdio') throw new Error('Not a stdio server')
    const config = server.config as McpStdioConfig

    this.emitHealth({ serverId: server.id, status: 'starting', message: null })
    const interactiveAuth = usesOAuthBridge(config)

    const env = buildProcessEnv(config.env)
    const command = resolveExecutable(config.command, env)
    const cwd = this.resolveServerCwd(server)
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command, config.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: shouldUseWindowsCommandShell(command),
        windowsHide: true
      })
    } catch (err) {
      const message = formatSpawnError(config.command, err)
      this.emitHealth({ serverId: server.id, status: 'unhealthy', message })
      throw new Error(message)
    }

    const runtime: RuntimeServer = {
      server,
      process: child,
      buffer: '',
      pending: new Map(),
      requestSeq: 0,
      initialized: false,
      stderr: [],
      lastActivity: Date.now()
    }
    this.runtimes.set(server.id, runtime)
    this.touchRuntime(runtime)

    const spawnError = new Promise<never>((_, reject) => {
      child.once('error', (err) => {
        const message = formatSpawnError(config.command, err)
        runtime.pending.forEach(({ reject: rejectPending }) => rejectPending(new Error(message)))
        runtime.pending.clear()
        this.runtimes.delete(server.id)
        this.emitHealth({ serverId: server.id, status: 'unhealthy', message })
        reject(new Error(message))
      })
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(runtime, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      // eslint-disable-next-line no-console
      console.warn(`[mcp:${server.name}] stderr:`, chunk.toString().slice(0, 500))
      for (const rawLine of chunk.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue
        if (interactiveAuth) this.watchSignIn(runtime, line)
        runtime.stderr.push(line.slice(0, STDERR_LINE_MAX))
        if (runtime.stderr.length > STDERR_RING_SIZE) runtime.stderr.shift()
      }
    })
    child.on('exit', (code) => {
      if (this.runtimes.get(server.id) !== runtime) return
      runtime.pending.forEach(({ reject }) => reject(new Error(`MCP server exited with code ${code}`)))
      runtime.pending.clear()
      this.runtimes.delete(server.id)
      this.emitHealth({
        serverId: server.id,
        status: 'unhealthy',
        message: formatExitMessage(code, runtime.stderr)
      })
    })

    try {
      // Handshake: initialize → notifications/initialized → tools/list
      const initResult = await Promise.race([
        this.request<{ protocolVersion: string; serverInfo?: { name: string } }>(runtime, 'initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          clientInfo: { name: 'oxespace', version: '0.1.0' }
        }, interactiveAuth ? AUTH_INIT_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
        spawnError,
        timeout<{ protocolVersion: string }>(interactiveAuth ? AUTH_INIT_TIMEOUT_MS : INIT_TIMEOUT_MS, interactiveAuth ? 'sign-in was not completed in time' : 'initialize timeout')
      ])
      if (!initResult || typeof initResult.protocolVersion !== 'string') {
        throw new Error('Invalid initialize response')
      }
      this.notify(runtime, 'notifications/initialized')
      runtime.initialized = true

      const toolsResult = await this.request<{ tools: McpToolDescriptor[] }>(runtime, 'tools/list', {})
      const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : []

      // Cache tools on the runtime; not persisted to DB (refreshed on each connect).
      runtime.server = { ...runtime.server, tools, health: 'healthy', healthMessage: null }
      this.emitHealth({ serverId: server.id, status: 'healthy', message: `${tools.length} tool(s)` })
      return tools
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : String(err)
      const stderrTail = runtime.stderr.length > 0 ? ` — stderr: "${runtime.stderr.slice(-3).join(' | ')}"` : ''
      const enriched = baseMessage + stderrTail
      this.stopRuntime(server.id)
      this.emitHealth({ serverId: server.id, status: 'unhealthy', message: enriched })
      throw new Error(enriched)
    }
  }

  /**
   * mcp-remote prints the authorization URL and normally opens it itself. When it
   * does not (detached process, no default browser handler), open it from here so
   * adding a connector is one click, and keep the URL for "Open sign-in page".
   */
  private watchSignIn(runtime: RuntimeServer, line: string): void {
    if (/browser opened automatically/i.test(line)) { runtime.browserOpened = true; return }
    const url = extractSignInUrl(line)
    if (!url || runtime.authUrl === url) return
    runtime.authUrl = url
    this.emitHealth({ serverId: runtime.server.id, status: 'starting', message: 'Waiting for you to sign in in the browser…' })
    setTimeout(() => {
      if (!runtime.browserOpened && this.runtimes.get(runtime.server.id) === runtime && !runtime.initialized) void shell.openExternal(url)
    }, SIGN_IN_FALLBACK_MS)
  }

  private resolveServerCwd(server: McpServer): string | undefined {
    if (!server.workspaceId) return undefined
    const row = this.db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(server.workspaceId) as { root_path?: string } | undefined
    return typeof row?.root_path === 'string' && row.root_path.trim() ? row.root_path : undefined
  }

  private hydrateServer(server: McpServer): McpServer {
    const runtime = this.runtimes.get(server.id)
    if (runtime && runtime.initialized) {
      return { ...server, health: 'healthy', tools: runtime.server.tools }
    }
    if (runtime) {
      return { ...server, health: 'starting' }
    }
    const tested = this.tested.get(server.id)
    return tested ? { ...server, health: tested.health, healthMessage: tested.message, tools: tested.tools, testedAtMs: tested.at } : server
  }

  private request<T>(runtime: RuntimeServer, method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise((resolve, reject) => {
      runtime.requestSeq += 1
      const id = runtime.requestSeq
      runtime.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
      try {
        runtime.process?.stdin.write(message)
      } catch (err) {
        runtime.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      setTimeout(() => {
        if (runtime.pending.has(id)) {
          runtime.pending.delete(id)
          reject(new Error(`MCP request "${method}" timed out`))
        }
      }, timeoutMs)
    })
  }

  private notify(runtime: RuntimeServer, method: string): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params: {} }) + '\n'
    try { runtime.process?.stdin.write(message) } catch { /* ignore */ }
  }

  private consumeStdout(runtime: RuntimeServer, chunk: string): void {
    runtime.buffer += chunk
    let newlineIdx: number
    // MCP framing is line-delimited JSON (one message per line)
    // eslint-disable-next-line no-cond-assign
    while ((newlineIdx = runtime.buffer.indexOf('\n')) !== -1) {
      const line = runtime.buffer.slice(0, newlineIdx).trim()
      runtime.buffer = runtime.buffer.slice(newlineIdx + 1)
      if (!line) continue
      let parsed: { id?: number; result?: unknown; error?: { message?: string; code?: number } }
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed.id !== undefined && runtime.pending.has(parsed.id)) {
        const pending = runtime.pending.get(parsed.id)!
        runtime.pending.delete(parsed.id)
        if (parsed.error) {
          pending.reject(new Error(parsed.error.message ?? `MCP error (code ${parsed.error.code ?? 'unknown'})`))
        } else {
          pending.resolve(parsed.result)
        }
      }
    }
    // After draining complete lines, what remains is a single incomplete line.
    // If it has run away past the cap, drop it (resync on the next newline) so a
    // server streaming a giant unframed blob can't OOM the main process.
    if (runtime.buffer.length > MAX_STDOUT_BUFFER_BYTES) {
      // eslint-disable-next-line no-console
      console.warn(`[mcp] dropping oversized stdout buffer (${runtime.buffer.length} bytes) for server ${runtime.server.id}`)
      runtime.buffer = ''
    }
  }
}

function mapRow(row: McpServerRow): McpServer {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    transport: row.transport,
    config: JSON.parse(row.config_json) as McpServerConfig,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    health: 'unknown',
    healthMessage: null,
    tools: [],
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at
  }
}

/** The authorization URL an OAuth bridge prints on its own line, or null. */
export function extractSignInUrl(line: string): string | null {
  const url = /^(https:\/\/\S+)$/.exec(line.trim())?.[1]
  return url && /authorize|oauth|login|auth/i.test(url) ? url : null
}

/** True for OAuth bridges that need a person to finish a sign-in before the handshake can complete. */
export function usesOAuthBridge(config: McpStdioConfig): boolean {
  return (config.args ?? []).some(arg => /(^|[\\/])mcp-remote(@[\w.-]+)?$/i.test(arg))
}

/**
 * Stops a server and everything it spawned. On Windows the command runs through
 * a shell wrapper, so killing only the wrapper leaves the real server (and, for
 * mcp-remote, its OAuth callback port) alive and blocks the next start.
 */
function killProcessTree(child: ChildProcessWithoutNullStreams | null): void {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined)
    } else {
      child.kill()
    }
  } catch { /* already gone */ }
}

function validateConfig(transport: McpTransport, config: McpServerConfig, trusted = false): void {
  if (config.transport !== transport) {
    throw new Error(`Config transport "${config.transport}" does not match server transport "${transport}"`)
  }
  if (config.transport === 'stdio') {
    if (!config.command?.trim()) throw new Error('stdio requer command')
    if (!Array.isArray(config.args)) throw new Error('stdio requer args como array')
    if (!trusted) {
      const sensitiveKeys = Object.keys(config.env ?? {}).filter((key) => /(token|secret|password|key|credential)/i.test(key))
      if (sensitiveKeys.length > 0) {
        throw new Error(`Sensitive environment blocked on an untrusted MCP server: ${sensitiveKeys.join(', ')}`)
      }
    }
  } else {
    if (!config.url?.trim()) throw new Error(`${transport} requer url`)
  }
}

function buildProcessEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv }
  const pathKey = getPathKey(env)
  env[pathKey] = mergePathEntries(env[pathKey] ?? process.env[pathKey] ?? process.env.PATH ?? '', commonExecutableDirs(env))
  return env
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
}

function mergePathEntries(currentPath: string, entries: string[]): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const entry of [...entries, ...currentPath.split(path.delimiter)]) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(trimmed)
  }
  return merged.join(path.delimiter)
}

function commonExecutableDirs(env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32') return []
  return [
    env.ProgramFiles ? path.join(env.ProgramFiles, 'nodejs') : null,
    env['ProgramFiles(x86)'] ? path.join(env['ProgramFiles(x86)']!, 'nodejs') : null,
    env.APPDATA ? path.join(env.APPDATA, 'npm') : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'nodejs') : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'pnpm') : null
  ].filter((entry): entry is string => Boolean(entry))
}

function resolveExecutable(command: string, env: NodeJS.ProcessEnv): string {
  const trimmed = command.trim()
  if (!trimmed) return command
  if (process.platform !== 'win32') return trimmed
  if (path.isAbsolute(trimmed) || trimmed.includes('\\') || trimmed.includes('/')) {
    return trimmed
  }

  return findWindowsExecutable(trimmed, env) ?? trimmed
}

function findWindowsExecutable(command: string, env: NodeJS.ProcessEnv): string | null {
  const result = spawnSync('where.exe', [command], {
    env,
    windowsHide: true,
    encoding: 'utf8'
  })
  if (result.status !== 0 || !result.stdout.trim()) return null
  const matches = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (path.extname(command)) return matches[0] ?? null
  return (
    matches.find((candidate) => WINDOWS_EXECUTABLE_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) ??
    matches[0] ??
    null
  )
}

function shouldUseWindowsCommandShell(command: string): boolean {
  if (process.platform !== 'win32') return false
  const ext = path.extname(command).toLowerCase()
  return ext === '.cmd' || ext === '.bat'
}

/**
 * Builds a useful exit message for the UI. `code === null` happens routinely
 * on Windows when spawn used `shell: true` — the wrapper cmd.exe consumed the
 * actual exit code on its way out. We swap the cryptic "exited (null)" for the
 * tail of stderr, which is usually the real cause (missing env var, missing
 * dep, etc.). Falls back to the original code+signal when nothing useful was
 * written to stderr.
 */
function formatExitMessage(code: number | null, stderrLines: string[]): string {
  const last = stderrLines.slice(-3).filter(Boolean)
  if (last.length > 0) {
    const joined = last.join(' | ')
    return code === null ? `Exited unexpectedly — ${joined}` : `Exited with code ${code} — ${joined}`
  }
  if (code === null) {
    return 'Exited without an explicit code (often: missing required env var or dependency). Check the server\'s stderr.'
  }
  return `Exited with code ${code}`
}

function formatSpawnError(command: string, err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : null
  const rawMessage = err instanceof Error ? err.message : String(err)
  if (code === 'ENOENT') {
    const suffix = process.platform === 'win32' && !path.extname(command) ? `. On Windows, OXESpace also looks for ${command}.cmd on the PATH.` : ''
    return `Executable "${command}" not found${suffix} Install the required dependency or set the command's absolute path in the MCP server.`
  }
  return `Could not start "${command}": ${rawMessage}`
}

function timeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
}
