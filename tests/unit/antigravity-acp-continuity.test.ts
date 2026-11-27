import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import {
  AntigravityConversationAdapter,
  antigravityMode,
  resolveAntigravityMode,
  type AntigravityAdapterOptions
} from '../../electron/main/services/conversation/antigravity-conversation'
import type { ConversationTransport } from '../../electron/main/services/conversation/codex-conversation'
import { threadCapabilityManifest } from '../../electron/main/services/conversation/thread-capabilities'
import { ThreadPermissionStore } from '../../electron/main/services/conversation/thread-permissions'
import type { ThreadConfiguration, ThreadEvent } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

type RpcMessage = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
type RpcAnswer = (params: Record<string, unknown>) => unknown

interface ScriptedLaunch {
  args: string[]
  cwd: string
  sent: RpcMessage[]
  receive: (chunk: Uint8Array) => void
  closed: () => void
  promptIds: Array<number | string>
  transport: ConversationTransport
}

const databases: AppDatabase[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const dir of tempDirs.splice(0)) removeTempDir(dir)
})

function makeWorkspace(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-465-unit-')))
  tempDirs.push(dir)
  return dir
}

function createFixture(options: {
  availableModes?: Array<{ id: string }>
  currentModeId?: string
  agentCapabilities?: Record<string, unknown>
  answers?: Record<string, RpcAnswer>
  adapterOptions?: AntigravityAdapterOptions
  autoCancelPrompt?: boolean
} = {}) {
  const sessionModes = {
    currentModeId: options.currentModeId ?? 'default',
    availableModes: options.availableModes ?? [{ id: 'default' }, { id: 'accept-edits' }, { id: 'auto' }, { id: 'plan' }]
  }
  const launches: ScriptedLaunch[] = []
  const defaults: Record<string, RpcAnswer> = {
    initialize: () => ({
      protocolVersion: 1,
      agentInfo: { name: 'Antigravity ACP Server', version: '1.5.18' },
      agentCapabilities: { loadSession: true, ...(options.agentCapabilities ?? {}) }
    }),
    'session/new': () => ({ sessionId: 'sess-465', modes: sessionModes, models: { availableModels: [] } }),
    'session/resume': () => ({ modes: sessionModes, models: { availableModels: [] } })
  }

  const adapter = new AntigravityConversationAdapter((args, cwd) => {
    const launch: ScriptedLaunch = {
      args,
      cwd,
      sent: [],
      receive: () => {},
      closed: () => {},
      promptIds: [],
      transport: {
        write: line => {
          const msg = JSON.parse(line) as RpcMessage
          launch.sent.push(msg)
          if (msg.method === 'session/cancel' && options.autoCancelPrompt !== false && launch.promptIds.length) {
            const activePromptId = launch.promptIds.shift()!
            queueMicrotask(() => launch.receive(Buffer.from(JSON.stringify({ id: activePromptId, result: { stopReason: 'cancelled' } }) + '\n')))
            return
          }
          if (!msg.method || msg.id === undefined) return
          if (msg.method === 'session/prompt') {
            launch.promptIds.push(msg.id)
            return
          }
          let reply: RpcMessage
          try {
            const fn = options.answers?.[msg.method] ?? defaults[msg.method] ?? (() => ({}))
            reply = { id: msg.id, result: fn(msg.params ?? {}) }
          } catch (error) {
            reply = { id: msg.id, error: { code: -32000, message: (error as Error).message } }
          }
          queueMicrotask(() => launch.receive(Buffer.from(JSON.stringify(reply) + '\n')))
        },
        onData: listener => { launch.receive = listener },
        onClose: listener => { launch.closed = listener },
        close: vi.fn(async () => {})
      }
    }
    launches.push(launch)
    return launch.transport
  }, { reactiveIdleMs: 30, steerCancelGraceMs: 50, ...(options.adapterOptions ?? {}) })

  const events: ThreadEvent[] = []
  const current = () => launches.at(-1)!
  const server = (message: RpcMessage) => current().receive(Buffer.from(JSON.stringify(message) + '\n'))
  return {
    adapter,
    launches,
    events,
    current,
    server,
    emit: (event: ThreadEvent) => { events.push(event) },
    update: (update: Record<string, unknown>, sessionId = 'sess-465') => server({ method: 'session/update', params: { sessionId, update } }),
    endTurn: (result: Record<string, unknown> = { stopReason: 'end_turn' }) => {
      const promptId = current().promptIds.shift()
      server({ id: promptId, result })
    },
    sent: (method: string) => current().sent.filter(msg => msg.method === method),
    rpcResponseFor: (id: number | string) => current().sent.find(msg => msg.id === id && !msg.method),
    of: <T extends ThreadEvent['type']>(type: T) => events.filter((event): event is Extract<ThreadEvent, { type: T }> => event.type === type)
  }
}

