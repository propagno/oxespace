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

describe('Thread managed MCP servers across project workspaces (real database)', () => {
  it('includes servers scoped to every workspace of the project and lets them shadow a global one', async () => {
    const { openInMemoryDatabase } = await import('../../electron/main/db/index')
    const db = openInMemoryDatabase()
    try {
      for (const id of ['w1', 'w2', 'other']) db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', 'builtin-claude')").run(id, id, `/root-${id}`)
      const insert = db.prepare('INSERT INTO mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      const stdio = (command: string) => JSON.stringify({ transport: 'stdio', command, args: [] })
      insert.run('g1', null, 'Docs', 'stdio', stdio('global-docs'), 1, 1, 1, 1)
      insert.run('g2', null, 'Search', 'stdio', stdio('global-search'), 1, 1, 2, 2)
      insert.run('s1', 'w1', 'Docs', 'stdio', stdio('project-docs'), 1, 1, 3, 3)
      insert.run('s2', 'w2', 'Tracker', 'stdio', stdio('tracker'), 1, 1, 4, 4)
      insert.run('s3', 'other', 'Elsewhere', 'stdio', stdio('elsewhere'), 1, 1, 5, 5)
      insert.run('s4', 'w1', 'Untrusted', 'stdio', stdio('untrusted'), 1, 0, 6, 6)

      const managed = readManagedMcp(db, ['thread:project', 'w1', 'w2'], 'linux')
      const commands = managed.servers.map(server => server.command)
      expect(commands).toEqual(['global-search', 'project-docs', 'tracker'])
      expect(readManagedMcp(db, 'thread:project', 'linux').servers.map(server => server.command)).toEqual(['global-docs', 'global-search'])
    } finally { db.close() }
  })
})
