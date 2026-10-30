import type { AppDatabase } from '../../db/index'
import { serverKey, type McpHttpConfig, type McpServerConfig, type McpStdioConfig } from '../../../../shared/types/mcp'

/**
 * MCP servers configured in OXESpace (global + the thread's workspace) that a
 * Thread agent should see. The Code terminals learn about them through
 * `.mcp.json`; Thread agents are launched with explicit arguments instead, so
 * the connection does not depend on a file sync, a per-project approval or the
 * provider having its own copy of the configuration.
 *
 * Secrets are never placed on the command line: they travel in the process
 * environment (`env`) and the arguments only reference variable names.
 */
export interface ManagedMcpServer {
  key: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  /** variable name inside the server → process variable that holds the value */
  env: Record<string, string>
  /** header name → process variable that holds the value */
  headers: Record<string, string>
}

export interface ManagedMcp {
  servers: ManagedMcpServer[]
  /** Values for the process variables referenced by `servers`. */
  env: Record<string, string>
}

interface Row { name: string; workspace_id: string | null; config_json: string }

const variable = (key: string, name: string): string => `OXE_MCP_${key.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_${name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`

// Names that would change how the agent process itself behaves when set in its environment.
const RESERVED = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|SHELL|PWD|APPDATA|LOCALAPPDATA|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|HTTPS?_PROXY|NO_PROXY|OXESPACE_.*|ANTHROPIC_.*|OPENAI_.*|CODEX_.*|CLAUDE.*)$/i

/**
 * On Windows `npx`, `npm` and friends are `.cmd` shims, which agent CLIs cannot
 * spawn directly (no shell). Run them through `cmd /c` like the Claude docs advise.
 */
const CMD_SHIMS = /^(npx|npm|pnpm|yarn|bunx)(.cmd)?$/i
function launch(command: string, args: string[], platform: NodeJS.Platform): { command: string; args: string[] } {
  return platform === 'win32' && CMD_SHIMS.test(command.trim()) ? { command: 'cmd', args: ['/c', command.trim(), ...args] } : { command, args }
}

/**
 * Enabled, trusted servers for one or more workspaces plus the global ones. A
 * Thread passes every Code workspace with its project root, so servers the user
 * scoped to that project reach the conversation too. When a workspace server
 * and a global server share a name, the workspace definition wins.
 */
/** `allowed` drops the servers a policy blocks, by their configured name. */
export function readManagedMcp(db: AppDatabase, workspaceIds: string | string[] | null | undefined, platform: NodeJS.Platform = process.platform, allowed: (name: string) => boolean = () => true): ManagedMcp {
  const scoped = (Array.isArray(workspaceIds) ? workspaceIds : workspaceIds ? [workspaceIds] : []).slice(0, 50)
  const all = db.prepare(
    `SELECT name, workspace_id, config_json FROM mcp_servers
     WHERE enabled = 1 AND trusted = 1 AND (workspace_id IS NULL${scoped.length ? ` OR workspace_id IN (${scoped.map(() => '?').join(', ')})` : ''})
     ORDER BY created_at ASC`
  ).all(...scoped) as Row[]
  const scopedNames = new Set(all.filter(row => row.workspace_id !== null).map(row => row.name))
  const rows = all.filter(row => row.workspace_id !== null || !scopedNames.has(row.name))
  const servers: ManagedMcpServer[] = []
  const env: Record<string, string> = {}
  const taken = new Set<string>(['oxespace-delegation'])
  for (const row of rows) {
    // The OXESpace bridge is already attached by threadMcpArguments.
    if (row.name === 'oxespace' && row.workspace_id === null) continue
    if (!allowed(row.name)) continue
    let config: McpServerConfig
    try { config = JSON.parse(row.config_json) as McpServerConfig } catch { continue }
    let key = serverKey(row.name)
    for (let counter = 2; taken.has(key); counter += 1) key = `${serverKey(row.name)}-${counter}`
    taken.add(key)
    if (config.transport === 'stdio') {
      const stdio = config as McpStdioConfig
      if (!stdio.command) continue
      const started = launch(stdio.command, stdio.args ?? [], platform)
      const server: ManagedMcpServer = { key, transport: 'stdio', command: started.command, args: started.args, env: {}, headers: {} }
      for (const [name, value] of Object.entries(stdio.env ?? {})) {
        // Keep the server's own variable name when it is free: Codex can only forward by name.
        const plain = !RESERVED.test(name) && (env[name] === undefined || env[name] === String(value))
        const ref = plain ? name : variable(key, name)
        env[ref] = String(value)
        server.env[name] = ref
      }
      servers.push(server)
    } else {
      const http = config as McpHttpConfig
      if (!http.url) continue
      const server: ManagedMcpServer = { key, transport: http.transport, url: http.url, env: {}, headers: {} }
      for (const [name, value] of Object.entries(http.headers ?? {})) {
        const ref = variable(key, `HEADER_${name}`)
        env[ref] = String(value)
        server.headers[name] = ref
      }
      servers.push(server)
    }
  }
  return { servers, env }
}

/** Claude `--mcp-config` entries; `${VAR}` is expanded by the CLI from its environment. */
export function claudeMcpEntries(managed: ManagedMcp): Record<string, unknown> {
  const entries: Record<string, unknown> = {}
  for (const server of managed.servers) {
    if (server.transport === 'stdio') {
      entries[server.key] = {
        command: server.command, args: server.args ?? [],
        ...(Object.keys(server.env).length ? { env: Object.fromEntries(Object.entries(server.env).map(([name, ref]) => [name, `\${${ref}}`])) } : {})
      }
    } else {
      entries[server.key] = {
        type: server.transport, url: server.url,
        ...(Object.keys(server.headers).length ? { headers: Object.fromEntries(Object.entries(server.headers).map(([name, ref]) => [name, `\${${ref}}`])) } : {})
      }
    }
  }
  return entries
}

/** Codex `-c` overrides. Values are TOML; JSON strings and arrays are valid TOML. */
export function codexMcpArguments(managed: ManagedMcp): string[] {
  const out: string[] = []
  for (const server of managed.servers) {
    const base = `mcp_servers.${server.key}`
    if (server.transport === 'stdio') {
      out.push('-c', `${base}.command=${JSON.stringify(server.command)}`, '-c', `${base}.args=${JSON.stringify(server.args ?? [])}`)
      // Codex forwards variables by name only. Same-named ones travel through the environment; a remapped
      // one (name clash or reserved name) has to be written inline as a last resort.
      const forwarded = Object.entries(server.env).filter(([name, ref]) => name === ref).map(([name]) => name)
      const inline = Object.entries(server.env).filter(([name, ref]) => name !== ref)
      if (forwarded.length) out.push('-c', `${base}.env_vars=${JSON.stringify(forwarded)}`)
      if (inline.length) out.push('-c', `${base}.env={${inline.map(([name, ref]) => `${JSON.stringify(name)}=${JSON.stringify(managed.env[ref] ?? '')}`).join(',')}}`)
    } else {
      out.push('-c', `${base}.url=${JSON.stringify(server.url)}`)
      const headers = Object.entries(server.headers)
      if (headers.length) out.push('-c', `${base}.env_http_headers={${headers.map(([name, ref]) => `${JSON.stringify(name)}=${JSON.stringify(ref)}`).join(',')}}`)
    }
  }
  return out
}
