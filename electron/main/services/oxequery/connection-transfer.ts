import type { OxeQueryConnection, OxeQueryConnectionInput } from '../../../../shared/types/oxequery'

const MAX_IMPORT = 200

/**
 * Connections as a file a person can keep or share. Everything needed to reconnect except secrets:
 * no password, key, certificate or SSH secret is written, so a file is safe to send around and each
 * person adds their own.
 */
export function exportConnections(connections: OxeQueryConnection[]): string {
  return JSON.stringify({
    format: 'oxequery-connections', v: 1,
    connections: connections.filter(item => !item.ephemeral).map(item => ({
      name: item.name, engine: item.engine, host: item.host, port: item.port, database: item.database, username: item.username, sslMode: item.sslMode,
      readOnly: item.readOnly, environment: item.environment, mongo: item.mongo,
      ...(item.ssh ? { ssh: { enabled: true, host: item.ssh.host, port: item.ssh.port, user: item.ssh.user, auth: item.ssh.auth } } : {}),
      statementTimeoutMs: item.statementTimeoutMs, maxRows: item.maxRows, group: item.group, favorite: item.favorite, color: item.color,
      maskPatterns: item.maskPatterns, keepaliveSeconds: item.keepaliveSeconds
    }))
  }, null, 2)
}

/**
 * The connections in an exported file, as inputs for the store (which validates them again). Agents
 * start switched off whatever the file says. A connection through a tunnel that needs a key or a password
 * is skipped (it cannot be saved without the secret the file does not carry); the SSH agent needs none.
 */
export function parseConnectionsFile(text: string): { inputs: OxeQueryConnectionInput[]; skipped: number } {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('That file is not a connections export (it is not valid JSON).') }
  const file = value as { format?: unknown; connections?: unknown }
  if (!file || file.format !== 'oxequery-connections' || !Array.isArray(file.connections)) throw new Error('That file is not a connections export from OxeQuery.')
  const entries = file.connections.slice(0, MAX_IMPORT) as Record<string, unknown>[]
  const usable = entries.filter(entry => !entry.ssh || (entry.ssh as { auth?: string }).auth === 'agent')
  const inputs = usable.map((entry): OxeQueryConnectionInput => {
    const ssh = entry.ssh as { host?: string; port?: number; user?: string; auth?: 'key' | 'password' | 'agent' } | undefined
    return {
      name: String(entry.name ?? ''), engine: entry.engine as OxeQueryConnectionInput['engine'], host: String(entry.host ?? ''), port: Number(entry.port),
      database: String(entry.database ?? ''), username: String(entry.username ?? ''), sslMode: entry.sslMode as OxeQueryConnectionInput['sslMode'],
      readOnly: entry.readOnly !== false, environment: entry.environment as OxeQueryConnectionInput['environment'], mongo: entry.mongo as OxeQueryConnectionInput['mongo'],
      ...(ssh?.auth === 'agent' ? { ssh: { enabled: true, host: ssh.host, port: ssh.port, user: ssh.user, auth: 'agent' as const } } : {}),
      statementTimeoutMs: Number(entry.statementTimeoutMs) || undefined, maxRows: Number(entry.maxRows) || undefined,
      group: String(entry.group ?? ''), favorite: entry.favorite === true, color: entry.color as OxeQueryConnectionInput['color'],
      maskPatterns: Array.isArray(entry.maskPatterns) ? entry.maskPatterns.map(String) : [], keepaliveSeconds: typeof entry.keepaliveSeconds === 'number' ? entry.keepaliveSeconds : undefined,
      agentAccess: 'off'
    }
  })
  return { inputs, skipped: entries.length - usable.length }
}
