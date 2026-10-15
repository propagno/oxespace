/**
 * Finds MCP servers other tools already know and offers them for import.
 *
 * Sources are the user-level config files of Claude Desktop, Cursor and Windsurf, at their
 * documented fixed locations (adapted from VS Code's native MCP discovery,
 * microsoft/vscode, MIT licence, Copyright (c) Microsoft Corporation:
 * `mcp/common/discovery/nativeMcpDiscoveryAdapters.ts`). The project `.mcp.json` and the Claude
 * Code user config are left out on purpose: OXESpace writes the first, and the CLI reads both itself,
 * so importing them would start every server twice.
 *
 * Secrets stay in the main process. `discover` returns names, commands and the *names* of
 * environment variables and headers; `importServers` re-reads the file and creates the servers.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseMcpJson } from '../../../shared/mcpConfigJson'
import type { McpDiscoveredServer, McpDiscoverySource, McpServerConfig } from '../../../shared/types/mcp'

const MAX_BYTES = 512 * 1024
const MAX_SERVERS = 100

interface Adapter { id: McpDiscoverySource['id']; label: string; path(home: string, appData: string | undefined, platform: NodeJS.Platform): string }

const ADAPTERS: Adapter[] = [
  {
    id: 'claude-desktop', label: 'Claude Desktop',
    path: (home, appData, platform) => platform === 'win32' ? join(appData ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json')
  },
  { id: 'cursor', label: 'Cursor', path: (home) => join(home, '.cursor', 'mcp.json') },
  { id: 'windsurf', label: 'Windsurf', path: (home) => join(home, '.codeium', 'windsurf', 'mcp_config.json') }
]

export interface McpImportOptions { home?: string; appData?: string; platform?: NodeJS.Platform }

function readServers(file: string): Array<{ name: string; config: McpServerConfig }> {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_BYTES) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: unknown }
    const map = parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers) ? parsed.mcpServers as Record<string, unknown> : {}
    const out: Array<{ name: string; config: McpServerConfig }> = []
    for (const [name, entry] of Object.entries(map).slice(0, MAX_SERVERS)) {
      // One server in a shape OXESpace cannot run must not hide the others.
      try { out.push(...parseMcpJson(JSON.stringify({ mcpServers: { [name]: entry } }))) } catch { /* skipped */ }
    }
    return out
  } catch { return [] }
}

/** What each tool has, without any secret values. `existing` names are those already saved in the scope. */
export function discoverMcpServers(existing: ReadonlySet<string>, options: McpImportOptions = {}): McpDiscoverySource[] {
  const home = options.home ?? homedir()
  const platform = options.platform ?? process.platform
  const sources: McpDiscoverySource[] = []
  for (const adapter of ADAPTERS) {
    const servers = readServers(adapter.path(home, options.appData ?? process.env.APPDATA, platform))
    if (!servers.length) continue
    sources.push({
      id: adapter.id, label: adapter.label,
      servers: servers.map(({ name, config }): McpDiscoveredServer => ({
        name, transport: config.transport,
        target: config.transport === 'stdio' ? [config.command, ...config.args].join(' ') : config.url,
        secretNames: Object.keys(config.transport === 'stdio' ? config.env : config.headers),
        exists: existing.has(name)
      }))
    })
  }
  return sources
}

/** The configs of the named servers of one source, read again from its file. */
export function readDiscoveredServers(sourceId: string, names: readonly string[], options: McpImportOptions = {}): Array<{ name: string; config: McpServerConfig }> {
  const adapter = ADAPTERS.find(item => item.id === sourceId)
  if (!adapter) throw new Error('Unknown source')
  const wanted = new Set(names)
  return readServers(adapter.path(options.home ?? homedir(), options.appData ?? process.env.APPDATA, options.platform ?? process.platform)).filter(server => wanted.has(server.name))
}
