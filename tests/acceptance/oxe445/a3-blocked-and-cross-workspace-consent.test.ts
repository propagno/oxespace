import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { AGENT_CHANGE_TOOLS } from '../../../electron/main/mcp-internal/agent-tools'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../../electron/main/services/agent-actions/approval-broker'
import { PaneBusService } from '../../../electron/main/services/agent-state/pane-bus.service'
import type { AgentLifecycleState, PaneAgentState } from '../../../shared/types/agent-state'

function buildSafetyHarness(decisionRef: { current: ApprovalDecision }) {
  const db = openInMemoryDatabase()
  const bus = new PaneBusService(db)
  const asked: ApprovalRequest[] = []
  const wsA = {
    id: 'ws-a',
    name: 'Project Alpha',
    rootPath: '/alpha',
    isActive: true,
    panes: [
      { id: 'pane-a1', displayName: 'Caller', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 0 },
      { id: 'pane-a2', displayName: 'Blocked Pane', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 1 },
      { id: 'pane-a3', displayName: 'Peer Pane', status: 'running', agentProfileId: 'prof-codex', rowIndex: 0, columnIndex: 2 }
    ]
  }
  const wsB = {
    id: 'ws-b',
    name: 'Project Beta',
    rootPath: '/beta',
    isActive: false,
    panes: [
      { id: 'pane-b1', displayName: 'Beta Claude', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 0 }
    ]
  }
  const states = new Map<string, PaneAgentState>([
    ['pane-a2', { paneId: 'pane-a2', workspaceId: 'ws-a', agent: 'claude', state: 'blocked', source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }],
    ['pane-a3', { paneId: 'pane-a3', workspaceId: 'ws-a', agent: 'codex', state: 'idle', source: 'hook', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }],
    ['pane-b1', { paneId: 'pane-b1', workspaceId: 'ws-b', agent: 'claude', state: 'idle', source: 'hook', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }]
  ])
  const submit = vi.fn(async () => true)
  const interrupt = vi.fn(async () => true)
  const execution = { id: 'exec-a1', paneId: 'pane-a1', owner: { kind: 'pane', id: 'pane-a1' }, workspaceId: 'ws-a', canonicalRoot: '/alpha', cwd: '/alpha' }
  const ctx = {
    db,
    workspaceId: 'ws-a',
    executionId: 'exec-a1',
    executionToken: 'tok',
    workspaceServ: {
      get: (id: string) => (id === 'ws-a' ? wsA : id === 'ws-b' ? wsB : null),
      list: () => [wsA, wsB]
    },
    executions: { authenticate: () => execution },
    agentActions: new AgentActions({
      broker: new ApprovalBroker({
        ask: async (request) => {
          asked.push(request)
          return decisionRef.current
        }
      }, Date.now, 50)
    }),
    app: {
      agents: {
        bus,
        state: {
          list: (wsId?: string) => [...states.values()].filter((s) => !wsId || s.workspaceId === wsId),
          get: (id: string) => states.get(id) ?? null,
          explain: () => ({ state: null, hook: null, screen: null, pendingIdle: false }),
          waitFor: vi.fn(async (id: string, until: AgentLifecycleState[]) => ({ state: states.get(id) ?? null, timedOut: !until.includes(states.get(id)?.state ?? 'unknown') }))
        },
        terminal: {
          peek: () => ({ running: true, data: '', altScreen: false }),
          submit,
          interrupt,
          start: vi.fn(async () => undefined),
          stop: vi.fn()
        },
        profiles: () => [
          { agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy' },
          { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude' },
          { agentProfileId: 'prof-codex', provider: 'codex', name: 'Codex', command: 'codex' }
        ],
        resolve: () => ({ executable: 'claude', provider: 'claude' }),
        mcpArgs: () => [],
        createPane: vi.fn(),
        setPaneAgent: vi.fn(),
        closePane: vi.fn(),
        workspaceChanged: vi.fn()
      }
    }
  } as unknown as ToolContext
  return { db, bus, ctx, asked, submit, interrupt }
}

async function callChange(args: Record<string, unknown>, ctx: ToolContext) {
  const tool = AGENT_CHANGE_TOOLS.find((t) => t.descriptor.name === 'oxespace_agents_change')!
  const res = await tool.handler(args, ctx)
  return JSON.parse(res.content[0].text) as { ok: boolean; code?: string; message?: string; result?: Record<string, unknown> }
}

describe('OXE-445 A3 · Blocked pane protection and explicit cross-workspace/unowned consent', () => {
  test('refuses prompt and interrupt on blocked panes deterministically without writing bytes', async () => {
    const decision = { current: 'allow-once' as ApprovalDecision }
    const { db, ctx, submit, interrupt } = buildSafetyHarness(decision)
    try {
      const p1 = await callChange({ action: 'prompt', paneId: 'pane-a2', text: 'approve' }, ctx)
      const p2 = await callChange({ action: 'prompt', paneId: 'pane-a2', text: 'approve again' }, ctx)
      const i1 = await callChange({ action: 'interrupt', paneId: 'pane-a2' }, ctx)

      expect(p1).toMatchObject({ ok: false, code: 'agent_blocked' })
      expect(p2).toMatchObject({ ok: false, code: 'agent_blocked' })
      expect(i1).toMatchObject({ ok: false, code: 'agent_blocked' })
      expect(submit).not.toHaveBeenCalled()
      expect(interrupt).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  test('requires explicit human confirmation for non-owned and cross-workspace prompt or bus_send and writes nothing on denial', async () => {
    const decision = { current: 'deny' as ApprovalDecision }
    const { db, bus, ctx, asked, submit } = buildSafetyHarness(decision)
    try {
      // 1. Non-owned peer in same workspace: denied -> 0 bus messages persisted.
      const deniedPeerBus = await callChange({
        action: 'bus_send',
        toPaneId: 'pane-a3',
        topic: 'handoff',
        payload: { task: 'check tests' }
      }, ctx)
      expect(deniedPeerBus.ok).toBe(false)
      expect(asked.length).toBeGreaterThanOrEqual(1)
      expect(bus.inbox({ toPaneId: 'pane-a3' })).toHaveLength(0)

      // 2. Cross-workspace prompt to ws-b: denied -> 0 bytes submitted.
      const deniedCrossPrompt = await callChange({
        action: 'prompt',
        workspaceId: 'ws-b',
        paneId: 'pane-b1',
        text: 'Run deploy script'
      }, ctx)
      expect(deniedCrossPrompt.ok).toBe(false)
      expect(submit).not.toHaveBeenCalled()

      // 3. Cross-workspace bus_send to ws-b: denied -> 0 messages persisted.
      const deniedCrossBus = await callChange({
        action: 'bus_send',
        workspaceId: 'ws-b',
        toPaneId: 'pane-b1',
        topic: 'cross-sync',
        payload: { msg: 'hello beta' }
      }, ctx)
      expect(deniedCrossBus.ok).toBe(false)
      expect(bus.inbox({ toPaneId: 'pane-b1' })).toHaveLength(0)

      // 4. With explicit user approval ('allow-once'), cross-workspace prompt and bus_send both succeed.
      decision.current = 'allow-once'
      const approvedCrossPrompt = await callChange({
        action: 'prompt',
        workspaceId: 'ws-b',
        paneId: 'pane-b1',
        text: 'Inspect status'
      }, ctx)
      expect(approvedCrossPrompt).toMatchObject({ ok: true, result: { submitted: true } })
      expect(submit).toHaveBeenCalledWith('pane-b1', 'Inspect status')

      const approvedCrossBus = await callChange({
        action: 'bus_send',
        workspaceId: 'ws-b',
        toPaneId: 'pane-b1',
        topic: 'cross-sync',
        payload: { msg: 'approved cross-workspace message' }
      }, ctx)
      expect(approvedCrossBus.ok).toBe(true)
      expect(bus.inbox({ toPaneId: 'pane-b1' })).toHaveLength(1)
    } finally {
      db.close()
    }
  })
})
