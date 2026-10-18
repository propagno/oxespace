import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

const LATER = 16 * 60_000

function fixture(db = openInMemoryDatabase()) {
  if (!databases.includes(db)) databases.push(db)
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const starts: (string | null)[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (context, emit) => { starts.push(context.nativeSessionId); callbacks.push(emit); if (!context.nativeSessionId) emit({ type: 'session', nativeSessionId: 'native-1' }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
    adapters.push(adapter); return adapter
  })
  const manager = new ThreadManager(db, factory, vi.fn())
  vi.spyOn(manager as unknown as { workingState: () => Promise<undefined> }, 'workingState').mockResolvedValue(undefined)
  const create = () => manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
  /** Sends one message and lets the provider finish the turn. */
  const turn = async (id: string, text = 'Hello') => {
    await manager.send(id, text)
    callbacks.at(-1)!({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(manager.read(id).thread.status).toBe('idle'))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { db, manager, factory, adapters, callbacks, starts, create, turn }
}

describe('idle conversation suspension', () => {
  it('closes the agent process of an idle conversation and resumes the same session with the next message', async () => {
    const f = fixture(), id = f.create()
    await f.turn(id)
    expect(await f.manager.suspendIdle(Date.now() + 60_000)).toEqual([])
    expect(await f.manager.suspendIdle(Date.now() + LATER)).toEqual([id])
    expect(f.adapters[0].dispose).toHaveBeenCalledOnce()
    const thread = f.manager.read(id).thread
    expect(thread.connection).toMatchObject({ state: 'closed' })
    expect(thread.connection?.suspendedAt).toBeTypeOf('number')
    expect(thread.nativeSessionId).toBe('native-1')

    await f.turn(id, 'Follow-up')
    expect(f.factory).toHaveBeenCalledTimes(2)
    expect(f.starts).toEqual([null, 'native-1'])
    expect(f.manager.read(id).thread.connection?.suspendedAt).toBeUndefined()
    await f.manager.stop()
  })

  it('keeps the process while a turn runs, a task runs in the background, input is queued or a grant lives in the session', async () => {
    const f = fixture()
    const running = f.create()
    await f.manager.send(running, 'Long task')
    expect(await f.manager.suspendIdle(Date.now() + LATER)).toEqual([])

    const background = f.create()
    await f.turn(background)
    f.callbacks.at(-1)!({ type: 'subagent', id: 'task', action: 'Background command', state: 'running', receiverThreadIds: ['task'], agents: [] })

    const granted = f.create()
    await f.turn(granted)
    await f.manager.respond(granted, 'request-1', { decision: 'acceptForSession' })

    expect(await f.manager.suspendIdle(Date.now() + LATER)).toEqual([])
    expect(f.adapters.every(adapter => !vi.mocked(adapter.dispose).mock.calls.length)).toBe(true)
    await f.manager.stop()
  })

  it('stores the idle limit, refuses other values and never suspends when it is off', async () => {
    const f = fixture(), id = f.create()
    expect(f.manager.idleSuspendMinutes()).toBe(15)
    expect(() => f.manager.setIdleSuspendMinutes(7)).toThrow('Choose one of')
    expect(f.manager.setIdleSuspendMinutes(0)).toBe(0)
    await f.turn(id)
    expect(await f.manager.suspendIdle(Date.now() + 24 * 60 * 60_000)).toEqual([])
    f.manager.setIdleSuspendMinutes(5)
    expect(await f.manager.suspendIdle(Date.now() + 6 * 60_000)).toEqual([id])
    await f.manager.stop()
  })

  it('does not show a suspended conversation as suspended after a restart', async () => {
    const first = fixture(), id = first.create()
    await first.turn(id)
    await first.manager.suspendIdle(Date.now() + LATER)
    await first.manager.stop()
    const second = fixture(first.db)
    expect(second.manager.read(id).thread.connection?.suspendedAt).toBeUndefined()
    await second.manager.stop()
  })
})
