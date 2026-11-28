import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { openExternalOrRecord } from '../utils/external-open'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AppDatabase } from '../db/index'
import type { MainMessage } from '../../../shared/messages'
import type {
  CreateMcpServerInput,
  McpCallToolInput,
  McpCallToolResult,
  McpHealthStatus,
  McpHttpConfig,
  McpOAuthConnectResult,
  McpOAuthStatus,
  McpReadResourceInput,
  McpReadResourceResult,
  McpResourceContent,
  McpResourceDescriptor,
  McpServer,
  McpServerConfig,
  McpServerHealthEvent,
  McpStdioConfig,
  McpToolDescriptor,
  McpTransport,
  UpdateMcpServerInput
} from '../../../shared/types/mcp'
import { redactSecrets } from '../../../shared/secrets'
import type { SecretCipher } from './oxequery/connection-store'
import type { McpFetch, McpHttpClient } from './mcp-http-transport'
import type { McpOAuthManager } from './mcp-oauth'
import { mcpServerKeys } from './mcp-keys'
import { McpConfigSync } from './mcp-sync.service'
import {
  buildProcessEnv,
  formatExitMessage,
  formatSpawnError,
  isMethodNotFoundError,
  killProcessTree,
  resolveExecutable,
  shouldUseWindowsCommandShell,
  timeout,
  validateConfig
} from './mcp-stdio-helpers'
import { unbridgeRemoteMcpServers, upgradeRetiredMcpEndpoints } from './mcp-retired-endpoints'
import { probeHttpServer } from './mcp-http-probe'
import { recordIncident } from './diagnostics/incident-sink'
import { checkConfig, parseGuard, summarizeGuard, trustState, configHash, type GuardState, type GuardVerdict } from './mcp-pin'

interface McpServerRow {
  id: string
  workspace_id: string | null
  name: string
  transport: McpTransport
  config_json: string
  enabled: number
  trusted: number
  guard_json: string | null
  created_at: number
  updated_at: number
}

interface RuntimeServer {
  server: McpServer
  process: ChildProcessWithoutNullStreams | null
  httpClient: McpHttpClient | null
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
interface TestResult { health: McpHealthStatus; message: string | null; messageCode?: MainMessage; tools: McpToolDescriptor[]; at: number }

const STDERR_RING_SIZE = 10
const STDERR_LINE_MAX = 240
const MAX_RESOURCE_CHARS = 64_000
const MAX_RESOURCE_ITEMS = 16
const OAUTH_CREDENTIAL_PREFIX = 'mcp:oauth:'

interface McpManagerOptions {
  emitHealth?: (event: McpServerHealthEvent) => void
  cipher?: SecretCipher
  getCipher?: () => Promise<SecretCipher>
  fetchImpl?: McpFetch
  openBrowser?: (url: string) => boolean
  oauthCallbackTimeoutMs?: number
}

const PROTOCOL_VERSION = '2025-06-18'
const INIT_TIMEOUT_MS = 15_000
/** Package runners (npx, uvx, etc.) may download packages on first cold start, especially on Windows. */
export const PACKAGE_RUNNER_INIT_TIMEOUT_MS = 60_000
/** Remote servers (mcp-remote) wait for a person to sign in; that takes minutes, not seconds. */
const AUTH_INIT_TIMEOUT_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 30_000
const SLEEP_TIMEOUT_MS = 15 * 60 * 1000
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
  /** The tools a quarantined server announced, for this run of the app. */
  private readonly said = new Map<string, McpToolDescriptor[]>()
  private readonly emitHealth: (event: McpServerHealthEvent) => void
  private readonly configSync: McpConfigSync
  private readonly options: McpManagerOptions
  private oauthPromise: Promise<McpOAuthManager> | null = null

  constructor(private readonly db: AppDatabase, options: McpManagerOptions = {}) {
    this.options = options
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
    const keys = mcpServerKeys(this.db, workspaceId ? [workspaceId] : [])
    return rows.map((row) => this.hydrateServer(mapRow(row, keys.get(row.id))))
  }

  /** For the diagnostics panel (B8.3): counts only, no names or commands. */
  healthCounts(): { total: number; healthy: number; quarantined: number; failing: number } {
    // Counts only: no key is needed, and none leaves here.
    const servers = (this.db.prepare('SELECT * FROM mcp_servers').all() as McpServerRow[]).map(row => this.hydrateServer(mapRow(row, undefined)))
    const quarantined = servers.filter(server => server.guard?.quarantine).length
    return { total: servers.length, healthy: servers.filter(server => server.health === 'healthy').length, quarantined,
      failing: servers.filter(server => server.health === 'unhealthy' && !server.guard?.quarantine).length }
  }

