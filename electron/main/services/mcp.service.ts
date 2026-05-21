import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AppDatabase } from '../db/index'
import type {
  CreateMcpServerInput,
  McpCallToolInput,
  McpCallToolResult,
  McpHealthStatus,
  McpServer,
  McpServerConfig,
  McpServerHealthEvent,
  McpStdioConfig,
  McpToolDescriptor,
  McpTransport,
  UpdateMcpServerInput
} from '../../../shared/types/mcp'
import { McpConfigSync } from './mcp-sync.service'

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
}

interface McpManagerOptions {
  emitHealth?: (event: McpServerHealthEvent) => void
}

const PROTOCOL_VERSION = '2025-06-18'
const INIT_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 30_000
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.ps1']

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
  private readonly emitHealth: (event: McpServerHealthEvent) => void
  private readonly configSync: McpConfigSync

  constructor(private readonly db: AppDatabase, options: McpManagerOptions = {}) {
    this.emitHealth = options.emitHealth ?? (() => undefined)
    this.configSync = new McpConfigSync(db)
    // Refresh every workspace's .mcp.json on startup so the file stays in sync
    // when the user has been editing MCPs across sessions (the file may be
    // stale if it was hand-edited or if a previous OXESpace version didn't
    // write it). Sync errors are non-fatal — the manager still starts.
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
    this.syncFile(current.workspaceId)
    return this.get(input.id)!
  }

  delete(id: string): void {
    const current = this.get(id)
    this.stopRuntime(id)
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    if (current) this.syncFile(current.workspaceId)
  }

  /** Starts (or restarts) a server and runs its handshake. Returns the live tools list. */
  async start(id: string): Promise<McpToolDescriptor[]> {
    const server = this.get(id)
    if (!server) throw new Error(`MCP server ${id} not found`)
    if (!server.trusted) throw new Error('MCP server is not trusted. Review its command/env and mark it trusted before starting.')
    if (server.transport !== 'stdio') {
      throw new Error('Apenas transporte stdio é suportado nesta versão. HTTP/SSE virão na Onda 6.')
    }
    if (this.runtimes.has(id)) this.stopRuntime(id)
    const tools = await this.startStdio(server)
    return tools
  }

  stopAll(): void {
    for (const id of [...this.runtimes.keys()]) this.stopRuntime(id)
  }

  stopRuntime(id: string): void {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    try { runtime.process?.kill() } catch { /* ignore */ }
    runtime.pending.forEach(({ reject }) => reject(new Error('MCP server stopped')))
    runtime.pending.clear()
    this.runtimes.delete(id)
    this.emitHealth({ serverId: id, status: 'unknown', message: null })
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
      initialized: false
    }
    this.runtimes.set(server.id, runtime)

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
    })
    child.on('exit', (code) => {
      runtime.pending.forEach(({ reject }) => reject(new Error(`MCP server exited with code ${code}`)))
      runtime.pending.clear()
      this.runtimes.delete(server.id)
      this.emitHealth({ serverId: server.id, status: 'unhealthy', message: `exited (${code})` })
    })

    try {
      // Handshake: initialize → notifications/initialized → tools/list
      const initResult = await Promise.race([
        this.request<{ protocolVersion: string; serverInfo?: { name: string } }>(runtime, 'initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          clientInfo: { name: 'oxespace', version: '0.1.0' }
        }),
        spawnError,
        timeout<{ protocolVersion: string }>(INIT_TIMEOUT_MS, 'initialize timeout')
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
      const message = err instanceof Error ? err.message : String(err)
      this.stopRuntime(server.id)
      this.emitHealth({ serverId: server.id, status: 'unhealthy', message })
      throw err
    }
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
    return server
  }

  private request<T>(runtime: RuntimeServer, method: string, params: unknown): Promise<T> {
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
      }, REQUEST_TIMEOUT_MS)
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

function validateConfig(transport: McpTransport, config: McpServerConfig, trusted = false): void {
  if (config.transport !== transport) {
    throw new Error(`Config transport "${config.transport}" não bate com server transport "${transport}"`)
  }
  if (config.transport === 'stdio') {
    if (!config.command?.trim()) throw new Error('stdio requer command')
    if (!Array.isArray(config.args)) throw new Error('stdio requer args como array')
    if (!trusted) {
      const sensitiveKeys = Object.keys(config.env ?? {}).filter((key) => /(token|secret|password|key|credential)/i.test(key))
      if (sensitiveKeys.length > 0) {
        throw new Error(`Env sensível bloqueado em server MCP não confiável: ${sensitiveKeys.join(', ')}`)
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

function formatSpawnError(command: string, err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : null
  const rawMessage = err instanceof Error ? err.message : String(err)
  if (code === 'ENOENT') {
    const suffix = process.platform === 'win32' && !path.extname(command) ? `. No Windows, o OXESpace também procura por ${command}.cmd no PATH.` : ''
    return `Executável "${command}" não encontrado${suffix} Instale a dependência necessária ou configure o caminho absoluto do comando no servidor MCP.`
  }
  return `Falha ao iniciar "${command}": ${rawMessage}`
}

function timeout<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
}
