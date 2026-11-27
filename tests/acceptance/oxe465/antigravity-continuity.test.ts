// @vitest-environment node
// Acceptance tests for OXE-465: Antigravity ACP Continuity Engine
// Covers: real autonomy mode mapping, persistent ThreadPermissionStore always-allow,
// reactive wakeups after schedule/subagents + idle reaper protection, and queue/steering/questions through ThreadManager.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AntigravityConversationAdapter } from '../../../electron/main/services/conversation/antigravity-conversation'
import type { ConversationTransport } from '../../../electron/main/services/conversation/codex-conversation'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { ThreadPermissionStore } from '../../../electron/main/services/conversation/thread-permissions'
import type { ThreadEvent } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }

interface LiveAcpServer {
  args: string[]
  sent: RpcMessage[]
  promptIds: Array<number | string>
  receive: (chunk: Uint8Array) => void
  push: (msg: RpcMessage) => void
  update: (update: Record<string, unknown>) => void
  endTurn: (result?: Record<string, unknown>) => void
  responseFor: (id: number | string) => RpcMessage | undefined
  closeSpy: ReturnType<typeof vi.fn>
}

const databases: AppDatabase[] = []
const dirs: string[] = []
const managers: ThreadManager[] = []

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stop()
  for (const db of databases.splice(0)) db.close()
  for (const dir of dirs.splice(0)) removeTempDir(dir)
})

function createOrchestratedHarness(availableModes = [{ id: 'default' }, { id: 'accept-edits' }, { id: 'auto' }, { id: 'yolo' }, { id: 'plan' }]) {
  const root = mkdtempSync(join(tmpdir(), 'oxe-465-ac-'))
  dirs.push(root)
  const db = openInMemoryDatabase()
  databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws-465', 'OXE-465', ?, '1x1', 'builtin-antigravity')").run(root)

  const servers: LiveAcpServer[] = []
  const permissionStore = new ThreadPermissionStore(db)

  const factory = vi.fn(async () => new AntigravityConversationAdapter((args) => {
    const closeSpy = vi.fn(async () => {})
    const server: LiveAcpServer = {
      args,
      sent: [],
      promptIds: [],
      receive: () => {},
      push: msg => server.receive(Buffer.from(JSON.stringify(msg) + '\n')),
      update: update => server.receive(Buffer.from(JSON.stringify({ method: 'session/update', params: { sessionId: 'sess-e2e', update } }) + '\n')),
      endTurn: (result = { stopReason: 'end_turn' }) => {
        const promptId = server.promptIds.shift()
        server.receive(Buffer.from(JSON.stringify({ id: promptId, result }) + '\n'))
      },
      responseFor: id => server.sent.find(msg => msg.id === id && !msg.method),
      closeSpy
    }
    servers.push(server)
    const transport: ConversationTransport = {
      write: line => {
        const msg = JSON.parse(line) as RpcMessage
        server.sent.push(msg)
        if (msg.method === 'session/cancel' && server.promptIds.length) {
          const cancelledId = server.promptIds.shift()!
          queueMicrotask(() => server.push({ id: cancelledId, result: { stopReason: 'cancelled' } }))
          return
        }
        if (!msg.method || msg.id === undefined) return
        if (msg.method === 'session/prompt') {
          server.promptIds.push(msg.id)
          return
        }
        const modes = { currentModeId: 'default', availableModes }
        const result = msg.method === 'initialize'
          ? { protocolVersion: 1, agentInfo: { name: 'Antigravity ACP', version: '1.5.18' }, agentCapabilities: { loadSession: true } }
          : msg.method === 'session/new'
            ? { sessionId: 'sess-e2e', modes, models: { availableModels: [] } }
            : msg.method === 'session/resume'
              ? { modes, models: { availableModels: [] } }
              : {}
        queueMicrotask(() => server.push({ id: msg.id, result }))
      },
      onData: listener => { server.receive = listener },
      onClose: () => {},
      close: closeSpy
    }
    return transport
  }, { permissions: permissionStore, reactiveIdleMs: 40, steerCancelGraceMs: 50 }))

  const manager = new ThreadManager(db, factory, vi.fn())
  managers.push(manager)
  vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  vi.spyOn((manager as unknown as { checkpoints: { begin: () => Promise<string> } }).checkpoints, 'begin').mockRejectedValue(new Error('not a git repo'))

  const createThread = (access: 'read-only' | 'workspace-write' | 'full-access' = 'workspace-write') =>
    manager.create({ workspaceId: 'ws-465', projectId: 'proj-465', rootPath: root, provider: 'antigravity', access }).thread.id

  return { root, db, manager, permissionStore, servers, createThread }
}

