import type { AppDatabase } from '../db/index'

/**
 * Remote MCP endpoints the catalog once offered that their providers retired,
 * mapped to the current ones. Linear's SSE endpoint answers 404 and
 * Cloudflare's SSE stream answers 410; both now serve Streamable HTTP at /mcp.
 */
export const RETIRED_MCP_ENDPOINTS: Readonly<Record<string, string>> = {
  'https://mcp.linear.app/sse': 'https://mcp.linear.app/mcp',
  'https://docs.mcp.cloudflare.com/sse': 'https://docs.mcp.cloudflare.com/mcp'
}

interface Row { id: string; config_json: string }

/**
 * Points saved servers added from an older catalog at the current endpoint, so a
 * connector that stopped working starts working again without being re-added.
 * Only an argument that is exactly a retired URL changes; anything the person
 * edited is left alone. Returns how many servers changed. Idempotent.
 */
export function upgradeRetiredMcpEndpoints(db: AppDatabase, now: number = Date.now()): number {
  const rows = db.prepare(`SELECT id, config_json FROM mcp_servers WHERE transport = 'stdio'`).all() as Row[]
  const update = db.prepare('UPDATE mcp_servers SET config_json = ?, updated_at = ? WHERE id = ?')
  let changed = 0
  for (const row of rows) {
    let config: { args?: unknown }
    try { config = JSON.parse(row.config_json) as { args?: unknown } } catch { continue }
    if (!Array.isArray(config.args) || !config.args.some(arg => typeof arg === 'string' && arg in RETIRED_MCP_ENDPOINTS)) continue
    config.args = config.args.map(arg => typeof arg === 'string' && arg in RETIRED_MCP_ENDPOINTS ? RETIRED_MCP_ENDPOINTS[arg] : arg)
    update.run(JSON.stringify(config), now, row.id)
    changed += 1
  }
  return changed
}

/**
 * Servers saved as nothing more than an `mcp-remote` bridge (`npx -y mcp-remote
 * <url>`, no extra flags or variables) become the remote server they bridge.
 * The agent then reaches the URL and signs in itself, instead of depending on a
 * second process that headless agents cannot complete a sign-in through. A
 * bridge with options of its own is left alone. Returns how many changed.
 */
export function unbridgeRemoteMcpServers(db: AppDatabase, now: number = Date.now()): number {
  const rows = db.prepare(`SELECT id, config_json FROM mcp_servers WHERE transport = 'stdio'`).all() as Row[]
  const update = db.prepare('UPDATE mcp_servers SET transport = ?, config_json = ?, updated_at = ? WHERE id = ?')
  let changed = 0
  for (const row of rows) {
    let config: { command?: unknown; args?: unknown; env?: unknown }
    try { config = JSON.parse(row.config_json) as typeof config } catch { continue }
    const args = Array.isArray(config.args) ? config.args : []
    const env = config.env && typeof config.env === 'object' ? Object.keys(config.env) : []
    if (config.command !== 'npx' || env.length || args.length !== 3 || args[0] !== '-y' || args[1] !== 'mcp-remote') continue
    const url = String(args[2])
    if (!/^https:\/\/\S+$/i.test(url)) continue
    const transport = /\/sse\/?$/i.test(url) ? 'sse' : 'http'
    update.run(transport, JSON.stringify({ transport, url, headers: {} }), now, row.id)
    changed += 1
  }
  return changed
}