const settle = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('OXE-465 · Antigravity ACP autonomy mode mapping', () => {
  it('maps OXESpace (mode, access, approvalPolicy) against advertised availableModes without forcing default', () => {
    const standard = ['default', 'accept-edits', 'auto', 'plan']
    const camel = ['default', 'acceptEdits', 'bypassPermissions', 'plan']
    const yolo = ['default', 'acceptEdits', 'auto', 'yolo', 'plan']

    expect(resolveAntigravityMode({ mode: 'plan', access: 'full-access', approvalPolicy: 'never' }, yolo)).toBe('plan')
    expect(resolveAntigravityMode({ mode: 'default', access: 'read-only', approvalPolicy: 'never' }, yolo)).toBe('default')
    expect(resolveAntigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'always' }, standard)).toBe('default')
    expect(resolveAntigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'untrusted' }, standard)).toBe('default')

    // Standard workspace development autonomy picks non-blocking edit mode matching server casing
    expect(resolveAntigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'on-request' }, standard)).toBe('accept-edits')
    expect(resolveAntigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'on-failure' }, camel)).toBe('acceptEdits')
    expect(resolveAntigravityMode({ mode: 'accept-edits', access: 'workspace-write' }, camel)).toBe('acceptEdits')
    expect(resolveAntigravityMode({ mode: 'auto', access: 'workspace-write' }, standard)).toBe('auto')
    expect(resolveAntigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'never' }, standard)).toBe('auto')

    // Full-access selects highest advertised autonomous mode
    expect(resolveAntigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'on-request' }, standard)).toBe('auto')
    expect(resolveAntigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'on-request' }, camel)).toBe('bypassPermissions')
    expect(resolveAntigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'never' }, yolo)).toBe('yolo')
    expect(resolveAntigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'never' }, camel)).toBe('bypassPermissions')
    expect(resolveAntigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'never' }, standard)).toBe('auto')

    // Falls back gracefully when server only advertises `default`
    expect(antigravityMode({ mode: 'default', access: 'workspace-write' }, ['default'])).toBe('default')
  })

  it('sets the exact advertised mode on session/new and respects camelCase/yolo providers', async () => {
    const f = createFixture({ availableModes: [{ id: 'default' }, { id: 'acceptEdits' }, { id: 'yolo' }, { id: 'plan' }] })
    await f.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' }, f.emit)
    expect(f.sent('session/set_mode').map(m => m.params)).toEqual([{ sessionId: 'sess-465', modeId: 'acceptEdits' }])

    await f.adapter.configure!({ access: 'full-access', approvalPolicy: 'never' })
    expect(f.sent('session/set_mode').map(m => m.params)).toEqual([{ sessionId: 'sess-465', modeId: 'yolo' }])
    await f.adapter.dispose()
  })
})