const PERM_OPTIONS = [
  { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
]

describe('OXE-465 Acceptance · Antigravity ACP Continuity Engine', () => {
  it('AC1 & AC2: runs workspace autonomy without nagging, guards risky actions, and persists Always allow across threads', { timeout: 30_000 }, async () => {
    const h = createOrchestratedHarness()
    const firstId = h.createThread('workspace-write')
    await h.manager.send(firstId, 'Edit source and run vitest')
    const srv1 = h.servers[0]

    // Autonomy mode mapped cleanly to advertised `accept-edits` instead of staying in `default`
    expect(srv1.sent.find(m => m.method === 'session/set_mode')?.params).toEqual({ sessionId: 'sess-e2e', modeId: 'accept-edits' })

    // Safe workspace file edit auto-approves cleanly without pausing the thread
    srv1.push({
      id: 101,
      method: 'session/request_permission',
      params: { sessionId: 'sess-e2e', toolCall: { toolCallId: 'edit-1', title: 'Edit feature.ts', kind: 'edit', locations: [{ path: join(h.root, 'src', 'feature.ts') }] }, options: PERM_OPTIONS }
    })
    expect(srv1.responseFor(101)).toEqual({ id: 101, result: { outcome: { outcome: 'selected', optionId: 'once' } } })
    expect(h.manager.read(firstId).thread.status).toBe('running')

    // Command `npm run test` asks once; approving with Always allow (`acceptForSession`) persists in ThreadPermissionStore
    srv1.push({
      id: 102,
      method: 'session/request_permission',
      params: { sessionId: 'sess-e2e', toolCall: { toolCallId: 'cmd-1', title: 'npm run test', kind: 'execute', rawInput: { command: 'npm run test -- fast' } }, options: PERM_OPTIONS }
    })
    await vi.waitFor(() => expect(h.manager.read(firstId).thread.status).toBe('approval'))
    await h.manager.respond(firstId, '102', { decision: 'acceptForSession' })
    expect(srv1.responseFor(102)).toEqual({ id: 102, result: { outcome: { outcome: 'selected', optionId: 'always' } } })
    expect(h.permissionStore.rules(h.root).some(r => r.kind === 'command' && r.pattern === 'npm run test' && r.decision === 'allow')).toBe(true)

    srv1.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done first thread.' } })
    srv1.endTurn()
    await vi.waitFor(() => expect(h.manager.read(firstId).thread.status).toBe('idle'))

    // Second Antigravity thread in the same project immediately auto-approves `npm run test` via persisted rule!
    const secondId = h.createThread('workspace-write')
    await h.manager.send(secondId, 'Re-run suite')
    const srv2 = h.servers[1]
    srv2.push({
      id: 201,
      method: 'session/request_permission',
      params: { sessionId: 'sess-e2e', toolCall: { toolCallId: 'cmd-2', title: 'npm run test', kind: 'execute', rawInput: { command: 'npm run test -- full' } }, options: PERM_OPTIONS }
    })
    expect(srv2.responseFor(201)).toEqual({ id: 201, result: { outcome: { outcome: 'selected', optionId: 'always' } } })
    expect(h.manager.read(secondId).thread.status).toBe('running')
    srv2.endTurn()
    await vi.waitFor(() => expect(h.manager.read(secondId).thread.status).toBe('idle'))
  })

  it('AC3: preserves live session during scheduled wakeup wait and streams reactive continuation cleanly into ThreadManager', { timeout: 30_000 }, async () => {
    const h = createOrchestratedHarness()
    const id = h.createThread('workspace-write')
    await h.manager.send(id, 'Start async subagent and schedule check')
    const srv = h.servers[0]

    srv.update({ sessionUpdate: 'tool_call', toolCallId: 'timer-1', title: 'schedule', kind: 'other', status: 'completed', rawInput: { DurationSeconds: 1200, Prompt: 'Report back' } })
    srv.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Waiting for background worker.' } })
    srv.endTurn()
    await vi.waitFor(() => expect(h.manager.read(id).thread.status).toBe('idle'))

    // 16 minutes pass (past default 15-minute idle suspend): session MUST NOT be disposed while scheduled wakeup is pending!
    const later = Date.now() + 16 * 60_000
    expect(await h.manager.suspendIdle(later)).toEqual([])
    expect(srv.closeSpy).not.toHaveBeenCalled()

    // Reactive wakeup arrives after Turn 1 ended: must open Turn 2, stream tool + answer, and settle cleanly!
    srv.update({ sessionUpdate: 'tool_call', toolCallId: 'bg-check', title: 'Read results', kind: 'read', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '100% ok' } }] })
    srv.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Background worker completed with 100% pass.' } })

    await vi.waitFor(() => expect(h.manager.read(id).turns).toHaveLength(2))
    await vi.waitFor(() => expect(h.manager.read(id).thread.status).toBe('idle'))

    const snapshot = h.manager.read(id)
    const assistantMessages = snapshot.events
      .filter((e): e is Extract<ThreadEvent, { type: 'message' }> => e.type === 'message' && e.role === 'assistant')
      .map(e => e.text)
    expect(assistantMessages).toEqual(['Waiting for background worker.', 'Background worker completed with 100% pass.'])
    expect(snapshot.events.some(e => e.type === 'tool' && e.id === 'bg-check' && e.state === 'completed')).toBe(true)

    // Once reactive wakeup finished without rescheduling, normal idle suspension reclaims the idle process
    expect(await h.manager.suspendIdle(Date.now() + 20 * 60_000)).toEqual([id])
    expect(srv.closeSpy).toHaveBeenCalledTimes(1)
  })

  it('AC4: supports FIFO queue draining, in-flight steering, and structured ask_question cards end-to-end', { timeout: 30_000 }, async () => {
    const h = createOrchestratedHarness()
    const id = h.createThread('full-access')

    // Send 3 messages while Turn 1 runs: zero "already running" crash; queued cleanly in FIFO order!
    await h.manager.send(id, 'Turn 1 prompt')
    await h.manager.send(id, 'Queued follow-up A')
    await h.manager.send(id, 'Queued follow-up B')
    const srv = h.servers[0]
    expect(h.manager.read(id).thread.queue?.map(item => item.text)).toEqual(['Queued follow-up A', 'Queued follow-up B'])

    // Steer active Turn 1 mid-flight without losing context or pausing the queue!
    await h.manager.steer(id, 'Focus on TypeScript strict mode')
    expect(srv.sent.filter(m => m.method === 'session/cancel')).toHaveLength(1)
    expect(srv.sent.filter(m => m.method === 'session/prompt')).toHaveLength(2)
    expect(h.manager.read(id).thread.status).toBe('running')
    expect(h.manager.read(id).thread.queuePause).toBeUndefined()

    // Structured question during Turn 1 surfaces as kind: 'question' and resolves via manager.respond
    srv.push({
      id: 301,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-e2e',
        toolCall: {
          toolCallId: 'ask-1',
          title: 'ask_question',
          kind: 'other',
          rawInput: { questions: [{ id: 'target', question: 'Target runtime?', options: ['Node 22', 'Electron'] }] }
        },
        options: [{ optionId: 'opt-node', name: 'Node 22', kind: 'allow_once' }, { optionId: 'opt-el', name: 'Electron', kind: 'allow_once' }]
      }
    })
    await vi.waitFor(() => expect(h.manager.read(id).thread.status).toBe('approval'))
    const qEvent = h.manager.read(id).events.find((e): e is Extract<ThreadEvent, { type: 'request' }> => e.type === 'request' && e.id === '301')
    expect(qEvent?.request.kind).toBe('question')
    await h.manager.respond(id, '301', { answers: { target: ['Electron'] } })
    expect(srv.responseFor(301)).toEqual({
      id: 301,
      result: { outcome: { outcome: 'selected', optionId: 'opt-el' }, answers: { target: ['Electron'] } }
    })

    // End Turn 1 -> FIFO drains Queued follow-up A -> End Turn 2 -> FIFO drains Queued follow-up B
    srv.endTurn()
    await vi.waitFor(() => expect(srv.sent.filter(m => m.method === 'session/prompt')).toHaveLength(3))
    expect((srv.sent.filter(m => m.method === 'session/prompt')[2].params as { prompt: Array<{ text: string }> }).prompt[0].text).toBe('Queued follow-up A')

    srv.endTurn()
    await vi.waitFor(() => expect(srv.sent.filter(m => m.method === 'session/prompt')).toHaveLength(4))
    expect((srv.sent.filter(m => m.method === 'session/prompt')[3].params as { prompt: Array<{ text: string }> }).prompt[0].text).toBe('Queued follow-up B')

    srv.endTurn()
    await vi.waitFor(() => expect(h.manager.read(id).thread.status).toBe('idle'))
    expect(h.manager.read(id).thread.queue).toEqual([])
  })
})
