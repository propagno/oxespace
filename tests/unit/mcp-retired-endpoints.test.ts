import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../electron/main/db/index'
import { unbridgeRemoteMcpServers, upgradeRetiredMcpEndpoints } from '../../electron/main/services/mcp-retired-endpoints'

function dbWith(rows: Array<{ id: string; config: unknown }>) {
  const updates: Array<{ id: string; config: unknown; at: number }> = []
  const db = {
    prepare: (sql: string) => sql.startsWith('SELECT')
      ? { all: () => rows.map(row => ({ id: row.id, config_json: typeof row.config === 'string' ? row.config : JSON.stringify(row.config) })) }
      : { run: (json: string, at: number, id: string) => { updates.push({ id, config: JSON.parse(json), at }) } }
  } as unknown as AppDatabase
  return { db, updates }
}

describe('retired MCP endpoints', () => {
  it('points saved servers at the current endpoint and leaves everything else alone', () => {
    const { db, updates } = dbWith([
      { id: 'linear', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/sse'], env: { A: '1' } } },
      { id: 'cloudflare', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://docs.mcp.cloudflare.com/sse'] } },
      // Edited by the person, or already current: untouched.
      { id: 'custom', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/sse?team=x'] } },
      { id: 'current', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'] } },
      { id: 'broken', config: '{not json' }
    ])
    expect(upgradeRetiredMcpEndpoints(db, 42)).toBe(2)
    expect(updates).toEqual([
      { id: 'linear', at: 42, config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'], env: { A: '1' } } },
      { id: 'cloudflare', at: 42, config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://docs.mcp.cloudflare.com/mcp'] } }
    ])
  })

  it('turns a bare mcp-remote bridge into the remote server it bridges', () => {
    const updates: unknown[][] = []
    const rows = [
      { id: 'linear', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.linear.app/mcp'], env: {} } },
      { id: 'asana', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.asana.com/sse'] } },
      // A bridge with its own flags or variables (a static token, a port) is kept as the person set it up.
      { id: 'flags', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://x.test/mcp', '--header', 'A:b'] } },
      { id: 'env', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://x.test/mcp'], env: { TOKEN: 't' } } },
      { id: 'plain', config: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] } }
    ]
    const db = {
      prepare: (sql: string) => sql.startsWith('SELECT')
        ? { all: () => rows.map(row => ({ id: row.id, config_json: JSON.stringify(row.config) })) }
        : { run: (...args: unknown[]) => { updates.push(args) } }
    } as unknown as AppDatabase
    expect(unbridgeRemoteMcpServers(db, 7)).toBe(2)
    expect(updates).toEqual([
      ['http', JSON.stringify({ transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} }), 7, 'linear'],
      ['sse', JSON.stringify({ transport: 'sse', url: 'https://mcp.asana.com/sse', headers: {} }), 7, 'asana']
    ])
  })
})
