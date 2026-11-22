// Who may run a desktop command (/permissions, /plan, /delete...) through a conversation's send.
// Only the app window's send does. Every other caller is refused, before anything is queued, saved or launched.
// Real ThreadManager on a temporary database and folder, with a fake agent: no agent is ever launched.
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { removeTempDir } from '../helpers/removeTempDir'
import type { AgentConversationAdapter, ThreadEvent, ThreadQueuedInput, ThreadSnapshot } from '../../shared/types/thread'
import type { DelegationTask } from '../../shared/types/delegation'
import type { Schedule } from '../../shared/schedule'

const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as object }))
class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.5.2', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))
hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain as FakeIpcMain

const { openInMemoryDatabase } = await import('../../electron/main/db/index')
const { registerThreadIpc } = await import('../../electron/main/ipc/thread.ipc')
const { ThreadManager } = await import('../../electron/main/services/conversation/thread-manager')
const { ExecutionRegistry } = await import('../../electron/main/services/execution-registry')
const { AgentActions } = await import('../../electron/main/services/agent-actions/agent-actions')
const { ApprovalBroker } = await import('../../electron/main/services/agent-actions/approval-broker')
const { findTool } = await import('../../electron/main/mcp-internal/tool-registry')
const { RemoteCommands } = await import('../../electron/main/services/remote/commands')
const { createRemoteDesktop } = await import('../../electron/main/services/remote/desktop')
const { scheduleThreadRunner } = await import('../../electron/main/services/schedules/thread-runner')
const { TeamDelivery } = await import('../../electron/main/services/coordination/team-delivery')
const { TeamRepository } = await import('../../electron/main/services/coordination/team-repository')
const { ThreadDelegationHost } = await import('../../electron/main/services/delegation/thread-delegation-host')
const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { DESKTOP_COMMANDS, CODEX_DESKTOP_COMMANDS } = await import('../../shared/threadDesktopCommands')

// A first turn runs git for its baseline and the project brief, which is slow on a loaded Windows machine.
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })

// The temp folder may sit inside someone's repository (a home folder under git): git never looks above a fixture.
vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync.native(tmpdir()))

const RAISE = '/permissions full-access'
const REFUSED = 'thread.command.windowOnly'

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
  ipc.handlers.clear()
  vi.restoreAllMocks()
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'oxe-send-origin-'))
  cleanups.push(() => removeTempDir(dir))
  execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true, stdio: 'ignore' })
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, windowsHide: true, encoding: 'utf8' }).trim()
  if (realpathSync.native(top) !== realpathSync.native(dir)) throw new Error('the fixture is not its own repository')
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  const emits: Array<(event: ThreadEvent) => void> = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = {
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { emits.push(emit); emit({ type: 'session', nativeSessionId: `native-${emits.length}` }) }),
      send: vi.fn(async () => {}), steer: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
      configure: vi.fn(async () => {})
    }
    adapters.push(adapter)
    return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })), stop: vi.fn() }
  const build = () => {
    const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
    cleanups.push(() => manager.stop())
    return manager
  }
  const manager = build()
  const create = (provider: 'claude' | 'codex' | 'antigravity' = 'claude') =>
    manager.create({ workspaceId: 'thread:project', projectId: 'project', rootPath: dir, provider, access: 'read-only' }).thread.id
  const access = (id: string) => manager.read(id).thread.access ?? 'read-only'
  const save = (snapshot: ThreadSnapshot, eventsFrom = snapshot.events.length) =>
    (manager as unknown as { save(value: ThreadSnapshot, options: { eventsFrom: number }): void }).save(snapshot, { eventsFrom })
  const agent = (origin: string) => {
    const executions = new ExecutionRegistry()
    const env = executions.register({ owner: { kind: 'thread', id: origin }, workspaceId: 'thread:project', cwd: dir })
    return {
      db, threads: Promise.resolve(manager), executions, workspaceId: 'thread:project',
      executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN,
      workspaceServ: { get: () => null, list: () => [] },
      agentActions: new AgentActions({ broker: new ApprovalBroker({ ask: async () => 'allow-once' }, Date.now, 50) })
    } as never
  }
  const handoff = async () => {
    const ctx = agent(create())
    const made = JSON.parse((await findTool('oxespace_thread_create')!.handler({ key: 'create-0001' }, ctx)).content[0].text!) as { threadId: string }
    return { ctx, child: made.threadId }
  }
  const phone = () => new RemoteCommands({
    desktop: createRemoteDesktop({ db, threads: manager, terminals: {}, agentState: {} } as never),
    now: () => Date.now(), phoneWrite: () => new Set<string>()
  })
  return { dir, db, manager, build, create, access, save, agent, handoff, phone, factory, adapters, emits }
}

