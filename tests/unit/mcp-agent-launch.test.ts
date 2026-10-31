import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../../electron/main/db/index'
import { codeAgentMcpLaunch } from '../../electron/main/services/agent-launch.service'
import { agentStatusFor } from '../../src/components/MCP/mcpAgentStatus'
import { CODE_START_TOOLS, CODE_TOOL_GROUP, MCP_TOOL_GROUPS } from '../../electron/main/services/conversation/thread-mcp'

function dbWith(rows: Array<{ name: string; workspace_id: string | null; config: unknown }>, rootPath?: string): AppDatabase {
  return { prepare: () => ({
    all: () => rows.map(row => ({ name: row.name, workspace_id: row.workspace_id, config_json: JSON.stringify(row.config) })),
    get: () => rootPath ? { root_path: rootPath } : undefined
  }) } as unknown as AppDatabase
}

/** The bridge arguments a launch hands the agent, whichever way the provider takes them. */
function bridgeOf(args: string[]): string[] {
  const claude = args.indexOf('--mcp-config')
  if (claude >= 0) return (JSON.parse(args[claude + 1]) as { mcpServers: Record<string, { args: string[] }> }).mcpServers['oxespace-delegation'].args
  const codex = args.find(arg => arg.startsWith('mcp_servers.oxespace-delegation.args='))!
  return JSON.parse(codex.slice('mcp_servers.oxespace-delegation.args='.length)) as string[]
}
const allowed = (args: string[]) => JSON.parse(bridgeOf(args)[bridgeOf(args).indexOf('--allowed-tools') + 1]) as string[]
const enableable = (args: string[]) => { const bridge = bridgeOf(args), at = bridge.indexOf('--enableable-groups'); return at < 0 ? {} : JSON.parse(bridge[at + 1]) as Record<string, string[]> }

const project = mkdtempSync(join(tmpdir(), 'oxe-launch-'))
afterAll(() => rmSync(project, { recursive: true, force: true }))

const db = dbWith([
  { name: 'GitHub', workspace_id: null, config: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_secret' } } },
  { name: 'Playwright', workspace_id: 'w1', config: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {} } }
])

describe('MCP servers for an agent started in a Code terminal', () => {
  it('hands Codex the OXESpace servers as overrides, with the token only in the environment', async () => {
    const launch = await codeAgentMcpLaunch(db, 'codex', '/bridge.cjs', 'w1', ['resume'], {})
    const text = launch.args.join(' ')
    expect(text).toContain('mcp_servers.oxespace-delegation.command="node"')
    expect(text).toContain('mcp_servers.github.url="https://api.githubcopilot.com/mcp/"')
    expect(text).toContain('mcp_servers.playwright.args=')
    expect(text).not.toContain('ghp_secret')
    expect(Object.values(launch.env ?? {})).toContain('Bearer ghp_secret')
    // The person's own arguments stay last, after the overrides.
    expect(launch.args.at(-1)).toBe('resume')
  })

  it('leaves the person\'s own servers to Claude\'s .mcp.json, and turns on tool search unless the person set it', async () => {
    const launch = await codeAgentMcpLaunch(db, 'claude', '/bridge.cjs', 'w1', [], {})
    expect(Object.keys((JSON.parse(launch.args[launch.args.indexOf('--mcp-config') + 1]) as { mcpServers: object }).mcpServers)).toEqual(['oxespace-delegation'])
    // OXESPACE_PANE_BRIDGE: the .mcp.json entry Claude also loads steps aside, so the pane has one OXESpace server.
    const token = expect.stringMatching(/^[0-9a-f-]{36}$/)
    expect(launch.env).toEqual({ ENABLE_TOOL_SEARCH: 'true', OXESPACE_PANE_BRIDGE: token })
    const plain = await codeAgentMcpLaunch(db, 'claude', '/bridge.cjs', 'w1', [], { ENABLE_TOOL_SEARCH: 'false' })
    expect(plain.env).toEqual({ OXESPACE_PANE_BRIDGE: token })
    // A fresh token per launch: one launch's claim never silences another's entry.
    expect(plain.env?.OXESPACE_PANE_BRIDGE).not.toBe(launch.env?.OXESPACE_PANE_BRIDGE)
  })

  it('asks the .mcp.json entry to step aside only for Claude, which loads it next to its own bridge', async () => {
    expect((await codeAgentMcpLaunch(db, 'codex', '/bridge.cjs', 'w1', [], {})).env).not.toHaveProperty('OXESPACE_PANE_BRIDGE')
    // Copilot gets no bridge of its own here: the .mcp.json entry is its only OXESpace server.
    expect((await codeAgentMcpLaunch(db, 'copilot', '/bridge.cjs', 'w1', [], {})).env).not.toHaveProperty('OXESPACE_PANE_BRIDGE')
  })

  it('still starts the agent when the servers cannot be read', async () => {
    const broken = { prepare: () => { throw new Error('db closed') } } as unknown as AppDatabase
    expect((await codeAgentMcpLaunch(broken, 'codex', '/bridge.cjs', 'w1', ['x'], {})).args.at(-1)).toBe('x')
  })
})

