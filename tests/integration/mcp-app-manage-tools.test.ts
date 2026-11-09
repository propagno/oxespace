import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { discoveryTools, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { APP_MANAGE_TOOLS, APP_MANAGE_TOOL_NAMES } from '../../electron/main/mcp-internal/app-manage-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [] }

function setup(app: ToolContext['app'], options: { decide?: ApprovalDecision; owner?: { kind: 'pane' | 'thread'; id: string }; workspaceId?: string; semantic?: unknown } = {}) {
  const asked: ApprovalRequest[] = []
  const broker = new ApprovalBroker({ ask: async request => { asked.push(request); return options.decide ?? 'allow-once' } }, Date.now, 50)
  const execution = { id: 'e1', owner: options.owner ?? { kind: 'pane', id: 'p1' }, workspaceId: options.workspaceId ?? WS.id, canonicalRoot: '/repo', cwd: '/repo' }
  const ctx = {
    workspaceId: execution.workspaceId, executionId: 'e1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => execution }, agentActions: new AgentActions({ broker }), app, semantic: options.semantic
  } as unknown as ToolContext
  return { asked, ctx }
}

async function call(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await APP_MANAGE_TOOLS.find(tool => tool.descriptor.name === name)!.handler(args, ctx)
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; result?: unknown }
}

describe('manage tools', () => {
  it('are offered to normal Threads only and never retried by the bridge', () => {
    const block = /const READ_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8'))![1]
    for (const name of APP_MANAGE_TOOL_NAMES) {
      expect(THREAD_MCP_TOOLS).toContain(name)
      expect(THREAD_READ_ONLY_MCP_TOOLS).not.toContain(name)
      expect(block).not.toContain(`'${name}'`)
    }
  })
})