describe('OXE-465 · Workspace autonomy auto-approval, guardrails & persistent ThreadPermissionStore', () => {
  const stdOptions = [
    { optionId: 'opt-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'opt-always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'opt-no', name: 'Reject', kind: 'reject_once' }
  ]

  it('auto-approves safe workspace edits and read-only ops while guarding destructive, protected, secret, and out-of-workspace requests', async () => {
    const root = makeWorkspace()
    const f = createFixture()
    await f.adapter.start({ rootPath: root, nativeSessionId: null, access: 'workspace-write', approvalPolicy: 'on-request' }, f.emit)
    await f.adapter.send('Implement feature')

    // Safe in-workspace edit -> auto-approved with allow_once, no request surfaced
    f.server({
      id: 10,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't1', title: 'Edit app.ts', kind: 'edit', locations: [{ path: join(root, 'src', 'app.ts') }] }, options: stdOptions }
    })
    expect(f.rpcResponseFor(10)).toEqual({ id: 10, result: { outcome: { outcome: 'selected', optionId: 'opt-once' } } })

    // Safe read-only shell command in workspace -> auto-approved
    f.server({
      id: 11,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't2', title: 'git status', kind: 'execute', rawInput: { command: 'git status' } }, options: stdOptions }
    })
    expect(f.rpcResponseFor(11)).toEqual({ id: 11, result: { outcome: { outcome: 'selected', optionId: 'opt-once' } } })
    expect(f.of('request')).toHaveLength(0)

    // Out-of-workspace edit -> MUST ask user
    f.server({
      id: 12,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't3', title: 'Edit outside', kind: 'edit', locations: [{ path: join(root, '..', 'outside.ts') }] }, options: stdOptions }
    })
    // Protected config file -> MUST ask user AND strip acceptForSession
    f.server({
      id: 13,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't4', title: 'Edit AGENTS.md', kind: 'edit', locations: [{ path: join(root, 'AGENTS.md') }] }, options: stdOptions }
    })
    // Destructive shell command -> MUST ask user
    f.server({
      id: 14,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't5', title: 'rm', kind: 'execute', rawInput: { command: 'rm -rf dist' } }, options: stdOptions }
    })
    // Secret file -> MUST ask user
    f.server({
      id: 15,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't6', title: 'Edit .env', kind: 'edit', locations: [{ path: join(root, '.env') }] }, options: stdOptions }
    })

    expect(f.of('request').map(event => event.id)).toEqual(['12', '13', '14', '15'])
    const guardedReq = f.of('request').find(event => event.id === '13')!.request
    expect(guardedReq.availableDecisions).toEqual(['accept', 'decline'])
    await expect(f.adapter.respondRequest('13', { decision: 'acceptForSession' })).rejects.toThrow(/approved once/i)

    // Explicit approvalPolicy: 'untrusted' never auto-approves workspace edits
    f.endTurn()
    await settle()
    await f.adapter.configure!({ approvalPolicy: 'untrusted' })
    await f.adapter.send('Strict turn')
    f.server({
      id: 16,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 't7', title: 'Edit app.ts', kind: 'edit', locations: [{ path: join(root, 'src', 'app.ts') }] }, options: stdOptions }
    })
    expect(f.of('request').at(-1)?.id).toBe('16')
    await f.adapter.dispose()
  })

  it('exposes permissions capability, checks ThreadPermissionStore first, and persists Always allow across turns and restarts', async () => {
    const db = openInMemoryDatabase()
    databases.push(db)
    const root = makeWorkspace()
    const store = new ThreadPermissionStore(db)
    store.add({ projectRoot: root, kind: 'command', pattern: 'cargo test', decision: 'allow' })
    store.add({ projectRoot: root, kind: 'command', pattern: 'git push', decision: 'deny' })

    const first = createFixture({ adapterOptions: { permissions: store } })
    expect(first.adapter.capabilities).toMatchObject({ permissions: true, queue: true, steering: true, questions: true })
    const manifest = threadCapabilityManifest('antigravity', first.adapter.capabilities, true, first.adapter.evidence)
    expect(manifest.features.permissions.enabled).toBe(true)
    expect(manifest.features.queue.enabled).toBe(true)
    expect(manifest.features.steering.enabled).toBe(true)
    expect(manifest.features.questions.enabled).toBe(true)
    expect(manifest.features.alwaysAllowBeyondSession?.enabled).toBe(true)

    await first.adapter.start({ rootPath: root, nativeSessionId: null, access: 'workspace-write' }, first.emit)
    await first.adapter.send('Run checks')

    // Saved allow rule auto-approves immediately with allow_always
    first.server({
      id: 20,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 'c1', title: 'cargo test', kind: 'execute', rawInput: { command: 'cargo test --lib' } }, options: stdOptions }
    })
    expect(first.rpcResponseFor(20)).toEqual({ id: 20, result: { outcome: { outcome: 'selected', optionId: 'opt-always' } } })

    // Saved deny rule auto-rejects immediately
    first.server({
      id: 21,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 'c2', title: 'git push', kind: 'execute', rawInput: { command: 'git push origin main' } }, options: stdOptions }
    })
    expect(first.rpcResponseFor(21)).toEqual({ id: 21, result: { outcome: { outcome: 'selected', optionId: 'opt-no' } } })
    expect(first.of('request')).toHaveLength(0)

    // Uncovered dev command surfaces to user; approving with acceptForSession persists rule + sends allow_always
    first.server({
      id: 22,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 'c3', title: 'npm run test', kind: 'execute', rawInput: { command: 'npm run test -- unit' } }, options: stdOptions }
    })
    expect(first.of('request')).toHaveLength(1)
    await first.adapter.respondRequest('22', { decision: 'acceptForSession' })
    expect(first.rpcResponseFor(22)).toEqual({ id: 22, result: { outcome: { outcome: 'selected', optionId: 'opt-always' } } })
    expect(store.rules(root).some(rule => rule.kind === 'command' && rule.pattern === 'npm run test' && rule.decision === 'allow')).toBe(true)

    first.endTurn()
    await settle()
    await first.adapter.dispose()

    // Brand-new adapter instance sharing the same ThreadPermissionStore auto-approves immediately without halting!
    const second = createFixture({ adapterOptions: { permissions: store } })
    await second.adapter.start({ rootPath: root, nativeSessionId: 'sess-465', access: 'workspace-write' }, second.emit)
    await second.adapter.send('Run tests again')
    second.server({
      id: 30,
      method: 'session/request_permission',
      params: { sessionId: 'sess-465', toolCall: { toolCallId: 'c4', title: 'npm run test', kind: 'execute', rawInput: { command: 'npm run test -- acceptance' } }, options: stdOptions }
    })
    expect(second.of('request')).toHaveLength(0)
    expect(second.rpcResponseFor(30)).toEqual({ id: 30, result: { outcome: { outcome: 'selected', optionId: 'opt-always' } } })
    await second.adapter.dispose()
  })
})

