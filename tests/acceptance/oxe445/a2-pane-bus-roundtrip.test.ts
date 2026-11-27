import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { AGENT_CHANGE_TOOLS, AGENT_READ_TOOLS } from '../../../electron/main/mcp-internal/agent-tools'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { fenceUntrusted } from '../../../electron/main/mcp-internal/untrusted-output'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker } from '../../../electron/main/services/agent-actions/approval-broker'
import { BUS_RATE_LIMIT_PER_MIN, MAX_BUS_HOPS, PaneBusService } from '../../../electron/main/services/agent-state/pane-bus.service'
import type { PaneAgentState } from '../../../shared/types/agent-state'

function makeContext(db: ReturnType<typeof openInMemoryDatabase>, bus: PaneBusService, callerPaneId: string, actorId: string) {
  const workspace = {
    id: 'ws-bus',
    name: 'Repo',
    rootPath: '/repo',
    isActive: true,
    panes: [
      { id: 'pane-a', displayName: 'Antigravity', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 0 },
      { id: 'pane-b', displayName: 'Claude', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 1 }
    ]
  }
  const states = new Map<string, PaneAgentState>([
    ['pane-a', { paneId: 'pane-a', workspaceId: 'ws-bus', agent: 'antigravity', state: 'idle', source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }],
    ['pane-b', { paneId: 'pane-b', workspaceId: 'ws-bus', agent: 'claude', state: 'idle', source: 'hook', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }]
  ])
  const execution = { id: actorId, paneId: callerPaneId, owner: { kind: 'pane', id: callerPaneId }, workspaceId: 'ws-bus', canonicalRoot: '/repo', cwd: '/repo' }
  return {
    db,
    workspaceId: 'ws-bus',
    executionId: actorId,
    executionToken: 'tok',
    workspaceServ: { get: (id: string) => (id === 'ws-bus' ? workspace : null), list: () => [workspace] },
    executions: { authenticate: () => execution },
    agentActions: new AgentActions({ broker: new ApprovalBroker({ ask: async () => 'allow-once' }, Date.now, 50) }),
    app: {
      agents: {
        bus,
        state: {
          list: () => [...states.values()],
          get: (id: string) => states.get(id) ?? null,
          explain: () => ({ state: null, hook: null, screen: null, pendingIdle: false }),
          waitFor: vi.fn(async () => ({ state: null, timedOut: false }))
        },
        terminal: {
          peek: () => ({ running: true, data: '', altScreen: false }),
          submit: vi.fn(async () => true),
          interrupt: vi.fn(async () => true),
          start: vi.fn(async () => undefined),
          stop: vi.fn()
        },
        profiles: () => [
          { agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy' },
          { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude' }
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
}

async function callRaw(toolName: string, args: Record<string, unknown>, ctx: ToolContext) {
  const tool = [...AGENT_READ_TOOLS, ...AGENT_CHANGE_TOOLS].find((entry) => entry.descriptor.name === toolName)!
  const raw = await tool.handler(args, ctx)
  return fenceUntrusted(toolName, args, raw)
}

function parseEnvelope(text: string): { ok: boolean; code?: string; message?: string; result?: Record<string, unknown> } {
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { ok: boolean; code?: string; message?: string; result?: Record<string, unknown> }
}

describe('OXE-445 A2 · Persistent SQLite pane-bus structured messaging, fencing, hops and rate limit', () => {
  test('pane-bus delivers UTF-8 structured messages with fenceUntrusted, redacts secrets, supports idempotent ack, and unblocks bus_wait on correlated reply', async () => {
    const db = openInMemoryDatabase()
    const bus = new PaneBusService(db)
    try {
      // Pane A owns Pane B so same-workspace send does not require extra prompt.
      bus.setOwner('pane-b', 'exec-a', 'ws-bus', 'pane-a')

      const ctxA = makeContext(db, bus, 'pane-a', 'exec-a')
      const ctxB = makeContext(db, bus, 'pane-b', 'exec-b')

      // 1. Pane A sends UTF-8 structured message containing a secret value.
      const sentRaw = await callRaw('oxespace_agents_change', {
        action: 'bus_send',
        toPaneId: 'pane-b',
        topic: 'code-review',
        correlationId: 'corr-utf8-1',
        payload: { summary: 'Revisão 🚀 atenção', leak: 'token=super_secret_12345' }
      }, ctxA)
      const sent = parseEnvelope(sentRaw.content[0].text)
      expect(sent.ok).toBe(true)
      const messageId = String(sent.result?.id)
      expect(messageId).toBeTruthy()

      // 2. Pane B reads inbox: output MUST be wrapped by fenceUntrusted, preserve UTF-8, and redact secret.
      const inboxRaw = await callRaw('oxespace_agents', { action: 'bus_inbox', topic: 'code-review' }, ctxB)
      const inboxText = inboxRaw.content[0].text
      expect(inboxText).toContain('[untrusted data from another agent\'s terminal:')
      expect(inboxText).toContain('[end of untrusted data]')
      expect(inboxText).toContain('Revisão 🚀 atenção')
      expect(inboxText).not.toContain('super_secret_12345')

      const inbox = parseEnvelope(inboxText)
      expect(inbox.ok).toBe(true)
      const messages = inbox.result?.messages as Array<{ id: string; topic: string; correlationId: string }>
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ id: messageId, topic: 'code-review', correlationId: 'corr-utf8-1' })

      // 3. Edge A2.e2: idempotent ack succeeds twice without error.
      const ack1 = parseEnvelope((await callRaw('oxespace_agents_change', { action: 'bus_ack', messageId }, ctxB)).content[0].text)
      const ack2 = parseEnvelope((await callRaw('oxespace_agents_change', { action: 'bus_ack', messageId }, ctxB)).content[0].text)
      expect(ack1).toMatchObject({ ok: true, result: { acknowledged: true } })
      expect(ack2).toMatchObject({ ok: true, result: { acknowledged: true } })

      // 4. Pane A waits for correlated reply while Pane B sends reply after 30ms.
      const waitPromise = callRaw('oxespace_agents', {
        action: 'bus_wait',
        correlationId: 'corr-utf8-1',
        replyToId: messageId,
        timeoutMs: 3000
      }, ctxA)

      await new Promise((resolve) => setTimeout(resolve, 30))
      const replySent = parseEnvelope((await callRaw('oxespace_agents_change', {
        action: 'bus_send',
        toPaneId: 'pane-a',
        topic: 'code-review',
        correlationId: 'corr-utf8-1',
        replyToId: messageId,
        payload: { verdict: 'approved', note: 'Tudo certo ✅' }
      }, ctxB)).content[0].text)
      expect(replySent.ok).toBe(true)

      const waitedRaw = await waitPromise
      const waitedText = waitedRaw.content[0].text
      expect(waitedText).toContain('[untrusted data from another agent\'s terminal:')
      const waited = parseEnvelope(waitedText)
      expect(waited.ok).toBe(true)
      expect(waited.result).toMatchObject({
        timedOut: false,
        message: expect.objectContaining({
          correlationId: 'corr-utf8-1',
          replyToId: messageId
        })
      })
    } finally {
      db.close()
    }
  })

  test('pane-bus rejects messages exceeding maxHops=3 and enforces per-actor rate limit', () => {
    expect(MAX_BUS_HOPS).toBe(3)
    expect(BUS_RATE_LIMIT_PER_MIN).toBeGreaterThanOrEqual(10)

    const db = openInMemoryDatabase()
    const bus = new PaneBusService(db)
    try {
      // Hops 0 -> 1 -> 2 -> 3 succeed; hop 4 must throw max-hops error.
      let parentId: string | undefined
      for (let hop = 0; hop <= MAX_BUS_HOPS; hop++) {
        const msg = bus.send({
          workspaceId: 'ws-bus',
          fromPaneId: hop % 2 === 0 ? 'pane-a' : 'pane-b',
          toPaneId: hop % 2 === 0 ? 'pane-b' : 'pane-a',
          fromActor: `actor-${hop}`,
          topic: 'chain',
          correlationId: 'corr-hops',
          replyToId: parentId,
          payload: { hop }
        })
        expect(msg.hops).toBe(hop)
        parentId = msg.id
      }
      expect(() =>
        bus.send({
          workspaceId: 'ws-bus',
          fromPaneId: 'pane-a',
          toPaneId: 'pane-b',
          fromActor: 'actor-overflow',
          topic: 'chain',
          correlationId: 'corr-hops',
          replyToId: parentId,
          payload: { hop: MAX_BUS_HOPS + 1 }
        })
      ).toThrow(/hop/i)

      // Rate limit: BUS_RATE_LIMIT_PER_MIN succeeds, next one within the same minute fails.
      for (let i = 0; i < BUS_RATE_LIMIT_PER_MIN; i++) {
        bus.send({
          workspaceId: 'ws-bus',
          fromPaneId: 'pane-a',
          toPaneId: 'pane-b',
          fromActor: 'flood-actor',
          topic: 'ping',
          payload: { i }
        })
      }
      expect(() =>
        bus.send({
          workspaceId: 'ws-bus',
          fromPaneId: 'pane-a',
          toPaneId: 'pane-b',
          fromActor: 'flood-actor',
          topic: 'ping',
          payload: { i: 'overflow' }
        })
      ).toThrow(/rate/i)
    } finally {
      db.close()
    }
  })
})
