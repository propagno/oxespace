/**
 * One key per configured MCP server, the same everywhere it is named: in a conversation's servers, in a workspace's
 * `.mcp.json`, in policy resources (`mcp__<key>__<tool>`) and in Settings › Tools (B7.3). It is `serverKey(name)`,
 * with `-2`, `-3`… when two servers of the scope normalize to the same key, given in creation order, so a deny on
 * `my-server-2` reaches the server a conversation calls `my-server-2`.
 *
 * The scope is the global servers with one workspace's (a Settings list, a `.mcp.json`) or with every workspace a
 * conversation spans. A key is assigned over the whole scope, enabled or not, so it does not move when a sibling is
 * disabled or blocked.
 */
import type { AppDatabase } from '../db'
import { serverKey } from '../../../shared/types/mcp'

/** The key OXESpace's own tools have in a conversation; no configured server takes it. */
const RESERVED = ['oxespace-delegation']

export interface McpKeyRow { id: string; name: string; createdAt: number }

export function assignMcpServerKeys(rows: McpKeyRow[]): Map<string, string> {
  const keys = new Map<string, string>()
  const taken = new Set<string>(RESERVED)
  for (const row of [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
    const base = serverKey(row.name)
    let key = base
    for (let counter = 2; taken.has(key); counter += 1) key = `${base}-${counter}`
    taken.add(key)
    keys.set(row.id, key)
  }
  return keys
}

/** The keys of the global servers and the named workspaces' servers, by server id. */
export function mcpServerKeys(db: AppDatabase, workspaceIds: readonly string[]): Map<string, string> {
  const scoped = [...new Set(workspaceIds)].slice(0, 50)
  const rows = db.prepare(
    `SELECT id, name, created_at FROM mcp_servers WHERE workspace_id IS NULL${scoped.length ? ` OR workspace_id IN (${scoped.map(() => '?').join(', ')})` : ''}`
  ).all(...scoped) as Array<{ id: string; name: string; created_at: number }>
  return assignMcpServerKeys(rows.map(row => ({ id: row.id, name: row.name, createdAt: row.created_at })))
}