describe('OXE-465 · Reactive wakeups after schedule & async subagents', () => {
  it('opens a synthetic continuation turn for reactive session/update & permissions arriving while idle', async () => {
    const db = openInMemoryDatabase()
    databases.push(db)
    const root = makeWorkspace()
    const store = new ThreadPermissionStore(db)
    store.add({ projectRoot: root, kind: 'command', pattern: 'npm run test', decision: 'allow' })

    const f = createFixture({ adapterOptions: { permissions: store, reactiveIdleMs: 40 } })
    await f.adapter.start({ rootPath: root, nativeSessionId: null, access: 'workspace-write' }, f.emit)
    await f.adapter.send('Wait for subagent and check tests')

    // Turn 1 schedules a 10-minute timer and completes
    f.update({ sessionUpdate: 'tool_call', toolCallId: 'sched-1', title: 'schedule', kind: 'other', status: 'completed', rawInput: { DurationSeconds: 600, Prompt: 'Check status' } })
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Scheduled timer.' } })
    f.endTurn({ stopReason: 'end_turn' })
    await settle()

    expect(f.of('completed')).toHaveLength(1)
    expect(f.adapter.hasPendingBackground(Date.now() + 60_000)).toBe(true)

    // Metadata updates while idle must NOT start a reactive turn
    f.update({ sessionUpdate: 'current_mode_update', currentModeId: 'accept-edits' })
    f.update({ sessionUpdate: 'available_commands_update', availableCommands: [] })
    expect(f.of('continuation-started')).toHaveLength(0)

    // Reactive wakeup arrives AFTER Turn 1 ended (!busy): thought + tool + permission + assistant message!
    f.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Timer fired, verifying suite.' } })
    f.update({ sessionUpdate: 'tool_call', toolCallId: 'bg-t1', title: 'npm run test', kind: 'execute', status: 'in_progress', rawInput: { command: 'npm run test' } })
    f.server({
      id: 90,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-465',
        toolCall: { toolCallId: 'bg-t1', title: 'npm run test', kind: 'execute', rawInput: { command: 'npm run test' } },
        options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }]
      }
    })
    expect(f.rpcResponseFor(90)).toEqual({ id: 90, result: { outcome: { outcome: 'selected', optionId: 'always' } } })

    // Must NOT settle while bg-t1 is still in_progress!
    await settle(70)
    expect(f.of('completed')).toHaveLength(1)

    // Complete bg-t1 and stream assistant summary
    f.update({ sessionUpdate: 'tool_call_update', toolCallId: 'bg-t1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'All green' } }] })
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reactive wakeup succeeded!' } })

    // Settles cleanly after reactiveIdleMs
    await vi.waitFor(() => expect(f.of('completed')).toHaveLength(2), { timeout: 1_000 })
    expect(f.of('continuation-started')).toHaveLength(1)
    expect(f.of('reasoning').at(-1)?.text).toBe('Timer fired, verifying suite.')
    expect(f.of('tool').some(tool => tool.id === 'bg-t1' && tool.state === 'completed' && tool.output === 'All green')).toBe(true)
    expect(f.of('message').map(m => m.text)).toEqual(['Scheduled timer.', 'Reactive wakeup succeeded!'])
    expect(f.adapter.hasPendingBackground()).toBe(false)
    await f.adapter.dispose()
  })

  it('interrupts an active reactive wakeup cleanly and clears pending background protection', async () => {
    const f = createFixture({ adapterOptions: { reactiveIdleMs: 500 } })
    await f.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' }, f.emit)
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Waking up...' } })
    expect(f.of('continuation-started')).toHaveLength(1)
    expect(f.adapter.hasPendingBackground()).toBe(true)

    await f.adapter.interrupt()
    expect(f.of('completed').at(-1)).toEqual({ type: 'completed', status: 'interrupted' })
    expect(f.adapter.hasPendingBackground()).toBe(false)
    await f.adapter.dispose()
  })
})

