import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture(withStop: boolean) {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  let emit: (event: ThreadEvent) => void = () => {}
  const stopTask = vi.fn(async () => {})
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false, stopTasks: withStop },
    start: vi.fn(async (_context, callback) => { emit = callback; callback({ type: 'session', nativeSessionId: 'native-1' }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    ...(withStop ? { stopTask } : {})
  }) as AgentConversationAdapter)
  const manager = new ThreadManager(db, factory, vi.fn())
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
  return { manager, id, stopTask, emit: (event: ThreadEvent) => emit(event) }
}

const task = (state: 'running' | 'completed'): ThreadEvent => ({ type: 'subagent', id: 'claude-task:native-1:bash_1', action: 'Background command', state, receiverThreadIds: ['bash_1'], agents: [{ threadId: 'bash_1', status: state }] })

describe('stopping a background task from a Thread', () => {
  it('forwards the stop to the adapter for a running task only', async () => {
    const f = fixture(true)
    await f.manager.send(f.id, 'Start a watcher')
    f.emit(task('running'))
    await f.manager.stopTask(f.id, 'bash_1')
    expect(f.stopTask).toHaveBeenCalledWith('bash_1')
    await expect(f.manager.stopTask(f.id, 'other')).rejects.toThrow('no longer running')
    f.emit(task('completed'))
    await expect(f.manager.stopTask(f.id, 'bash_1')).rejects.toThrow('no longer running')
    await f.manager.stop()
  })

  it('refuses when the provider cannot stop tasks', async () => {
    const f = fixture(false)
    await f.manager.send(f.id, 'Start')
    f.emit(task('running'))
    await expect(f.manager.stopTask(f.id, 'bash_1')).rejects.toThrow('cannot stop background tasks')
    await f.manager.stop()
  })
})
