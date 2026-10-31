import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../electron/main/db/index'
import { codeAgentMcpLaunch } from '../../electron/main/services/agent-launch.service'
import { agentStatusFor } from '../../src/components/MCP/mcpAgentStatus'

function dbWith(rows: Array<{ name: string; workspace_id: string | null; config: unknown }>): AppDatabase {
  return { prepare: () => ({ all: () => rows.map(row => ({ name: row.name, workspace_id: row.workspace_id, config_json: JSON.stringify(row.config) })) }) } as unknown as AppDatabase
}

const db = dbWith([
  { name: 'GitHub', workspace_id: null, config: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_secret' } } },
  { name: 'Playwright', workspace_id: 'w1', config: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {} } }
])

describe('MCP servers for an agent started in a Code terminal', () => {
  it('hands Codex the OXESpace servers as overrides, with the token only in the environment', () => {
    const launch = codeAgentMcpLaunch(db, 'codex', '/bridge.cjs', 'w1', ['resume'])
    const text = launch.args.join(' ')
    expect(text).toContain('mcp_servers.oxespace-delegation.command="node"')
    expect(text).toContain('mcp_servers.github.url="https://api.githubcopilot.com/mcp/"')
    expect(text).toContain('mcp_servers.playwright.args=')
    expect(text).not.toContain('ghp_secret')
    expect(Object.values(launch.env ?? {})).toContain('Bearer ghp_secret')
    // The person's own arguments stay last, after the overrides.
    expect(launch.args.at(-1)).toBe('resume')
  })

  it('leaves Claude to the workspace .mcp.json', () => {
    const launch = codeAgentMcpLaunch(db, 'claude', '/bridge.cjs', 'w1', [])
    expect(launch.args.join(' ')).not.toContain('github')
    expect(launch.env).toBeUndefined()
  })

  it('still starts the agent when the servers cannot be read', () => {
    const broken = { prepare: () => { throw new Error('db closed') } } as unknown as AppDatabase
    expect(codeAgentMcpLaunch(broken, 'codex', '/bridge.cjs', 'w1', ['x']).args.at(-1)).toBe('x')
  })
})

describe('whether the agent connected', () => {
  it('matches a server by the key it is launched under', () => {
    const conversation = [{ name: 'github', status: 'connected' as const }, { name: 'my-db', status: 'failed' as const }]
    expect(agentStatusFor('GitHub', conversation)).toBe('connected')
    expect(agentStatusFor('My DB', conversation)).toBe('failed')
    expect(agentStatusFor('linear', conversation)).toBe('not-loaded')
    expect(agentStatusFor('github', undefined)).toBe('not-checked')
  })
})