async function busy(t: ReturnType<typeof setup>): Promise<string> {
  const id = t.create()
  await t.manager.send(id, 'Work on it')
  return id
}

describe('agents', () => {
  it('oxespace_thread_send cannot change access', async () => {
    const t = setup(), { ctx, child } = await t.handoff()
    await findTool('oxespace_thread_send')!.handler({ threadId: child, key: 'send-00001', text: RAISE }, ctx)
    expect(t.access(child)).toBe('read-only')
    expect(t.factory).not.toHaveBeenCalled()
  })

  it('an origin in the tool arguments is not an origin', async () => {
    const t = setup(), { ctx, child } = await t.handoff()
    await findTool('oxespace_thread_send')!.handler({ threadId: child, key: 'send-00002', text: RAISE, origin: 'window' }, ctx)
    expect(t.access(child)).toBe('read-only')
  })

  it('oxespace_threads_change send cannot, on a conversation the caller created', async () => {
    const t = setup(), { ctx, child } = await t.handoff()
    const answer = JSON.parse((await findTool('oxespace_threads_change')!.handler({ action: 'send', threadId: child, text: RAISE }, ctx)).content[0].text!) as { ok: boolean }
    expect(t.access(child)).toBe('read-only')
    expect(answer.ok).toBe(false)
  })

  it('oxespace_threads_change send cannot, even when a person approved the message', async () => {
    const t = setup(), peer = t.create(), ctx = t.agent(t.create())
    const answer = JSON.parse((await findTool('oxespace_threads_change')!.handler({ action: 'send', threadId: peer, text: RAISE }, ctx)).content[0].text!) as { ok: boolean }
    expect(t.access(peer)).toBe('read-only')
    expect(answer.ok).toBe(false)
  })

  it('oxespace_threads_change steer does not pass a desktop command on', async () => {
    const t = setup(), { ctx, child } = await t.handoff()
    await t.manager.send(child, 'Work on it')
    await findTool('oxespace_threads_change')!.handler({ action: 'steer', threadId: child, text: RAISE }, ctx)
    expect(t.adapters[0].steer).not.toHaveBeenCalled()
    expect(t.access(child)).toBe('read-only')
  })
})

describe('a paired phone', () => {
  it('thread.send cannot change access', async () => {
    const t = setup(), id = t.create()
    const answer = await t.phone().run('device', 'thread.send', { threadId: id, text: RAISE, clientId: 'client-000000000001' })
    expect(t.access(id)).toBe('read-only')
    expect(answer.ok).toBe(false)
  })

  it('thread.send cannot leave plan mode', async () => {
    const t = setup(), id = t.create()
    await t.manager.configure(id, { mode: 'plan' }, 0)
    await t.phone().run('device', 'thread.send', { threadId: id, text: '/plan off', clientId: 'client-000000000002' })
    expect(t.manager.read(id).thread.mode).toBe('plan')
  })

  it('thread.send cannot delete the conversation', async () => {
    const t = setup(), id = t.create()
    await t.phone().run('device', 'thread.send', { threadId: id, text: '/delete confirm', clientId: 'client-000000000003' })
    expect(t.manager.list().map(thread => thread.id)).toContain(id)
  })

  it('a steer, however it arrives, does not pass a desktop command on', async () => {
    const t = setup(), id = await busy(t)
    await expect(t.manager.steer(id, RAISE)).rejects.toThrow(REFUSED)
    expect(t.adapters[0].steer).not.toHaveBeenCalled()
  })
})

