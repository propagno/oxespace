import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  let release: () => void = () => {}
  const factoryGate = { wait: false }
  const factory = vi.fn(async () => {
    if (factoryGate.wait) await new Promise<void>(resolve => { release = resolve })
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
    adapters.push(adapter); return adapter
  })
  const manager = new ThreadManager(db, factory, vi.fn())
  vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  const create = () => manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
  return { db, manager, factory, adapters, callbacks, create, factoryGate, release: () => release() }
}

describe('Thread runtime under concurrency', () => {
  it('starts one turn for two sends that arrive together; the second waits in the queue', async () => {
    const f = fixture(), id = f.create()
    await Promise.all([f.manager.send(id, 'First'), f.manager.send(id, 'Second')])
    expect(f.factory).toHaveBeenCalledTimes(1)
    expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).thread.queue?.map(item => item.text)).toEqual(['Second'])
    await f.manager.stop()
  })

  it('shares one provider connection between callers that arrive while it is opening', async () => {
    const f = fixture(), id = f.create()
    f.factoryGate.wait = true
    const thread = f.manager.read(id).thread
    const connect = (f.manager as unknown as { connectAdapter: (id: string, thread: unknown, preflight?: boolean) => Promise<AgentConversationAdapter> }).connectAdapter.bind(f.manager)
    const first = connect(id, thread, false), second = connect(id, thread, false)
    await vi.waitFor(() => expect(f.factory).toHaveBeenCalledTimes(1))
    f.release()
    expect(await first).toBe(await second)
    expect(f.factory).toHaveBeenCalledTimes(1)
    await f.manager.stop()
  })

  it('keeps a bounded set of idle conversation histories in memory', async () => {
    const f = fixture()
    const ids = Array.from({ length: 30 }, () => f.create())
    for (const id of ids) f.manager.read(id)
    const cache = (f.manager as unknown as { snapshots: Map<string, unknown> }).snapshots
    expect(cache.size).toBeLessThanOrEqual(12)
    expect(cache.has(ids.at(-1)!)).toBe(true)
    // An evicted conversation reads back from the database unchanged.
    expect(f.manager.read(ids[0]).thread.id).toBe(ids[0])
    await f.manager.stop()
  })

  it('forgets a deleted conversation entirely', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Hello')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(f.manager.read(id).thread.status).toBe('idle'))
    await f.manager.command(id, '/delete confirm')
    const state = f.manager as unknown as { snapshots: Map<string, unknown>; lastActivity: Map<string, unknown> }
    expect(state.snapshots.has(id)).toBe(false)
    expect(state.lastActivity.has(id)).toBe(false)
    await f.manager.stop()
  })
})