describe('OXE-465 · Queue, steering & structured questions', () => {
  it('queues prompts FIFO while busy, supports update/reorder/delete, and dispatches via startQueued', async () => {
    const f = createFixture()
    await f.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' }, f.emit)
    await f.adapter.send('First')

    const q1 = await f.adapter.enqueue({ id: 'i1', text: 'Second', createdAt: 1, state: 'queued' })
    const q2 = await f.adapter.enqueue({ id: 'i2', text: 'Third', createdAt: 2, state: 'queued' })
    const q3 = await f.adapter.enqueue({ id: 'i3', text: 'Drop me', createdAt: 3, state: 'queued' })
    expect(q1 && q2 && q3).toBeTruthy()

    await f.adapter.updateQueued(q1!, { id: 'i1', text: 'Second edited', createdAt: 1, state: 'queued' })
    await f.adapter.deleteQueued(q3!)
    await f.adapter.reorderQueued([q2!, q1!])

    f.endTurn({ stopReason: 'end_turn' })
    await settle()

    await f.adapter.startQueued()
    expect((f.sent('session/prompt').at(-1)!.params as { prompt: Array<{ text: string }> }).prompt[0].text).toBe('Third')
    f.endTurn({ stopReason: 'end_turn' })
    await settle()

    await f.adapter.startQueued(q1)
    expect((f.sent('session/prompt').at(-1)!.params as { prompt: Array<{ text: string }> }).prompt[0].text).toBe('Second edited')
    f.endTurn({ stopReason: 'end_turn' })
    await settle()
    expect(f.of('completed')).toHaveLength(3)
    await f.adapter.dispose()
  })

  it('steers an active turn via cancel + re-dispatch without emitting an interrupted completion, and uses session/steer when advertised', async () => {
    const f = createFixture()
    await f.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' }, f.emit)
    await expect(f.adapter.steer('Too early')).rejects.toThrow(/no active turn/i)

    await f.adapter.send('Build with Postgres')
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Starting Postgres...' } })
    await f.adapter.steer('Actually use SQLite instead')

    // Old prompt was cancelled and replaced seamlessly without ending the turn as interrupted
    expect(f.sent('session/cancel')).toHaveLength(1)
    expect(f.sent('session/prompt')).toHaveLength(2)
    expect((f.sent('session/prompt')[1].params as { prompt: Array<{ text: string }> }).prompt[0].text).toBe('Actually use SQLite instead')
    expect(f.of('completed')).toHaveLength(0)

    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Switched to SQLite.' } })
    f.endTurn({ stopReason: 'end_turn' })
    await settle()
    expect(f.of('completed')).toEqual([{ type: 'completed', status: 'completed' }])
    await f.adapter.dispose()

    // Native steer when server advertises agentCapabilities.steer: true
    const native = createFixture({ agentCapabilities: { steer: true } })
    await native.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' }, native.emit)
    await native.adapter.send('Run suite')
    await native.adapter.steer('Focus on unit tests')
    expect(native.sent('session/steer')).toHaveLength(1)
    expect(native.sent('session/cancel')).toHaveLength(0)
    await native.adapter.dispose()
  })

  it('surfaces ask_question payloads as structured kind: question cards and never auto-approves them', async () => {
    const f = createFixture()
    await f.adapter.start({ rootPath: '/repo', nativeSessionId: null, access: 'full-access', approvalPolicy: 'never' }, f.emit)
    await f.adapter.send('Choose architecture')

    f.server({
      id: 41,
      method: 'session/request_permission',
      params: {
        sessionId: 'sess-465',
        toolCall: {
          toolCallId: 'q-tool-1',
          title: 'ask_question',
          kind: 'other',
          rawInput: {
            questions: [
              { question: 'Which storage engine?', options: ['(Recommended) SQLite', 'PostgreSQL'], is_multi_select: false }
            ]
          }
        },
        options: [
          { optionId: 'opt-sqlite', name: '(Recommended) SQLite', kind: 'allow_once' },
          { optionId: 'opt-pg', name: 'PostgreSQL', kind: 'allow_once' },
          { optionId: 'opt-cancel', name: 'Cancel', kind: 'reject_once' }
        ]
      }
    })

    // Never auto-approved even in full-access + never; emitted as kind: 'question' (no legacy approval event)
    expect(f.of('approval')).toHaveLength(0)
    const req = f.of('request')[0].request
    expect(req.kind).toBe('question')
    expect(req.questions).toEqual([
      {
        id: 'q-0',
        question: 'Which storage engine?',
        options: [
          { label: '(Recommended) SQLite', value: '(Recommended) SQLite' },
          { label: 'PostgreSQL', value: 'PostgreSQL' }
        ]
      }
    ])

    await expect(f.adapter.respondRequest('41', { answers: {} })).rejects.toThrow(/Answer every question/i)
    await f.adapter.respondRequest('41', { answers: { 'q-0': ['PostgreSQL'] } })
    expect(f.rpcResponseFor(41)).toEqual({
      id: 41,
      result: { outcome: { outcome: 'selected', optionId: 'opt-pg' }, answers: { 'q-0': ['PostgreSQL'] } }
    })
    expect(f.of('request-resolved')[0]).toMatchObject({ id: '41', state: 'resolved', resolution: 'answered' })
    await f.adapter.dispose()
  })
})