describe('schedules', () => {
  const schedule = (over: Record<string, unknown>) => ({ id: 's1', name: 'Morning review', projectId: 'project', provider: 'claude', access: 'read-only', prompt: 'Review what changed.', ...over }) as unknown as Schedule
  const runner = (t: ReturnType<typeof setup>) =>
    scheduleThreadRunner({ service: async () => t.manager, context: (projectId, rootPath) => ({ projectId, rootPath }) })

  it('a prompt that is a command cannot change access', async () => {
    const t = setup()
    await runner(t).start(schedule({ rootPath: t.dir, prompt: RAISE })).catch(() => undefined)
    for (const thread of t.manager.list()) expect(thread.access ?? 'read-only').toBe('read-only')
  })

  it.each(['full-access', '', undefined, null])('a stored access of %s is refused before anything is created', async stored => {
    const t = setup()
    await expect(runner(t).start(schedule({ rootPath: t.dir, access: stored }))).rejects.toThrow('thread.invalidInput')
    expect(t.manager.list()).toHaveLength(0)
  })
})

describe('the queue', () => {
  it('refuses a command from any other caller instead of queueing it', async () => {
    const t = setup(), id = await busy(t)
    await expect(t.manager.send(id, RAISE)).rejects.toThrow(REFUSED)
    expect(t.manager.read(id).thread.queue ?? []).toHaveLength(0)
  })

  it('keeps the window as the origin across a restart', async () => {
    const t = setup(), id = await busy(t)
    await t.manager.send(id, '/plan', [], 'window')
    expect((t.manager.read(id).thread.queue![0] as ThreadQueuedInput & { origin?: string }).origin).toBe('window')
    await t.manager.stop()
    expect((t.build().read(id).thread.queue![0] as ThreadQueuedInput & { origin?: string }).origin).toBe('window')
  })

  it('a window command that waited still runs when the turn ends', async () => {
    const t = setup(), id = await busy(t)
    await t.manager.send(id, '/plan', [], 'window')
    t.emits[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(t.manager.read(id).thread.mode).toBe('plan'), { timeout: 15_000, interval: 250 })
  })

  it('an item with no recorded origin never becomes a command', async () => {
    const t = setup(), id = t.create(), snapshot = t.manager.read(id)
    snapshot.thread.queue = [{ id: 'q1', text: RAISE, createdAt: 1, state: 'queued' }]
    snapshot.thread.queuePause = { reason: 'interrupted', since: 1 }
    t.save(snapshot)
    await t.manager.resumeQueue(id)
    expect(t.access(id)).toBe('read-only')
    expect(t.manager.read(id).thread.queue).toMatchObject([{ state: 'failed', error: REFUSED }])
  })
})

