import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { AGENT_CHANGE_TOOLS, AGENT_READ_TOOLS, _resetAgentOwnersForTests } from '../../electron/main/mcp-internal/agent-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'
import type { AgentLifecycleState, PaneAgentState } from '../../shared/types/agent-state'

const workspace = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [{ id: 'me', displayName: null }, { id: 'user-pane', displayName: 'Mine' }] }

function harness(options: { caller?: string } = {}) {
  const states = new Map<string, AgentLifecycleState>([['user-pane', 'idle']])
  const asked: ApprovalRequest[] = []
  const state = (paneId: string): PaneAgentState | null => states.has(paneId) ? { paneId, workspaceId: 'ws-1', agent: 'claude', state: states.get(paneId)!, source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 } : null
  const submit = vi.fn(async (paneId: string) => { states.set(paneId, 'working'); return true })
  const agents = {
    state: {
      list: () => [...states.keys()].map(id => state(id)!),
      get: state,
      explain: (paneId: string) => ({ state: state(paneId) }),
      waitFor: vi.fn(async (paneId: string, until: AgentLifecycleState[]) => ({ state: state(paneId), timedOut: !until.includes(states.get(paneId)!) }))
    },
    terminal: { peek: () => ({ running: true, altScreen: false, data: 'hello \u001b[1mworld\u001b[0m token=abc' }), submit, interrupt: vi.fn(async () => true), start: vi.fn(async (input: { paneId: string }) => { states.set(input.paneId, 'idle') }), stop: vi.fn() },
    profiles: () => [{ agentProfileId: 'claude-1', provider: 'claude', name: 'Claude' }],
    resolve: () => ({ executable: 'claude', provider: 'claude' }),
    mcpArgs: () => ['--mcp-config', '{}'],
    createPane: () => { workspace.panes.push({ id: 'helper', displayName: null }); return { workspace, paneId: 'helper' } },
    setPaneAgent: () => workspace,
    closePane: vi.fn(() => workspace),
    workspaceChanged: vi.fn()
  }
  const execution = { id: 'exec-1', owner: { kind: 'pane', id: options.caller ?? 'me' }, workspaceId: 'ws-1', canonicalRoot: '/repo', cwd: '/repo' }
  const ctx = {
    workspaceId: 'ws-1', executionId: 'exec-1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === 'ws-1' ? workspace : null, list: () => [workspace] },
    executions: { authenticate: () => execution },
    agentActions: new AgentActions({ broker: new ApprovalBroker({ ask: async request => { asked.push(request); return 'allow-once' } }, Date.now, 50) }),
    app: { agents }
  } as unknown as ToolContext
  return { ctx, agents, states, asked }
}

async function call(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const tool = [...AGENT_READ_TOOLS, ...AGENT_CHANGE_TOOLS].find(entry => entry.descriptor.name === name)!
  const result = await tool.handler(args, ctx)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; result?: any }
}

afterEach(() => { _resetAgentOwnersForTests(); workspace.panes = workspace.panes.filter(pane => pane.id !== 'helper') })

describe('agent tools', () => {
  it('stay out of Threads (Code workspaces only) and out of the bridge retry list', () => {
    const block = /const READ_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8'))![1]
    for (const name of ['oxespace_agents', 'oxespace_agents_change']) {
      expect(THREAD_MCP_TOOLS).not.toContain(name)
      expect(THREAD_READ_ONLY_MCP_TOOLS).not.toContain(name)
      expect(block).not.toContain(`'${name}'`)
    }
  })

  it('lists agents and reads a pane cleaned and masked', async () => {
    const { ctx } = harness()
    expect((await call('oxespace_agents', { action: 'list' }, ctx)).result[0]).toMatchObject({ paneId: 'user-pane', state: 'idle', name: 'Mine', startedByYou: false })
    expect((await call('oxespace_agents', { action: 'read', paneId: 'user-pane' }, ctx)).result.text).toBe('hello world token=***')
  })

  it('starts a helper, then prompts it without asking and waits for it', async () => {
    const { ctx, agents, asked } = harness()
    const started = await call('oxespace_agents_change', { action: 'start', agent: 'claude', model: 'sonnet' }, ctx)
    expect(started).toMatchObject({ ok: true, result: { paneId: 'helper', ready: true } })
    expect(agents.terminal.start).toHaveBeenCalledWith({ paneId: 'helper', workspaceId: 'ws-1', launch: { executable: 'claude', args: ['--mcp-config', '{}', '--model', 'sonnet'] } })
    expect(agents.workspaceChanged).toHaveBeenCalled()
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'helper', text: 'Review the diff' }, ctx)).toMatchObject({ ok: true, result: { submitted: true } })
    expect(asked).toHaveLength(0)
    expect(agents.terminal.submit).toHaveBeenCalledWith('helper', 'Review the diff')
  })

  it('asks the person before prompting a pane it did not start', async () => {
    const { ctx, asked } = harness()
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'user-pane', text: 'hi' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0]).toMatchObject({ summary: 'pane:me wants to send a prompt to the agent in "Mine"', text: 'hi' })
  })

  it('never writes to a blocked agent, its own pane, or with a bad model', async () => {
    const { ctx, states, agents } = harness()
    states.set('user-pane', 'blocked')
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'user-pane', text: 'yes' }, ctx)).toMatchObject({ ok: false, code: 'agent_blocked' })
    expect(await call('oxespace_agents_change', { action: 'interrupt', paneId: 'user-pane' }, ctx)).toMatchObject({ ok: false, code: 'agent_blocked' })
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'me', text: 'x' }, ctx)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await call('oxespace_agents_change', { action: 'start', agent: 'claude', model: '--dangerously-skip-permissions' }, ctx)).toMatchObject({ ok: false, code: 'invalid' })
    expect(agents.terminal.submit).not.toHaveBeenCalled()
  })

  it('closes only panes it started', async () => {
    const { ctx, agents } = harness()
    expect(await call('oxespace_agents_change', { action: 'close_pane', paneId: 'user-pane' }, ctx)).toMatchObject({ ok: false, code: 'not-owner' })
    await call('oxespace_agents_change', { action: 'start', agent: 'claude' }, ctx)
    expect(await call('oxespace_agents_change', { action: 'close_pane', paneId: 'helper' }, ctx)).toMatchObject({ ok: true })
    expect(agents.terminal.stop).toHaveBeenCalledWith({ paneId: 'helper' })
  })

  it('reports a prompt that showed no activity instead of claiming it ran', async () => {
    const { ctx, agents } = harness()
    agents.terminal.submit.mockImplementationOnce(async () => true)
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'user-pane', text: 'hi' }, ctx)).toMatchObject({ ok: true, result: { submitted: true, stalled: true } })
  })
})
