import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', 'builtin-claude')").run('A', 'A', '/project-A')
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
    adapters.push(adapter); return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low'], defaultEffort: 'low' }] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models)
  const create = () => manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'codex' }).thread.id
  return { manager, adapters, callbacks, create }
}

const sent = (adapter: AgentConversationAdapter) => vi.mocked(adapter.send).mock.calls.map(call => call[0])

describe('thread queue pause', () => {
  it('keeps the next queued message waiting after an interrupted turn', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await new Promise(resolve => setTimeout(resolve, 20))
    const thread = f.manager.read(id).thread
    expect(thread.queuePause).toMatchObject({ reason: 'interrupted' })
    expect(thread.queue).toMatchObject([{ text: 'Second', state: 'queued' }])
    expect(sent(f.adapters[0])).toEqual(['First'])
    await f.manager.stop()
  })

  it('pauses after a failed turn and resumes on request', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    f.callbacks[0]({ type: 'completed', status: 'failed', error: 'boom' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(f.manager.read(id).thread.queuePause).toMatchObject({ reason: 'failed' })
    await f.manager.resumeQueue(id)
    expect(f.manager.read(id).thread.queuePause).toBeUndefined()
    expect(sent(f.adapters[0])).toEqual(['First', 'Second'])
    await f.manager.stop()
  })

  it('drains on its own after a successful turn', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(sent(f.adapters[0])).toEqual(['First', 'Second']))
    expect(f.manager.read(id).thread.queuePause).toBeUndefined()
    await f.manager.stop()
  })

  it('sends a chosen item first and leaves the rest queued', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    await f.manager.send(id, 'Third')
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await new Promise(resolve => setTimeout(resolve, 20))
    const third = f.manager.read(id).thread.queue!.find(item => item.text === 'Third')!
    await f.manager.sendQueuedNow(id, third.id)
    expect(sent(f.adapters[0])).toEqual(['First', 'Third'])
    expect(f.manager.read(id).thread.queue).toMatchObject([{ text: 'Second', state: 'queued' }])
    await f.manager.stop()
  })

  it('lifts the pause when the user empties the queue or sends directly', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await new Promise(resolve => setTimeout(resolve, 20))
    await f.manager.deleteQueued(id, f.manager.read(id).thread.queue![0].id)
    expect(f.manager.read(id).thread.queuePause).toBeUndefined()
    await f.manager.stop()
  })

  it('keeps the pause across an application restart', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    f.callbacks[0]({ type: 'completed', status: 'failed' })
    await new Promise(resolve => setTimeout(resolve, 20))
    await f.manager.stop()
    expect(f.manager.read(id).thread).toMatchObject({ queuePause: { reason: 'failed' }, queue: [{ state: 'queued' }] })
  })

  it('sends a queued message now by stopping the running turn, without pausing the rest of the queue', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    await f.manager.send(id, 'Third')
    const third = f.manager.read(id).thread.queue!.find(item => item.text === 'Third')!
    await f.manager.sendQueuedNow(id, third.id)
    expect(f.adapters[0].interrupt).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).thread.queue!.map(item => item.text)).toEqual(['Third', 'Second'])
    // The stop the user asked for ends the turn as interrupted; Third goes next and Second keeps waiting its turn.
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await vi.waitFor(() => expect(sent(f.adapters[0])).toEqual(['First', 'Third']))
    expect(f.manager.read(id).thread.queuePause).toBeUndefined()
    expect(f.manager.read(id).thread.queue!.map(item => item.text)).toEqual(['Second'])
    await f.manager.stop()
  })

  it('still pauses after a later stop the user did not make to send something', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First')
    await f.manager.send(id, 'Second')
    await f.manager.send(id, 'Third')
    await f.manager.sendQueuedNow(id, f.manager.read(id).thread.queue![0].id)
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await vi.waitFor(() => expect(sent(f.adapters[0])).toEqual(['First', 'Second']))
    // A plain stop of the turn Send now started: Third must wait for the user, as after any stop.
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(f.manager.read(id).thread).toMatchObject({ queuePause: { reason: 'interrupted' }, queue: [{ text: 'Third', state: 'queued' }] })
    expect(sent(f.adapters[0])).toEqual(['First', 'Second'])
    await f.manager.stop()
  })
})
