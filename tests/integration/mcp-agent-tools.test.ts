import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { AGENT_CHANGE_TOOLS, AGENT_READ_TOOLS, _resetAgentOwnersForTests } from '../../electron/main/mcp-internal/agent-tools'
import { APP_READ_TOOLS } from '../../electron/main/mcp-internal/app-read-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import type { ActionAudit, ActionAuditRecord } from '../../electron/main/services/agent-actions/action-audit'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { centerApprovalPrompter } from '../../electron/main/services/agent-actions/approval-prompter'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'
import type { AgentLifecycleState, PaneAgentState } from '../../shared/types/agent-state'
import type { ApprovalRequest as CenterApprovalRequest } from '../../shared/types/approvals'
import { IPC_CHANNELS } from '../../shared/types/ipc'

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
  const tool = [...AGENT_READ_TOOLS, ...AGENT_CHANGE_TOOLS, ...APP_READ_TOOLS].find(entry => entry.descriptor.name === name)!
  const result = await tool.handler(args, ctx)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; message?: string; result?: any }
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
    expect(asked[0]).toMatchObject({ summary: expect.objectContaining({ code: 'approvals.summary.mcpConfirm', params: expect.objectContaining({ tool: 'oxespace_agents_change', action: 'prompt' }) }), text: 'hi', notes: [{ code: 'approvals.note.agent.actsOnPrompt', params: {} }] })
    // The pane name ("Mine") is never what the person sees as the requester.
    expect(asked[0].requester).toMatchObject({ kind: 'agent', id: 'pane:me', label: { code: 'approvals.requester.unknownPane' } })
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

  it('refuses a pane named like the app before the pane exists (B10)', async () => {
    const { ctx, agents } = harness()
    for (const name of ['OXESpace', 'oxe space', 'OXESp\u0430ce', 'OxeQuery agent', 'Sistema']) {
      const result = await call('oxespace_agents_change', { action: 'start', agent: 'claude', name }, ctx)
      expect(result, name).toMatchObject({ ok: false, code: 'reserved-name' })
    }
    expect(workspace.panes.some(pane => pane.id === 'helper')).toBe(false)
    expect(agents.terminal.start).not.toHaveBeenCalled()
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

  it('oxespace_agents_change prompt delivers text to another provider pane (including antigravity/agy) on approval and writes nothing on denial', async () => {
    const ws = {
      id: 'ws-multi', rootPath: '/repo', name: 'oxe-build', isActive: true,
      panes: [
        { id: 'caller-claude', displayName: 'Claude', status: 'running', agentProfileId: 'p-claude', rowIndex: 0, columnIndex: 0 },
        { id: 'agy-pane', displayName: 'Antigravity', status: 'running', agentProfileId: 'p-agy', rowIndex: 0, columnIndex: 1 },
        { id: 'gemini-pane', displayName: 'Gemini Helper', status: 'running', agentProfileId: null, rowIndex: 1, columnIndex: 0 },
        { id: 'stopped-agy', displayName: 'Stopped AGY', status: 'exited', agentProfileId: 'p-agy', rowIndex: 1, columnIndex: 1 }
      ]
    }
    const states = new Map<string, PaneAgentState>([
      ['gemini-pane', { paneId: 'gemini-pane', workspaceId: ws.id, agent: 'gemini', state: 'idle', source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }]
    ])
    let nextDecision: ApprovalDecision = 'deny'
    const asked: ApprovalRequest[] = []
    const submit = vi.fn(async (paneId: string) => {
      const current = states.get(paneId)
      if (current) states.set(paneId, { ...current, state: 'working' })
      return true
    })
    const agents = {
      state: {
        list: (workspaceId?: string) => [...states.values()].filter(s => !workspaceId || s.workspaceId === workspaceId),
        get: (paneId: string) => states.get(paneId) ?? null,
        agentOf: (paneId: string) => paneId === 'agy-pane' ? 'antigravity' : null,
        explain: (paneId: string) => ({ state: states.get(paneId) ?? null }),
        waitFor: vi.fn(async (paneId: string, until: AgentLifecycleState[]) => {
          const s = states.get(paneId) ?? null
          return { state: s, timedOut: !s || !until.includes(s.state) }
        })
      },
      terminal: {
        peek: vi.fn((paneId: string) => paneId === 'stopped-agy' ? null : { running: true, altScreen: false, data: 'ready\n' }),
        submit, interrupt: vi.fn(async () => true), start: vi.fn(), stop: vi.fn()
      },
      profiles: () => [
        { agentProfileId: 'p-claude', provider: 'claude', name: 'Claude', command: 'claude', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'p-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy', commandTemplate: '', isBuiltin: true }
      ],
      resolve: () => ({ executable: 'claude', provider: 'claude' }),
      mcpArgs: () => [],
      createPane: () => ({ workspace: ws, paneId: 'new' }),
      setPaneAgent: () => ws,
      closePane: () => ws,
      workspaceChanged: vi.fn()
    }
    const ctx = {
      workspaceId: ws.id, executionId: 'exec-multi', executionToken: 'tok',
      workspaceServ: { get: (id: string) => id === ws.id ? ws : null, list: () => [ws] },
      executions: { authenticate: () => ({ id: 'exec-multi', owner: { kind: 'pane', id: 'caller-claude' }, workspaceId: ws.id, canonicalRoot: '/repo', cwd: '/repo' }) },
      agentActions: new AgentActions({ broker: new ApprovalBroker({ ask: async req => { asked.push(req); return nextDecision } }, Date.now, 50) }),
      app: { agents }
    } as unknown as ToolContext

    // Denial writes 0 bytes and shows destination provider/position, full text, and unknown-state warning (RT-3).
    const denied = await call('oxespace_agents_change', { action: 'prompt', paneId: 'agy-pane', text: 'Run integration checks' }, ctx)
    expect(denied).toMatchObject({ ok: false, code: 'denied' })
    expect(submit).toHaveBeenCalledTimes(0)
    expect(asked[0]).toMatchObject({
      target: 'Antigravity · pane 2',
      text: 'Run integration checks',
      notes: [
        { code: 'approvals.note.agent.actsOnPrompt', params: {} },
        { code: 'approvals.note.agent.unknownState', params: {} }
      ]
    })

    // Approval delivers the exact prompt text once (1 PTY write).
    nextDecision = 'allow-once'
    const approved = await call('oxespace_agents_change', { action: 'prompt', paneId: 'agy-pane', text: 'Run integration checks now' }, ctx)
    expect(approved).toMatchObject({ ok: true, result: { submitted: true, provider: 'antigravity' } })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith('agy-pane', 'Run integration checks now')

    // Another provider with a manifest (gemini) shows name, provider and position without unknown-state note.
    const geminiResult = await call('oxespace_agents_change', { action: 'prompt', paneId: 'gemini-pane', text: 'Inspect API' }, ctx)
    expect(geminiResult).toMatchObject({ ok: true, result: { submitted: true } })
    expect(asked[2]).toMatchObject({
      target: '"Gemini Helper" (Gemini · pane 3)',
      text: 'Inspect API',
      notes: [{ code: 'approvals.note.agent.actsOnPrompt', params: {} }]
    })

    // Exited antigravity pane is refused (RT-3: only status === 'running' is eligible).
    expect(await call('oxespace_agents_change', { action: 'prompt', paneId: 'stopped-agy', text: 'hello' }, ctx)).toMatchObject({ ok: false, code: 'not-agent' })
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('oxespace_agents list includes panes from all configured providers with explicit provider field', async () => {
    const ws = {
      id: 'ws-list', rootPath: '/repo', name: 'multi', isActive: true,
      panes: [
        { id: 'p-claude', displayName: 'Claude Main', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 0 },
        { id: 'p-codex', displayName: 'Codex Worker', status: 'running', agentProfileId: 'prof-codex', rowIndex: 0, columnIndex: 1 },
        { id: 'p-agy-profile', displayName: 'AGY Profile', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 2 },
        { id: 'p-agy-exec', displayName: 'AGY Exec', status: 'running', agentProfileId: null, rowIndex: 1, columnIndex: 0 },
        { id: 'p-gemini', displayName: 'Gemini', status: 'running', agentProfileId: null, rowIndex: 1, columnIndex: 1 },
        { id: 'p-custom', displayName: 'Cursor Custom', status: 'running', agentProfileId: 'prof-custom-cursor', rowIndex: 1, columnIndex: 2 },
        { id: 'p-shell', displayName: 'PowerShell', status: 'running', agentProfileId: null, rowIndex: 2, columnIndex: 0 },
        { id: 'p-exited', displayName: 'Exited AGY', status: 'exited', agentProfileId: 'prof-agy', rowIndex: 2, columnIndex: 1 }
      ]
    }
    const tracked: PaneAgentState[] = [
      { paneId: 'p-claude', workspaceId: ws.id, agent: 'claude', state: 'idle', source: 'hook', seen: true, since: 1, stateChangeSeq: 1, completionSeq: 0 },
      { paneId: 'p-codex', workspaceId: ws.id, agent: 'codex', state: 'working', source: 'screen', seen: true, since: 2, stateChangeSeq: 2, completionSeq: 1 },
      { paneId: 'p-gemini', workspaceId: ws.id, agent: 'gemini', state: 'idle', source: 'screen', seen: true, since: 3, stateChangeSeq: 3, completionSeq: 0 }
    ]
    const agents = {
      state: {
        list: () => tracked,
        get: (paneId: string) => tracked.find(item => item.paneId === paneId) ?? null,
        agentOf: (paneId: string) => paneId === 'p-agy-exec' ? 'antigravity' : null,
        explain: () => ({ state: null }),
        waitFor: vi.fn()
      },
      terminal: {
        peek: (paneId: string) => paneId === 'p-exited' ? null : { running: true, altScreen: false, data: '' },
        submit: vi.fn(), interrupt: vi.fn(), start: vi.fn(), stop: vi.fn()
      },
      profiles: () => [
        { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-codex', provider: 'codex', name: 'Codex', command: 'codex', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-custom-cursor', provider: 'custom', parentProvider: 'cursor', name: 'My Cursor', command: 'cursor-agent', commandTemplate: '', isBuiltin: false }
      ],
      resolve: () => ({ executable: 'claude', provider: 'claude' }),
      mcpArgs: () => [],
      createPane: () => ({ workspace: ws, paneId: 'x' }),
      setPaneAgent: () => ws,
      closePane: () => ws,
      workspaceChanged: vi.fn()
    }
    const ctx = {
      workspaceId: ws.id, executionId: 'exec-list', executionToken: 'tok',
      workspaceServ: { get: (id: string) => id === ws.id ? ws : null, list: () => [ws] },
      executions: { authenticate: () => ({ id: 'exec-list', owner: { kind: 'pane', id: 'p-claude' }, workspaceId: ws.id, canonicalRoot: '/repo', cwd: '/repo' }) },
      app: { agents }
    } as unknown as ToolContext

    const res = await call('oxespace_agents', { action: 'list' }, ctx)
    expect(res.ok).toBe(true)
    const byId = new Map((res.result as Array<{ paneId: string; provider: string; name: string | null }>).map(item => [item.paneId, item]))
    expect([...byId.keys()].sort()).toEqual(['p-agy-exec', 'p-agy-profile', 'p-claude', 'p-codex', 'p-custom', 'p-gemini'])
    expect(byId.get('p-claude')?.provider).toBe('claude')
    expect(byId.get('p-codex')?.provider).toBe('codex')
    expect(byId.get('p-gemini')?.provider).toBe('gemini')
    expect(byId.get('p-agy-profile')?.provider).toBe('antigravity')
    expect(byId.get('p-agy-exec')?.provider).toBe('antigravity')
    expect(byId.get('p-custom')?.provider).toBe('cursor')
  })

  it('cross-workspace read via oxespace_agents or oxespace_terminal requires explicit user authorization per call/session pair and explains refusal', async () => {
    const ws1 = { id: 'ws-a', rootPath: '/repo-a', name: 'Project A', isActive: true, panes: [{ id: 'p-a1', displayName: 'Claude A', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 0 }] }
    const ws2 = { id: 'ws-b', rootPath: '/repo-b', name: 'Project B', isActive: false, panes: [{ id: 'p-b1', displayName: 'AGY B', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 0 }] }
    const ws3 = { id: 'ws-c', rootPath: '/repo-c', name: 'Project C', isActive: false, panes: [{ id: 'p-c1', displayName: 'Codex C', status: 'running', agentProfileId: 'prof-codex', rowIndex: 0, columnIndex: 0 }] }
    const workspaces = [ws1, ws2, ws3]

    const peek = vi.fn((paneId: string) => ({ running: true, altScreen: false, data: `output from ${paneId}` }))
    const stateList = vi.fn((workspaceId?: string) => workspaceId === 'ws-c'
      ? [{ paneId: 'p-c1', workspaceId: 'ws-c', agent: 'codex', state: 'idle' as const, source: 'screen' as const, seen: true, since: 1, stateChangeSeq: 1, completionSeq: 0 }]
      : [])
    const agents = {
      state: { list: stateList, get: () => null, agentOf: (paneId: string) => paneId === 'p-b1' ? 'antigravity' : null, explain: () => ({ state: null }), waitFor: vi.fn() },
      terminal: { peek, submit: vi.fn(), interrupt: vi.fn(), start: vi.fn(), stop: vi.fn() },
      profiles: () => [
        { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-codex', provider: 'codex', name: 'Codex', command: 'codex', commandTemplate: '', isBuiltin: true }
      ],
      resolve: () => ({ executable: 'claude', provider: 'claude' }),
      mcpArgs: () => [],
      createPane: () => ({ workspace: ws1, paneId: 'x' }),
      setPaneAgent: () => ws1,
      closePane: () => ws1,
      workspaceChanged: vi.fn()
    }

    const auditRecords: ActionAuditRecord[] = []
    const audit = { record: (entry: ActionAuditRecord) => { auditRecords.push(entry) } } as unknown as ActionAudit
    const modalRequests: CenterApprovalRequest[] = []
    let answerWith: 'deny' | 'allow-once' | 'allow-session' = 'deny'
    const center = new ApprovalCenter({
      hasWindow: () => true,
      send: (channel, payload) => {
        if (channel !== IPC_CHANNELS.approvals.onRequested) return
        const req = payload as CenterApprovalRequest
        modalRequests.push(req)
        center.ack({ id: req.id, generation: req.generation, visible: true, focused: true })
        center.respond({ id: req.id, generation: req.generation, optionId: answerWith })
      },
      native: async () => 'deny'
    })
    const makeCtx = (broker?: ApprovalBroker, overrides: Partial<ToolContext> = {}) => ({
      workspaceId: ws1.id, executionId: 'exec-a', executionToken: 'tok',
      workspaceServ: { get: (id: string) => workspaces.find(w => w.id === id) ?? null, list: () => workspaces },
      executions: { authenticate: () => ({ id: 'exec-a', owner: { kind: 'pane', id: 'p-a1' }, workspaceId: ws1.id, canonicalRoot: '/repo-a', cwd: '/repo-a' }) },
      agentActions: broker ? new AgentActions({ broker, audit }) : undefined,
      app: { agents, terminal: { peek } },
      ...overrides
    }) as unknown as ToolContext

    const broker1 = new ApprovalBroker(centerApprovalPrompter(center), Date.now, 5_000)
    const ctx1 = makeCtx(broker1)

    // 1. Refusal on oxespace_agents list, oxespace_agents read, and oxespace_terminal output: explains reason, reads 0 bytes, audited.
    answerWith = 'deny'
    const denyList = await call('oxespace_agents', { action: 'list', workspaceId: 'ws-b' }, ctx1)
    expect(denyList).toMatchObject({ ok: false, code: 'denied' })
    expect(denyList.message).toMatch(/cross-workspace/i)
    const denyRead = await call('oxespace_agents', { action: 'read', paneId: 'p-b1' }, ctx1)
    expect(denyRead).toMatchObject({ ok: false, code: 'denied' })
    expect(denyRead.message).toMatch(/Project B/i)
    const denyTerm = await call('oxespace_terminal', { action: 'output', paneId: 'p-b1' }, ctx1)
    expect(denyTerm).toMatchObject({ ok: false, code: 'denied' })
    expect(denyTerm.message).toMatch(/authorization/i)
    expect(peek).toHaveBeenCalledTimes(0)
    expect(stateList).toHaveBeenCalledTimes(0)
    expect(auditRecords.filter(r => r.decision === 'denied')).toHaveLength(3)
    // Modal offered allow-session for low-risk cross-workspace read.
    expect(modalRequests[0].risk).toBe('low')
    expect(modalRequests[0].options.map(o => o.intent)).toEqual(['deny', 'allow', 'allow-session'])
    expect(modalRequests[0].options[2].label.code).toBe('approvals.option.allowSessionWorkspaceReads')

    // 2. Without approval broker: refused with explicit reason, reads 0 bytes.
    const noBroker = await call('oxespace_terminal', { action: 'output', paneId: 'p-b1' }, makeCtx(undefined))
    expect(noBroker).toMatchObject({ ok: false, code: 'denied' })
    expect(noBroker.message).toMatch(/authorization/i)
    expect(peek).toHaveBeenCalledTimes(0)

    // 3. Unverified Thread stays strictly isolated (no-execution).
    const unverifiedThread = makeCtx(broker1, {
      workspaceId: 'thread:p1',
      executions: { authenticate: () => { throw new Error('bad') } } as never
    })
    expect(await call('oxespace_agents', { action: 'list', workspaceId: 'ws-b' }, unverifiedThread)).toMatchObject({ ok: false, code: 'no-execution' })
    expect(peek).toHaveBeenCalledTimes(0)

    // 4. Per-call approval (allow-once) grants only that call; next call asks again.
    const broker2 = new ApprovalBroker(centerApprovalPrompter(center), Date.now, 5_000)
    const ctx2 = makeCtx(broker2)
    modalRequests.length = 0
    answerWith = 'allow-once'
    const onceList = await call('oxespace_agents', { action: 'list', workspaceId: 'ws-b' }, ctx2)
    expect(onceList.ok).toBe(true)
    expect(onceList.result).toEqual([expect.objectContaining({ paneId: 'p-b1', provider: 'antigravity' })])
    expect(modalRequests).toHaveLength(1)
    const secondRead = await call('oxespace_agents', { action: 'read', paneId: 'p-b1' }, ctx2)
    expect(secondRead).toMatchObject({ ok: true, result: { text: 'output from p-b1' } })
    expect(modalRequests).toHaveLength(2)

    // 5. Session grant (allow-session) covers the pair (ws-a, ws-b) across oxespace_agents & oxespace_terminal without re-asking,
    //    but (ws-a, ws-c) STILL asks, and a fresh broker (app restart) does NOT persist the session grant.
    answerWith = 'allow-session'
    expect(await call('oxespace_terminal', { action: 'output', paneId: 'p-b1' }, ctx2)).toMatchObject({ ok: true, result: { text: 'output from p-b1' } })
    expect(modalRequests).toHaveLength(3)
    expect(await call('oxespace_agents', { action: 'read', paneId: 'p-b1' }, ctx2)).toMatchObject({ ok: true, result: { text: 'output from p-b1' } })
    expect(await call('oxespace_agents', { action: 'list', workspaceId: 'ws-b' }, ctx2)).toMatchObject({ ok: true })
    expect(modalRequests).toHaveLength(3)

    // Different target workspace (ws-a -> ws-c) still asks.
    answerWith = 'allow-once'
    expect(await call('oxespace_agents', { action: 'list', workspaceId: 'ws-c' }, ctx2)).toMatchObject({ ok: true, result: [expect.objectContaining({ paneId: 'p-c1', provider: 'codex' })] })
    expect(modalRequests).toHaveLength(4)

    // Simulated app restart (new ApprovalBroker): session grant was not persisted.
    const brokerAfterRestart = new ApprovalBroker(centerApprovalPrompter(center), Date.now, 5_000)
    answerWith = 'deny'
    expect(await call('oxespace_terminal', { action: 'output', paneId: 'p-b1' }, makeCtx(brokerAfterRestart))).toMatchObject({ ok: false, code: 'denied' })
    expect(modalRequests).toHaveLength(5)
    expect(auditRecords.some(r => r.tool === 'oxespace_terminal' && r.action === 'output' && r.decision === 'approved')).toBe(true)
    broker1.dispose()
    broker2.dispose()
    brokerAfterRestart.dispose()
  })
})