  get(id: string): McpServer | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow | undefined
    return row ? this.hydrateServer(mapRow(row, mcpServerKeys(this.db, row.workspace_id ? [row.workspace_id] : []).get(row.id))) : null
  }

  create(input: CreateMcpServerInput): McpServer {
    const id = randomUUID()
    const now = Date.now()
    validateConfig(input.transport, input.config, input.trusted === true)
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, guard_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.workspaceId, input.name.trim(), input.transport, JSON.stringify(input.config), input.enabled === false ? 0 : 1, input.trusted === true ? 1 : 0, input.trusted === true ? JSON.stringify(trustState(input.config, now)) : null, now, now)
    this.syncFile(input.workspaceId)
    return this.get(id)!
  }

  update(input: UpdateMcpServerInput): McpServer {
    const current = this.get(input.id)
    if (!current) throw new Error(`MCP server ${input.id} not found`)
    const transport = input.transport ?? current.transport
    const config = input.config ?? current.config
    validateConfig(transport, config, input.trusted ?? current.trusted)
    const guard = this.guardAfterEdit(current, config, input.trusted)
    this.db
      .prepare(
        `UPDATE mcp_servers
         SET name = COALESCE(?, name),
             transport = ?,
             config_json = ?,
             enabled = COALESCE(?, enabled),
             trusted = COALESCE(?, trusted),
             guard_json = COALESCE(?, guard_json),
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name?.trim() ?? null,
        transport,
        JSON.stringify(config),
        input.enabled === undefined ? null : input.enabled ? 1 : 0,
        guard.trusted === undefined ? null : guard.trusted ? 1 : 0,
        guard.state ? JSON.stringify(guard.state) : null,
        Date.now(),
        input.id
      )
    // If runtime is running, restart so changes take effect
    this.stopRuntime(input.id)
    this.tested.delete(input.id)
    this.said.delete(input.id)
    this.syncFile(current.workspaceId)
    return this.get(input.id)!
  }

  delete(id: string): void {
    const current = this.get(id)
    this.stopRuntime(id)
    this.tested.delete(id)
    this.said.delete(id)
    try { this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(`${OAUTH_CREDENTIAL_PREFIX}${id}`) } catch { /* ignore */ }
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    if (current) this.syncFile(current.workspaceId)
  }

  /** Starts (or restarts) a server (stdio, Streamable HTTP, or SSE) and runs its handshake. Returns the live tools list. */
  async start(id: string): Promise<McpToolDescriptor[]> {
    const server = this.get(id)
    if (!server) throw new Error(`MCP server ${id} not found`)
    if (!server.trusted) throw new Error(server.guard?.quarantine ? quarantineMessage(server.guard.quarantine.reasons) : 'MCP server is not trusted. Review its command/env and mark it trusted before starting.')
    this.verify(server, checkConfig(this.guardOf(id), server.config, Date.now()))
    const inFlight = this.starting.get(id)
    if (inFlight) return inFlight
    if (this.runtimes.has(id)) this.stopRuntime(id)
    const runner = server.transport === 'stdio' ? this.startStdio(server) : this.startHttp(server)
    const run = runner.finally(() => { this.starting.delete(id) })
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
    const record = (health: McpHealthStatus, message: string | null, tools: McpToolDescriptor[] = [], messageCode?: MainMessage): McpServer => {
      this.tested.set(id, { health, message, messageCode, tools, at: Date.now() })
      this.emitHealth({ serverId: id, status: health, message, ...(messageCode ? { messageCode } : {}) })
      return this.get(id)!
    }
    if (!server.trusted) return record('unhealthy', server.guard?.quarantine ? quarantineMessage(server.guard.quarantine.reasons) : 'Not trusted yet. Review its command and trust it before testing.', [],
      server.guard?.quarantine ? { code: 'mcp.server.quarantined', params: {} } : { code: 'mcp.server.untrusted', params: {} })
    if (server.transport !== 'stdio') {
      this.emitHealth({ serverId: id, status: 'starting', message: null })
      try {
        const tools = await this.start(id)
        this.stopRuntime(id, true)
        return record('healthy', `${tools.length} tool(s)`, tools)
      } catch (err) {
        const { McpHttpAuthError } = await import('./mcp-http-transport')
        if (err instanceof McpHttpAuthError && !err.hadAuthorization) {
          return record('needs-auth', 'Answers and asks for a sign-in. Connect OAuth or sign in on first use.')
        }
        // Fallback probe for legacy SSE endpoints that only expose stream reachability without MCP endpoint handshake.
        if (server.transport === 'sse') {
          try {
            const authHeader = await this.authHeaderFor(server.id)
            const cfg = server.config as McpHttpConfig
            const probed = await probeHttpServer(
              authHeader ? { ...cfg, headers: { ...cfg.headers, Authorization: authHeader } } : cfg,
              this.options.fetchImpl
            )
            if (probed.status === 'needs-auth') return record('needs-auth', 'Answers and asks for a sign-in. Connect OAuth or sign in on first use.')
            if (probed.status === 'reachable') return record('healthy', 'Answers. Its tools show once the agent connects.')
          } catch {
            // Fall through and surface the primary transport error below
          }
        }
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

  /**
   * Opens the browser sign-in page of a server that is waiting for authentication, at the person's click only. The
   * URL came from the server's own output, so it passes the same rules as any link leaving the app (https here, no
   * credentials, bounded), and a refusal is journalled without the URL.
   */
  openSignIn(id: string): boolean {
    const url = this.runtimes.get(id)?.authUrl
    if (!url || !/^https:\/\//i.test(url)) return false
    return openExternalOrRecord(url)
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
    if (runtime.httpClient) void runtime.httpClient.close().catch(() => undefined)
    runtime.pending.forEach(({ reject }) => reject(new Error('MCP server stopped')))
    runtime.pending.clear()
    if (!quiet) this.emitHealth({ serverId: id, status: 'unknown', message: null })
  }

  private async ensureRuntime(serverId: string): Promise<RuntimeServer> {
    let runtime = this.runtimes.get(serverId)
    if (!runtime) {
      await this.start(serverId)
      runtime = this.runtimes.get(serverId)
    }
    if (!runtime || !runtime.initialized) throw new Error('MCP server not initialized')
    if (!runtime.server.trusted) throw new Error('MCP server is not trusted')
    this.touchRuntime(runtime)
    return runtime
  }

  async callTool(input: McpCallToolInput): Promise<McpCallToolResult> {
    const runtime = await this.ensureRuntime(input.serverId)
    return this.request<McpCallToolResult>(runtime, 'tools/call', {
      name: input.toolName,
      arguments: input.arguments
    })
  }

  /** Lists MCP resources (`resources/list`) on stdio, Streamable HTTP, or SSE servers. */
  async listResources(serverId: string): Promise<McpResourceDescriptor[]> {
    const runtime = await this.ensureRuntime(serverId)
    try {
      const res = await this.request<{ resources?: unknown[] }>(runtime, 'resources/list', {})
      if (!Array.isArray(res?.resources)) return []
      return res.resources
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .filter(item => typeof item.uri === 'string' && item.uri.trim().length > 0)
        .map(item => ({
          uri: String(item.uri),
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : String(item.uri),
          ...(typeof item.description === 'string' ? { description: item.description } : {}),
          ...(typeof item.mimeType === 'string' ? { mimeType: item.mimeType } : {}),
          ...(typeof item.size === 'number' && Number.isFinite(item.size) ? { size: item.size } : {})
        }))
    } catch (err) {
      // Servers without resource capability often reply JSON-RPC -32601 (Method not found).
      if (isMethodNotFoundError(err)) return []
      throw err
    }
  }

  /** Reads an MCP resource (`resources/read`), bounding size and redacting secrets before returning. */
  async readResource(input: McpReadResourceInput): Promise<McpReadResourceResult> {
    const uri = input.uri.trim()
    if (!uri || uri.length > 4096 || uri.includes('\0')) throw new Error('Invalid MCP resource URI')
    const runtime = await this.ensureRuntime(input.serverId)
    const raw = await this.request<{ contents?: unknown[] }>(runtime, 'resources/read', { uri })
    const items = Array.isArray(raw?.contents) ? raw.contents.slice(0, MAX_RESOURCE_ITEMS) : []
    const contents: McpResourceContent[] = []
    let remaining = MAX_RESOURCE_CHARS
    for (const entry of items) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const itemUri = typeof item.uri === 'string' && item.uri ? item.uri : uri
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined
      if (typeof item.text === 'string') {
        const redacted = redactSecrets(item.text)
        const truncated = redacted.length > remaining
        const text = truncated ? redacted.slice(0, Math.max(0, remaining)) : redacted
        remaining = Math.max(0, remaining - text.length)
        contents.push({ uri: itemUri, ...(mimeType ? { mimeType } : {}), text, ...(truncated ? { truncated: true } : {}) })
      } else if (typeof item.blob === 'string') {
        const blobBytes = Math.floor((item.blob.length * 3) / 4)
        contents.push({ uri: itemUri, ...(mimeType ? { mimeType } : {}), blobBytes })
      }
    }
    return { contents }
  }

  /** Starts native OAuth 2.1 + PKCE sign-in for a remote MCP server and stores tokens in OS keychain. */
  async connectOAuth(serverId: string): Promise<McpOAuthConnectResult> {
    const server = this.get(serverId)
    if (!server) throw new Error(`MCP server ${serverId} not found`)
    if (server.transport === 'stdio') throw new Error('OAuth is only supported for remote HTTP/SSE MCP servers.')
    const oauth = await this.oauthManager()
    const result = await oauth.connect(server.id, (server.config as McpHttpConfig).url, server.name)
    if (result.ok) {
      this.stopRuntime(server.id, true)
      this.tested.delete(server.id)
    }
    return result
  }

  async disconnectOAuth(serverId: string): Promise<McpOAuthStatus> {
    const oauth = await this.oauthManager()
    this.stopRuntime(serverId, true)
    this.tested.delete(serverId)
    return oauth.disconnect(serverId)
  }

  async oauthStatus(serverId: string): Promise<McpOAuthStatus> {
    const oauth = await this.oauthManager()
    return oauth.status(serverId)
  }

  private async oauthManager(): Promise<McpOAuthManager> {
    if (!this.oauthPromise) {
      this.oauthPromise = (async () => {
        const { McpOAuthManager } = await import('./mcp-oauth')
        const cipher = this.options.cipher ?? (this.options.getCipher ? await this.options.getCipher() : undefined)
        return new McpOAuthManager({
          db: this.db,
          cipher,
          fetchImpl: this.options.fetchImpl,
          openBrowser: this.options.openBrowser,
          callbackTimeoutMs: this.options.oauthCallbackTimeoutMs
        })
      })()
    }
    return this.oauthPromise
  }

  private async authHeaderFor(serverId: string): Promise<string | null> {
    if (!this.hasStoredOAuthToken(serverId)) return null
    const oauth = await this.oauthManager()
    return oauth.getAuthorizationHeader(serverId)
  }

  private hasStoredOAuthToken(serverId: string): boolean {
    try {
      const row = this.db.prepare('SELECT 1 FROM secure_credentials WHERE provider = ? AND encrypted = 1').get(`${OAUTH_CREDENTIAL_PREFIX}${serverId}`)
      return Boolean(row)
    } catch {
      return false
    }
  }

  private async startHttp(server: McpServer): Promise<McpToolDescriptor[]> {
    if (server.transport === 'stdio') throw new Error('Not a remote HTTP/SSE server')
    const config = server.config as McpHttpConfig
    this.emitHealth({ serverId: server.id, status: 'starting', message: null })
    const { createMcpHttpClient, McpHttpAuthError } = await import('./mcp-http-transport')
    const client = createMcpHttpClient(config, {
      fetchImpl: this.options.fetchImpl,
      getAuthHeader: () => this.authHeaderFor(server.id)
    })
    const runtime: RuntimeServer = {
      server,
      process: null,
      httpClient: client,
      buffer: '',
      pending: new Map(),
      requestSeq: 0,
      initialized: false,
      stderr: [],
      lastActivity: Date.now()
    }
    this.runtimes.set(server.id, runtime)
    this.touchRuntime(runtime)
    try {
      await client.connect(INIT_TIMEOUT_MS)
      runtime.initialized = true
      const toolsResult = await this.request<{ tools?: McpToolDescriptor[] }>(runtime, 'tools/list', {})
      const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : []
      // Enforce identical MCP Pinning / anti-rug-pull quarantine across remote HTTP/SSE servers!
      await this.verifyTools(server, tools)
      runtime.server = { ...runtime.server, tools, health: 'healthy', healthMessage: null }
      this.emitHealth({ serverId: server.id, status: 'healthy', message: `${tools.length} tool(s)` })
      return tools
    } catch (err) {
      this.stopRuntime(server.id, true)
      if (err instanceof McpHttpAuthError && !err.hadAuthorization) {
        this.emitHealth({ serverId: server.id, status: 'needs-auth', message: err.message })
      } else {
        this.emitHealth({ serverId: server.id, status: 'unhealthy', message: err instanceof Error ? err.message : String(err) })
      }
      throw err
    }
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
      throw new Error(message, { cause: err })
    }

    const runtime: RuntimeServer = {
      server,
      process: child,
      httpClient: null,
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
      const initTimeoutMs = initTimeoutMsFor(config)
      const initResult = await Promise.race([
        this.request<{ protocolVersion: string; serverInfo?: { name: string } }>(runtime, 'initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          clientInfo: { name: 'oxespace', version: '0.1.0' }
        }, Math.max(initTimeoutMs, REQUEST_TIMEOUT_MS)),
        spawnError,
        timeout<{ protocolVersion: string }>(initTimeoutMs, interactiveAuth ? 'sign-in was not completed in time' : 'initialize timeout')
      ])
      if (!initResult || typeof initResult.protocolVersion !== 'string') {
        throw new Error('Invalid initialize response')
      }
      this.notify(runtime, 'notifications/initialized')
      runtime.initialized = true

      const toolsResult = await this.request<{ tools: McpToolDescriptor[] }>(runtime, 'tools/list', {})
      const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : []
      await this.verifyTools(server, tools)

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
      throw new Error(enriched, { cause: err })
    }
  }

  /**
   * mcp-remote prints the authorization URL and normally opens it itself. The app keeps that URL for "Open sign-in
   * page" and never opens it on its own: it is text a server process wrote, and it only leaves the app when the person
   * clicks (`openSignIn`), through the same rules as any other link.
   */
  private watchSignIn(runtime: RuntimeServer, line: string): void {
    if (/browser opened automatically/i.test(line)) { runtime.browserOpened = true; return }
    const url = extractSignInUrl(line)
    if (!url || runtime.authUrl === url) return
    runtime.authUrl = url
    this.emitHealth({ serverId: runtime.server.id, status: 'starting', message: 'Waiting for you to sign in in the browser…', messageCode: { code: 'mcp.signIn.waiting', params: {} } })
  }

  private resolveServerCwd(server: McpServer): string | undefined {
    if (!server.workspaceId) return undefined
    const row = this.db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(server.workspaceId) as { root_path?: string } | undefined
    return typeof row?.root_path === 'string' && row.root_path.trim() ? row.root_path : undefined
  }

  private guardOf(id: string): GuardState | null {
    const row = this.db.prepare('SELECT guard_json FROM mcp_servers WHERE id = ?').get(id) as { guard_json: string | null } | undefined
    return parseGuard(row?.guard_json)
  }

  /**
   * What an edit does to the pin. Trusting (again) pins the config as saved and keeps the tools the person
   * has seen, or accepts the ones that caused a quarantine; a config edit that is not a trust quarantines
   * a trusted server; anything else leaves the guard alone.
   */
  private guardAfterEdit(current: McpServer, config: McpServerConfig, trusted: boolean | undefined): { trusted: boolean | undefined; state: GuardState | null } {
    const old = this.guardOf(current.id)
    const now = Date.now()
    if (trusted === true) return { trusted, state: trustState(config, now, old?.quarantine?.observed ?? (old?.pin.hash === configHash(config) ? old.tools : null)) }
    if (trusted === undefined && current.trusted) {
      // A server trusted before pins existed is pinned by what it was before this edit.
      const verdict = checkConfig(old ?? trustState(current.config, now), config, now)
      return verdict.ok ? { trusted, state: old ? null : trustState(config, now) } : { trusted: false, state: verdict.state }
    }
    return { trusted, state: null }
  }

  /** Records what a check found; a server that no longer matches what was trusted is quarantined, and the caller stops. */
  private verify(server: McpServer, verdict: GuardVerdict): void {
    if (verdict.ok) {
      this.db.prepare('UPDATE mcp_servers SET guard_json = ? WHERE id = ?').run(JSON.stringify(verdict.state), server.id)
      return
    }
    const message = quarantineMessage(verdict.quarantine.reasons)
    this.db.prepare('UPDATE mcp_servers SET guard_json = ?, trusted = 0, updated_at = ? WHERE id = ?').run(JSON.stringify(verdict.state), Date.now(), server.id)
    this.stopRuntime(server.id, true)
    this.tested.delete(server.id)
    this.syncFile(server.workspaceId)
    // eslint-disable-next-line no-console
    console.warn(`[mcp] quarantined "${server.name}": ${verdict.quarantine.reasons.join(' ')}`)
    recordIncident('incident.mcp.quarantined', server.id)
    this.emitHealth({ serverId: server.id, status: 'unhealthy', message, messageCode: { code: 'mcp.server.quarantined', params: {} } })
    throw new Error(message)
  }

  /** The comparison of tool lists is loaded when a server connects, not at start-up. */
  private async verifyTools(server: McpServer, tools: McpToolDescriptor[]): Promise<void> {
    const { checkTools } = await import('./mcp-guard')
    const state = this.guardOf(server.id) ?? trustState(server.config, Date.now())
    try {
      this.verify(server, checkTools(state, tools, Date.now()))
      this.said.delete(server.id)
    } catch (err) {
      this.said.set(server.id, tools)
      throw err
    }
  }

  private hydrateServer(server: McpServer): McpServer {
    const oauthConnected = server.transport !== 'stdio' ? this.hasStoredOAuthToken(server.id) : undefined
    const base = oauthConnected !== undefined ? { ...server, oauthConnected } : server
    const runtime = this.runtimes.get(server.id)
    if (runtime && runtime.initialized) {
      return { ...base, health: 'healthy', tools: runtime.server.tools }
    }
    if (runtime) {
      return { ...base, health: 'starting' }
    }
    const tested = this.tested.get(server.id)
    const hydrated = tested ? { ...base, health: tested.health, healthMessage: tested.message, ...(tested.messageCode ? { healthMessageCode: tested.messageCode } : {}), tools: tested.tools, testedAtMs: tested.at } : base
    // A quarantined server shows what it said, so the person can read it before trusting it again.
    const said = server.guard?.quarantine ? this.said.get(server.id) : undefined
    return said ? { ...hydrated, tools: said } : hydrated
  }

  private request<T>(runtime: RuntimeServer, method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (runtime.httpClient) {
      return runtime.httpClient.request<T>(method, params, timeoutMs)
    }
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

/** `key` is the server's key in its scope (mcp-keys.ts): the global servers with its workspace's. */
function mapRow(row: McpServerRow, key: string | undefined): McpServer {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    key,
    transport: row.transport,
    config: JSON.parse(row.config_json) as McpServerConfig,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    guard: summarizeGuard(parseGuard(row.guard_json)),
    health: 'unknown',
    healthMessage: null,
    tools: [],
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at
  }
}

const quarantineMessage = (reasons: string[]): string => `Quarantined: ${reasons.join(' ')} Review it and trust it again to use it.`

/** The authorization URL an OAuth bridge prints on its own line, or null. */
export function extractSignInUrl(line: string): string | null {
  const url = /^(https:\/\/\S+)$/.exec(line.trim())?.[1]
  return url && /authorize|oauth|login|auth/i.test(url) ? url : null
}

/** True for OAuth bridges that need a person to finish a sign-in before the handshake can complete. */
export function usesOAuthBridge(config: McpStdioConfig): boolean {
  return (config.args ?? []).some(arg => /(^|[\\/])mcp-remote(@[\w.-]+)?$/i.test(arg))
}

const PACKAGE_RUNNER_RE = /^(?:npx|uvx|bunx|pnpm|yarn|npm)(?:\.(?:cmd|exe|bat|ps1))?$/i

/** True when the command invokes a package runner whose first cold start may download packages. */
export function isPackageRunnerCommand(command: string): boolean {
  return PACKAGE_RUNNER_RE.test((command.trim().split(/[\\/]/).pop() ?? '').toLowerCase())
}

/** Handshake timeout for a stdio server: 5 min for OAuth bridges, 60 s for package runners, 15 s otherwise. */
export function initTimeoutMsFor(config: McpStdioConfig): number {
  if (usesOAuthBridge(config)) return AUTH_INIT_TIMEOUT_MS
  return isPackageRunnerCommand(config.command) ? PACKAGE_RUNNER_INIT_TIMEOUT_MS : INIT_TIMEOUT_MS
}