describe('OXESpace tools for an agent in a Code terminal (B2.2)', () => {
  const thread = (group: keyof typeof MCP_TOOL_GROUPS) => [...MCP_TOOL_GROUPS[group]]

  it('gives Claude the same groups as an OxeChat conversation with tool search, plus the Code terminal\'s own', async () => {
    const tools = allowed((await codeAgentMcpLaunch(db, 'claude', '/bridge.cjs', 'w1', [], {})).args)
    expect(new Set(tools)).toEqual(new Set([...thread('core'), ...CODE_TOOL_GROUP, ...thread('orchestration'), ...thread('data'), ...thread('docs'), ...thread('app')]))
    expect(tools).not.toContain('oxespace_team_inbox')
    expect(tools).not.toContain('oxespace_delegation_update')
  })

  it('gives Codex every group that is not off from the start, since it loads definitions as it needs them', async () => {
    const args = (await codeAgentMcpLaunch(db, 'codex', '/bridge.cjs', 'w1', [], {})).args
    expect(new Set(allowed(args))).toEqual(new Set([...thread('core'), ...CODE_TOOL_GROUP, ...thread('orchestration'), ...thread('data'), ...thread('docs'), ...thread('app')]))
    expect(allowed(args)).not.toContain('oxespace_tools_enable')
    expect(enableable(args)).toEqual({})
  })

  it('gives Claude without tool search core, the Code terminal\'s start tools and the enable tool for the rest (T8)', async () => {
    const args = (await codeAgentMcpLaunch(db, 'claude', '/bridge.cjs', 'w1', [], { ENABLE_TOOL_SEARCH: 'false' })).args
    expect(allowed(args)).toEqual([...thread('core'), ...CODE_START_TOOLS, 'oxespace_tools_enable'])
    expect(Object.keys(enableable(args)).sort()).toEqual(['app', 'code', 'data', 'docs', 'orchestration'])
    expect(new Set([...CODE_START_TOOLS, ...enableable(args).code])).toEqual(new Set(CODE_TOOL_GROUP))
  })

  it('follows the project\'s modes in oxe.yaml', async () => {
    writeFileSync(join(project, 'oxe.yaml'), 'thread:\n  tools:\n    data: off\n    docs: always\n')
    const inProject = dbWith([], project)
    const claude = allowed((await codeAgentMcpLaunch(inProject, 'claude', '/bridge.cjs', 'w1', [], {})).args)
    expect(claude).not.toContain('oxespace_db_query')
    expect(claude).toContain('oxespace_open_web_preview')
    const codex = allowed((await codeAgentMcpLaunch(inProject, 'codex', '/bridge.cjs', 'w1', [], {})).args)
    expect(codex).toEqual(expect.arrayContaining([...thread('docs'), ...thread('app'), ...thread('orchestration')]))
    expect(codex).not.toContain('oxespace_db_query')
    const noSearch = (await codeAgentMcpLaunch(inProject, 'claude', '/bridge.cjs', 'w1', [], { ENABLE_TOOL_SEARCH: 'false' })).args
    expect(allowed(noSearch)).toEqual(expect.arrayContaining(thread('docs')))
    expect(Object.keys(enableable(noSearch)).sort()).toEqual(['app', 'code', 'orchestration'])
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
