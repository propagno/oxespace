// Frozen acceptance test for 1.5.0 A21 / T76 (OXE program, phase F6): "Steer with this" on a queued message. While the
// agent works and the provider can steer, a queued message is sent as a steer (the agent reads it after its current
// step) and leaves the queue; otherwise it is refused and stays queued. "Send now" is the existing sendQueuedNow.
// Written by the planner; the executor must not edit it. A fake provider adapter only; no live provider.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A21; DESIGN 1.5.0-f6-design.md U6.3.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f6/a21-steer-queued.native.test.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { messageFromError } from '../../../shared/messages'
import type { AgentConversationAdapter, ThreadEvent } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 30_000 })
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) { try { await step() } catch { /* temp */ } } })
const settle = (ms = 200) => new Promise(resolve => setTimeout(resolve, ms))

function fixture(options: { canSteer: boolean }) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f6-steer-')))
  cleanup.push(() => removeTempDir(root))
  // A real checkout as the project, as a conversation's root always is: no git lookup waits on a non-repository.
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(root, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'init')
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const steer = vi.fn(async () => {})
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false, ...(options.canSteer ? { steering: true } : {}) },
    start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: 'native-1' }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    respondRequest: vi.fn(async () => {}),
    ...(options.canSteer ? { steer } : {})
  }) as AgentConversationAdapter)
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  cleanup.push(() => manager.stop())
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'claude' }).thread.id
  const read = () => new ThreadHistory(db).read(id)
  return { manager, id, steer, callbacks, read }
}

/** A running turn with one message queued behind it. */
async function queuedWhileRunning(f: ReturnType<typeof fixture>) {
  await f.manager.send(f.id, 'Start the work')
  await settle()
  // A queued send resolves only once it is delivered, so it is not awaited here.
  void f.manager.send(f.id, 'Also update the README').catch(() => undefined)
  const end = Date.now() + 5000
  for (;;) {
    const item = f.read().thread.queue?.find(entry => entry.state === 'queued')
    if (item) return item
    if (Date.now() > end) throw new Error('no queued item')
    await settle(50)
  }
}

describe('A21 · Steer with this (T76)', () => {
  test('A21: while the agent works, a queued message steers the turn and leaves the queue', async () => {
    const f = fixture({ canSteer: true })
    const item = await queuedWhileRunning(f)
    await f.manager.steerQueued(f.id, item.id)
    expect(f.steer).toHaveBeenCalledTimes(1)
    expect(f.steer.mock.calls[0]?.[0]).toBe('Also update the README')
    expect(f.read().thread.queue?.some(entry => entry.id === item.id)).toBe(false)
    // It shows in the conversation as the person's message, once.
    expect(f.read().events.filter(event => event.type === 'message' && event.role === 'user' && event.text === 'Also update the README')).toHaveLength(1)
  })

  test('A21: a provider that cannot steer refuses with thread.steer.unavailable and the message stays queued', async () => {
    const f = fixture({ canSteer: false })
    const item = await queuedWhileRunning(f)
    const error = await f.manager.steerQueued(f.id, item.id).then(() => null, (cause: unknown) => cause)
    expect(messageFromError(error)).toEqual({ code: 'thread.steer.unavailable', params: {} })
    expect(f.read().thread.queue?.find(entry => entry.id === item.id)?.state).toBe('queued')
  })

  test('A21: when the turn has ended, steering is refused the same way and nothing is sent', async () => {
    const f = fixture({ canSteer: true })
    const item = await queuedWhileRunning(f)
    // The turn ends without completing: the queue pauses (queuePause), so the item is still waiting, with no turn running.
    f.callbacks[0]({ type: 'completed', status: 'interrupted' })
    await settle(400)
    expect(f.read().thread.queue?.find(entry => entry.id === item.id)?.state).toBe('queued')
    const error = await f.manager.steerQueued(f.id, item.id).then(() => null, (cause: unknown) => cause)
    expect(messageFromError(error)).toEqual({ code: 'thread.steer.unavailable', params: {} })
    expect(f.steer).not.toHaveBeenCalled()
  })

  test('A21: an unknown queued item is refused without steering', async () => {
    const f = fixture({ canSteer: true })
    await queuedWhileRunning(f)
    await expect(f.manager.steerQueued(f.id, 'no-such-item')).rejects.toThrow()
    expect(f.steer).not.toHaveBeenCalled()
  })
})