describe('oxespace_skills_change', () => {
  it('shows the whole skill before saving it, in this project', async () => {
    const skills = { createSkill: vi.fn(input => ({ name: input.name, filePath: '/repo/.oxe/skills/x.md', source: 'workspace' })), listSkills: vi.fn() }
    const { asked, ctx } = setup({ skills } as never)
    expect(await call('oxespace_skills_change', { action: 'create', name: 'review-sql', description: 'Review SQL', body: 'Check indexes.' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('/review-sql — Review SQL\n\nCheck indexes.')
    expect(skills.createSkill).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workspace', workspaceRootPath: '/repo' }))
    const denied = setup({ skills } as never, { decide: 'deny' })
    skills.createSkill.mockClear()
    expect(await call('oxespace_skills_change', { action: 'create', name: 'x', description: 'x', body: 'x' }, denied.ctx)).toMatchObject({ ok: false, code: 'denied' })
    expect(skills.createSkill).not.toHaveBeenCalled()
  })
})

describe('oxespace_workspace_change', () => {
  it('notifies, and reindexes only a Code workspace', async () => {
    const notify = vi.fn(() => true)
    const semantic = { reindex: vi.fn(() => ({ indexing: true, enabled: true })) }
    expect(await call('oxespace_workspace_change', { action: 'notify', title: 'Build\ndone', body: 'All green' }, setup({ notify } as never).ctx)).toMatchObject({ ok: true, result: { shown: true } })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent', label: expect.objectContaining({ code: 'approvals.requester.unknownPane' }) }), 'Build done', 'All green')
    expect(await call('oxespace_workspace_change', { action: 'reindex' }, setup({} as never, { semantic }).ctx)).toMatchObject({ ok: true, result: { indexing: true } })
    expect(await call('oxespace_workspace_change', { action: 'reindex' }, setup({} as never, { semantic, owner: { kind: 'thread', id: 't' }, workspaceId: 'thread:p' }).ctx)).toMatchObject({ ok: false, code: 'no-workspace' })
  })

  it('refuses a notification that speaks as the app, and never shows it (B10)', async () => {
    const notify = vi.fn(() => true)
    for (const [title, body] of [['OXESpace: security update', 'Click to approve'], ['Ｏxe Code done', ''], ['Build done', 'OxeQuery approved this change'], ['System', '']]) {
      const result = await call('oxespace_workspace_change', { action: 'notify', title, body }, setup({ notify } as never).ctx)
      expect(result, title).toMatchObject({ ok: false, code: 'reserved-name' })
      expect((result as { message?: string }).message).toMatch(/belongs to the app/)
    }
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('oxespace_mcp_servers_change', () => {
  const servers = [
    { id: 's1', workspaceId: null, name: 'github', transport: 'stdio', trusted: true, tools: [] },
    { id: 's2', workspaceId: null, name: 'shady', transport: 'stdio', trusted: false, tools: [] },
    { id: 's0', workspaceId: null, name: 'oxespace', transport: 'stdio', trusted: true, tools: [] }
  ]
  const make = () => ({ list: vi.fn(() => servers), start: vi.fn(async () => [{ name: 'search' }]), stopRuntime: vi.fn() })

  it('starts a trusted server after asking, never an untrusted one or the OXESpace bridge', async () => {
    const mcpServers = make()
    const { asked, ctx } = setup({ mcpServers } as never)
    expect(await call('oxespace_mcp_servers_change', { action: 'start', serverId: 's1' }, ctx)).toMatchObject({ ok: true, result: { tools: ['search'] } })
    expect(asked[0].text).toBe('Start "github" (stdio)')
    expect(await call('oxespace_mcp_servers_change', { action: 'start', serverId: 's2' }, ctx)).toMatchObject({ ok: false, code: 'untrusted' })
    expect(await call('oxespace_mcp_servers_change', { action: 'stop', serverId: 's0' }, ctx)).toMatchObject({ ok: false, code: 'not-found' })
    expect(await call('oxespace_mcp_servers_change', { action: 'stop', serverId: 's1' }, ctx)).toMatchObject({ ok: true })
    expect(mcpServers.start).toHaveBeenCalledTimes(1)
  })
})

describe('discovery tools (R8 moved them from automation-tools.ts into tool-registry.ts)', () => {
  const tools = discoveryTools(() => tools)
  const registry = new ExecutionRegistry()
  const env = registry.register({ paneId: 'pane', workspaceId: 'workspace', cwd: '/checkout' })
  const context = { executions: registry, executionId: env.OXESPACE_EXECUTION_ID,
    executionToken: env.OXESPACE_EXECUTION_TOKEN, workspaceId: 'workspace',
    workspaceServ: { get: () => ({ panes: [{ id: 'pane' }] }) } } as unknown as ToolContext
  it('discovers tools without memory and does not disclose execution tokens', async () => {
    const result = await tools[0].handler({}, context)
    const serialized = JSON.stringify(result)
    expect(result.isError).toBeUndefined()
    expect(serialized).toContain('oxespace_execution_context')
    expect(serialized).not.toContain(env.OXESPACE_EXECUTION_TOKEN)
  })
  it('rejects foreign workspace and argument overrides', async () => {
    expect((await tools[0].handler({}, { ...context, workspaceId: 'foreign' })).isError).toBe(true)
    expect((await tools[0].handler({ workspaceId: 'foreign' }, context)).isError).toBe(true)
  })
  it('unbound memory is not reported as captured data', async () => {
    const result = await tools[2].handler({}, context)
    expect(JSON.stringify(result)).toContain('not_observable')
    expect(JSON.stringify(result)).toContain('unbound')
  })
  it('revoked executions cannot discover capabilities', async () => {
    const executions = new ExecutionRegistry()
    const credentials = executions.register({ paneId: 'pane', workspaceId: 'workspace', cwd: '/checkout' })
    executions.end('pane')
    const result = await tools[0].handler({}, { ...context, executions,
      executionId: credentials.OXESPACE_EXECUTION_ID, executionToken: credentials.OXESPACE_EXECUTION_TOKEN })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('EXECUTION_REQUIRED')
  })
})

// Homologation check-182: a caller the bridge does not answer for got "ok" for any group, nonsense included.
describe('oxespace_tools_enable on the server', () => {
  const enable = discoveryTools(() => []).find(tool => tool.descriptor.name === 'oxespace_tools_enable')!
  const body = async (args: unknown) => {
    const result = await enable.handler(args as never, {} as never)
    return { isError: (result as { isError?: boolean }).isError === true, ...JSON.parse((result as { content: Array<{ text: string }> }).content[0].text) }
  }

  it('refuses anything that is not one known group, with a code', async () => {
    for (const args of [undefined, {}, { group: 7 }, { group: 'data', extra: 1 }, []]) {
      expect(await body(args), JSON.stringify(args)).toMatchObject({ isError: true, status: 'error', error: { code: 'INVALID_ARGUMENTS' } })
    }
    for (const group of ['search', 'no-such-group', '../../etc', 'team']) {
      expect(await body({ group }), group).toMatchObject({ isError: true, status: 'error', error: { code: 'GROUP_UNAVAILABLE' } })
    }
  })

  it('a known group says there is nothing to turn on here, without claiming success for it', async () => {
    expect(await body({ group: 'data' })).toMatchObject({ isError: false, status: 'ok', data: { enabled: [] } })
  })
})