describe('what the app sends again or by itself', () => {
  it('retry never turns a stored prompt into a command', async () => {
    const t = setup(), id = await busy(t)
    t.emits[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(t.manager.read(id).turns?.at(-1)?.status).toBe('completed'), { timeout: 15_000 })
    const snapshot = t.manager.read(id), turn = snapshot.turns!.at(-1)!
    const at = snapshot.events.findIndex(event => event.type === 'message' && event.id === turn.id)
    ;(snapshot.events[at] as { text: string }).text = RAISE
    t.save(snapshot, at)
    // Finalizing may still hold the turn for a moment: wait until retry is refused by the rule itself, not by that.
    await vi.waitFor(async () => { await expect(t.manager.retryTurn(id, turn.id)).rejects.toThrow(REFUSED) }, { timeout: 15_000, interval: 250 })
    expect(t.access(id)).toBe('read-only')
  })

  // commandHost is what crash recovery and the command router send through.
  it.each(['commandHost', 'retryHost', 'queueHost'])('%s cannot dispatch', async name => {
    const t = setup(), id = t.create()
    const host = (t.manager as unknown as Record<string, () => { send(...args: unknown[]): Promise<void> }>)[name]()
    const call = host.send(id, RAISE, [])
    await expect(call).rejects.toThrow(REFUSED)
    expect(t.access(id)).toBe('read-only')
  })

  it('crash recovery sends without the window origin', async () => {
    const { runCrashRecoveryCommand } = await import('../../electron/main/services/conversation/thread-crash-recovery')
    const send = vi.fn(async () => {})
    const snapshot = { thread: { id: 't' }, events: [{ type: 'tool', id: 'x', name: 'Bash', state: 'unknown', detail: RAISE, interrupted: true }] }
    await runCrashRecoveryCommand({ read: () => snapshot, save: () => {}, send } as never, 't', '/continue-interrupted')
    expect(send).toHaveBeenCalledTimes(1)
    for (const call of send.mock.calls as unknown as unknown[][]) {
      expect(call).toHaveLength(2)
      expect(String(call[1]).trim().startsWith('/')).toBe(false)
    }
  })

  it('team delivery sends without the window origin', async () => {
    const t = setup(), repository = new TeamRepository(t.db)
    let team = repository.ensure('project', 'Project')
    team = repository.add(team.id, team.revision, 'Developer', 'developer')
    const member = team.members[0]
    repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key: 'one', kind: 'request', body: RAISE })
    const threads = { read: () => ({ thread: { status: 'idle', connection: { state: 'connected' } }, events: [] }) as unknown as ThreadSnapshot, send: vi.fn(async () => {}) }
    await new TeamDelivery(t.db, { deliveryTargets: () => [{ teamId: team.id, memberId: member.id, threadId: 'member-thread' }], disableDelivery: () => {} } as never, threads).tick()
    expect(threads.send).toHaveBeenCalledTimes(1)
    const call = threads.send.mock.calls[0] as unknown as unknown[]
    expect(call).toHaveLength(2)
    expect(String(call[1]).startsWith('/')).toBe(false)
  })

  it.each([['analysis', 'read-only'], ['isolated-change', 'workspace-write']])('delegation in %s keeps %s and sends without the window origin', async (mode, expected) => {
    const thread = { id: 'worker', workspaceId: 'w', projectId: 'p', rootPath: '/work/card', provider: 'codex', nativeSessionId: null as string | null, status: 'idle', configurationRevision: 0 }
    const executions = new ExecutionRegistry()
    const send = vi.fn(async () => {
      executions.register({ owner: { kind: 'thread', id: thread.id }, workspaceId: 'w', cwd: thread.rootPath })
      thread.nativeSessionId = 'native-1'
    })
    const configure = vi.fn(async () => ({}))
    const manager = { create: () => ({ thread, events: [] }), read: () => ({ thread, events: [] }), configure, send }
    const task = { id: 'task-1', agentProfileId: 'codex', objective: RAISE, handoff: RAISE, acceptance: 'Tests pass', mode, surface: 'thread', workspaceId: 'w', project: 'p', cwd: '/work', path: '/work/card', branch: 'b', state: 'starting', createdAt: 1, updatedAt: 1 } as unknown as DelegationTask
    await new ThreadDelegationHost(Promise.resolve(manager as never), executions, () => 'codex').start(task)
    expect((configure.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({ access: expected })
    const call = send.mock.calls[0] as unknown as unknown[]
    expect(call).toHaveLength(2)
    expect(String(call[1]).startsWith('/')).toBe(false)
  })
})

