import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../electron/main/db/index'
import { readManagedMcp } from '../../electron/main/services/conversation/thread-managed-mcp'
import { threadMcpArguments } from '../../electron/main/services/conversation/thread-mcp'

function dbWith(rows: Array<{ name: string; workspace_id: string | null; config: unknown }>): AppDatabase {
  return { prepare: () => ({ all: () => rows.map(row => ({ name: row.name, workspace_id: row.workspace_id, config_json: JSON.stringify(row.config) })) }) } as unknown as AppDatabase
}

const rows = [
  { name: 'GitHub', workspace_id: null, config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' } } },
  { name: 'Linear', workspace_id: 'w1', config: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin_secret' } } },
  { name: 'oxespace', workspace_id: null, config: { transport: 'stdio', command: 'node', args: ['bridge.cjs'] } },
  { name: 'Shadow', workspace_id: 'w1', config: { transport: 'stdio', command: 'x', args: [], env: { PATH: '/evil' } } }
]

describe('Thread managed MCP servers', () => {
  it('skips the internal bridge and keeps secrets out of the arguments', () => {
    const managed = readManagedMcp(dbWith(rows), 'w1', 'linux')
    expect(managed.servers.map(server => server.key)).toEqual(['github', 'linear', 'shadow'])
    // Reserved names are namespaced so they cannot change the agent's own environment.
    expect(managed.servers[2].env.PATH).toBe('OXE_MCP_SHADOW_PATH')
    expect(managed.env.PATH).toBeUndefined()
    expect(managed.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_secret')

    for (const provider of ['claude', 'codex'] as const) {
      const text = threadMcpArguments(provider, [], '/bridge.cjs', managed).join(' ')
      expect(text).not.toContain('ghp_secret')
      expect(text).not.toContain('lin_secret')
    }
    // Codex cannot rename a forwarded variable, so a reserved name is the one case written inline.
    expect(threadMcpArguments('claude', [], '/bridge.cjs', managed).join(' ')).not.toContain('/evil')
  })

  it('attaches the servers to Claude through --mcp-config next to the bridge', () => {
    const managed = readManagedMcp(dbWith(rows), 'w1', 'linux')
    const args = threadMcpArguments('claude', ['--tools', 'default'], '/bridge.cjs', managed)
    const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as { mcpServers: Record<string, Record<string, unknown>> }
    expect(Object.keys(config.mcpServers)).toEqual(expect.arrayContaining(['github', 'linear', 'oxespace-delegation']))
    expect(config.mcpServers.github).toMatchObject({ command: 'npx', env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' } })
    expect(config.mcpServers.linear).toMatchObject({ type: 'http', url: 'https://mcp.linear.app/mcp' })
  })

  it('attaches the servers to Codex with -c overrides and forwards variables by name', () => {
    const managed = readManagedMcp(dbWith(rows), 'w1', 'linux')
    const args = threadMcpArguments('codex', ['app-server'], '/bridge.cjs', managed)
    expect(args).toContain('mcp_servers.github.command="npx"')
    expect(args).toContain('mcp_servers.github.env_vars=["GITHUB_PERSONAL_ACCESS_TOKEN"]')
    expect(args).toContain('mcp_servers.linear.url="https://mcp.linear.app/mcp"')
    expect(args.at(-1)).toBe('app-server')
  })

  it('runs npx through cmd /c on Windows so agent CLIs can spawn it', () => {
    const windows = readManagedMcp(dbWith(rows), 'w1', 'win32')
    expect(windows.servers[0]).toMatchObject({ command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-github'] })
    expect(readManagedMcp(dbWith(rows), 'w1', 'linux').servers[0]).toMatchObject({ command: 'npx' })
    expect(threadMcpArguments('codex', [], '/bridge.cjs', windows)).toContain('mcp_servers.github.command="cmd"')
  })

  it('is a no-op without managed servers', () => {
    expect(threadMcpArguments('codex', ['app-server'], '/bridge.cjs')).toEqual(threadMcpArguments('codex', ['app-server'], '/bridge.cjs', { servers: [], env: {} }))
  })
})