describe('the rule itself', () => {
  it.each(['claude', 'codex', 'antigravity'] as const)('refuses every desktop command of %s from a caller that is not the window', async provider => {
    const t = setup(), id = t.create(provider)
    const run = vi.spyOn(t.manager, 'command').mockResolvedValue({ kind: 'applied' } as never)
    const names = [...DESKTOP_COMMANDS, ...(provider === 'codex' ? CODEX_DESKTOP_COMMANDS : [])].filter(name => !['compact', 'review'].includes(name))
    const passed: string[] = []
    for (const name of names) {
      const error = await t.manager.send(id, `/${name}`).then(() => '', (cause: Error) => cause.message)
      if (error !== REFUSED) passed.push(name)
    }
    expect(passed).toEqual([])
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['  /permissions full-access', '/permissions\nfull-access', '/permissions\tfull-access', '/Permissions full-access', '/approvals full-access', '/allowed-tools full-access'])('refuses the form %j', async text => {
    const t = setup(), id = t.create()
    await expect(t.manager.send(id, text)).rejects.toThrow(REFUSED)
    expect(t.access(id)).toBe('read-only')
    expect(t.factory).not.toHaveBeenCalled()
  })

  it.each(['execute-plan', 'Window', 'anything'])('origin %s is not the window', async origin => {
    const t = setup(), id = t.create()
    await expect(t.manager.send(id, RAISE, [], origin as never)).rejects.toThrow(REFUSED)
  })

  it('leaves ordinary messages, paths and compact alone', async () => {
    for (const text of ['Run the tests', '/api/login is broken', '/compact']) {
      const t = setup(), id = t.create()
      await t.manager.send(id, text)
      expect(t.adapters[0].send).toHaveBeenCalledTimes(1)
    }
  })

  it('a window message is saved as a plain message: the origin is not part of the history', async () => {
    const t = setup(), id = t.create()
    await t.manager.send(id, 'Run the tests', [], 'window')
    const saved = t.manager.read(id).events.find(event => event.type === 'message' && event.role === 'user')
    expect(saved).toMatchObject({ text: 'Run the tests' })
    expect(saved).not.toHaveProperty('origin')
  })

  it('the window still runs a command', async () => {
    const t = setup(), id = t.create()
    await t.manager.send(id, '/permissions workspace-write', [], 'window')
    expect(t.access(id)).toBe('workspace-write')
  })

  it('a message from the window still gets the project brief and mentions', async () => {
    const t = setup(), id = t.create()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(t.dir, 'notes.txt'), 'mentioned content\n')
    await t.manager.send(id, 'Read @notes.txt', [], 'window')
    expect(vi.mocked(t.adapters[0].send).mock.calls[0][0]).toContain('mentioned content')
  })
})

describe('the window', () => {
  it('its send handler is the one caller that passes the window origin', async () => {
    const t = setup()
    const send = vi.spyOn(ThreadManager.prototype, 'send').mockResolvedValue(undefined)
    const runtime = registerThreadIpc(t.db, { bridge: join(t.dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
    cleanups.push(() => runtime.stop())
    await ipc.handlers.get(IPC_CHANNELS.thread.send)!({ sender: {}, senderFrame: {} }, 'thread-id', '/plan', [])
    expect(send).toHaveBeenCalledWith('thread-id', '/plan', [], 'window')
  })

  it.each([['a resend', { resend: true }], ['an unknown option', { anything: 1 }], ['false', false]])('%s through the window is not the window origin', async (_name, options) => {
    const t = setup()
    const send = vi.spyOn(ThreadManager.prototype, 'send').mockResolvedValue(undefined)
    const runtime = registerThreadIpc(t.db, { bridge: join(t.dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
    cleanups.push(() => runtime.stop())
    await ipc.handlers.get(IPC_CHANNELS.thread.send)!({ sender: {}, senderFrame: {} }, 'thread-id', RAISE, [], options)
    expect(send.mock.calls[0][3]).toBeUndefined()
    expect(send.mock.calls[0][1]).toBe(RAISE)
  })

  it('stored text resent by a click never changes access', async () => {
    const t = setup()
    const runtime = registerThreadIpc(t.db, { bridge: join(t.dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
    cleanups.push(() => runtime.stop())
    const manager = await runtime.manager
    const id = manager.create({ workspaceId: 'thread:project', projectId: 'project', rootPath: t.dir, provider: 'claude', access: 'read-only' }).thread.id
    await Promise.resolve(ipc.handlers.get(IPC_CHANNELS.thread.send)!({ sender: {}, senderFrame: {} }, id, RAISE, [], { resend: true })).catch(() => undefined)
    expect(manager.read(id).thread.access).toBe('read-only')
  })
})
