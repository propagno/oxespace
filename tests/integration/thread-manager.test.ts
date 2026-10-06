import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { ThreadAgentError, threadFailure } from '../../electron/main/services/conversation/thread-failure'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture(preflight?: ConstructorParameters<typeof ThreadManager>[3], commands?: ConstructorParameters<typeof ThreadManager>[4], cli?: ConstructorParameters<typeof ThreadManager>[5], attachments?: ConstructorParameters<typeof ThreadManager>[7], stateReader?: ConstructorParameters<typeof ThreadManager>[8]) {
  const db = openInMemoryDatabase(); databases.push(db)
  for (const id of ['A', 'B']) db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', 'builtin-claude')").run(id, id, `/project-${id}`)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = { capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: `native-${callbacks.length}` }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
    adapters.push(adapter); return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), preflight, commands, cli, models, attachments, stateReader)
  const create = (workspaceId = 'A') => manager.create({ workspaceId, projectId: `project-${workspaceId}`, rootPath: `/project-${workspaceId}`, provider: 'codex' }).thread.id
  return { db, manager, factory, adapters, callbacks, create }
}

describe('thread persistence and ownership', () => {
  it('does not suppress a distinct case-sensitive working-tree file reported by the provider', async () => {
    const f = fixture(), id = f.create()
    const workingState = vi.spyOn(f.manager as unknown as { workingState: (path: string) => Promise<{ patch: string; untracked: Set<string> }> }, 'workingState')
    workingState.mockResolvedValueOnce({ patch: '', untracked: new Set() })
      .mockResolvedValue({ patch: '', untracked: new Set(['readme.md']) })
    await f.manager.send(id, 'Update files')
    f.callbacks[0]({ type: 'turn-diff', id: 'turn-diff:native', turnId: 'native', files: [{ path: 'README.md', kind: 'add' }] })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(workingState).toHaveBeenCalledTimes(2))
    await f.manager.stop()
    const observed = new ThreadHistory(f.db).read(id).events.filter(event => event.type === 'turn-diff' && event.id.startsWith('verified-diff:'))
    if (process.platform === 'win32') expect(observed).toEqual([])
    else expect(observed).toContainEqual(expect.objectContaining({ files: [expect.objectContaining({ path: 'readme.md' })] }))
  })
  it('persists late task results and native continuation without repeating user input', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Coordinate two tasks')
    f.callbacks[0]({ type: 'subagent', id: 'task-A', action: 'Agent', state: 'running', receiverThreadIds: ['A'], agents: [{ threadId: 'A', status: 'running' }] })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    f.callbacks[0]({ type: 'subagent', id: 'task-A', action: 'Agent', state: 'completed', receiverThreadIds: ['A'], agents: [{ threadId: 'A', status: 'completed', message: 'Result A' }] })
    expect(f.manager.read(id).thread.status).toBe('idle')
    f.callbacks[0]({ type: 'continuation-started', id: 'continuation', at: Date.now() })
    expect(f.manager.read(id).thread.status).toBe('running')
    f.callbacks[0]({ type: 'message', id: 'summary', role: 'assistant', text: 'Consolidation' })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    expect(f.manager.read(id).turns).toHaveLength(2)
    expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).events.filter(event => event.type === 'subagent')).toHaveLength(1)
    await f.manager.stop()
  })

  it.each(['complete', 'incomplete', 'changed', 'disk-error'])('reconciles a live turn without replay, preserving ownership on %s', async scenario => {
    const terminal = { state: 'completed' as const, source: 'codex-app-server' as const, nativeTurnId: 'native-turn', observedAt: 123, detail: 'Confirmed' }
    const reader = { observe: vi.fn(), recover: vi.fn(async () => ({ ...terminal, ...(scenario === 'incomplete' ? {} : { recoveredMessages: [{ type: 'message' as const, id: 'answer', role: 'assistant' as const, text: 'Full response' }] }) })), stop: vi.fn(async () => {}) }
    const f = fixture(undefined, undefined, undefined, undefined, reader), id = f.create()
    await f.manager.send(id, 'Original request')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'native-turn', at: 1 })
    f.callbacks[0]({ type: 'message', id: 'answer', role: 'assistant', text: 'Partial' })
    f.manager.read(id).thread.queue = [{ id: 'next', text: 'Must not start', createdAt: 1, state: 'queued' }]
    f.adapters[0].observe = vi.fn(async () => terminal)
    f.adapters[0].commitRecoveredTurn = vi.fn((_turn, _state, commit) => {
      if (scenario === 'changed') return false
      commit(); return true
    })
    if (scenario === 'disk-error') f.db.exec("CREATE TRIGGER reject_recovery BEFORE UPDATE ON conversation_threads BEGIN SELECT RAISE(ABORT, 'Recovery disk error'); END")
    if (scenario === 'disk-error') {
      await expect(f.manager.observe(id)).rejects.toThrow('Recovery disk error')
      f.db.exec('DROP TRIGGER reject_recovery')
    } else await f.manager.observe(id)
    const recovered = f.manager.read(id)
    expect(recovered.thread.status).toBe(scenario === 'complete' ? 'idle' : 'running')
    expect(recovered.events.find(event => event.type === 'message' && event.id === 'answer')).toMatchObject({ text: scenario === 'complete' ? 'Full response' : 'Partial' })
    expect(new ThreadHistory(f.db).operations(id).at(-1)?.state).toBe(scenario === 'complete' ? 'completed' : 'running')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).thread.queue).toMatchObject([{ state: 'queued', text: 'Must not start' }])
    if (scenario === 'complete') {
      await f.manager.send(id, 'Explicit new request')
      expect(f.adapters[0].send).toHaveBeenCalledTimes(2)
    }
    await f.manager.stop()
  })
  it.each([false, true])('recovers unknown tools on an idle connected adapter only if confirmation agrees (changed=%s)', async changed => {
    const terminal = { state: 'completed' as const, source: 'codex-app-server' as const, nativeTurnId: 'native-turn', observedAt: 123, detail: 'Confirmed' }
    const reader = { observe: vi.fn(), recover: vi.fn(async () => ({ ...terminal, recoveredMessages: [], recoveredItems: [{ type: 'tool' as const, id: 'tool', name: 'commandExecution', state: 'completed' as const, detail: 'npm test', exitCode: 0 }] })), stop: vi.fn(async () => {}) }
    const f = fixture(undefined, undefined, undefined, undefined, reader), id = f.create()
    await f.manager.send(id, 'Run tests')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'native-turn', at: 1 })
    f.callbacks[0]({ type: 'tool', id: 'tool', name: 'commandExecution', state: 'running', detail: 'npm test' })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await Promise.resolve()
    f.manager.read(id).thread.queue = [{ id: 'next', text: 'Do not resend', createdAt: 1, state: 'unknown' }]
    f.adapters[0].observe = vi.fn().mockResolvedValueOnce(terminal).mockResolvedValueOnce(changed ? { ...terminal, state: 'running' } : terminal)
    const observation = await f.manager.observe(id)
    expect(observation.state).toBe(changed ? 'unknown' : 'completed')
    expect(f.manager.read(id).events.find(event => event.type === 'tool')).toMatchObject({ state: changed ? 'unknown' : 'completed' })
    expect(f.adapters[0].dispose).not.toHaveBeenCalled()
    expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).thread.queue).toMatchObject([{ state: 'unknown' }])
    expect(reader.recover).toHaveBeenCalledOnce()
    await f.manager.stop()
  })
  it('stores recovered patch evidence as an artifact in the same recovery transaction', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Edit a file')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'native-turn', at: 1 })
    f.callbacks[0]({ type: 'tool', id: 'patch', name: 'fileChange', state: 'running', detail: 'a.ts' })
    await f.manager.stop()
    const patch = '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
    const recovery: import('../../electron/main/services/conversation/codex-state-reader').NativeStateResult = { state: 'completed', source: 'codex-app-server', nativeTurnId: 'native-turn', observedAt: 123, detail: 'Confirmed', recoveredMessages: [], recoveredItems: [{ type: 'tool', id: 'patch', name: 'fileChange', state: 'completed', detail: 'a.ts', turnId: 'native-turn', files: [{ path: 'a.ts', kind: 'update', state: 'completed', source: 'native-patch', authorship: 'provider', patch }] }] }
    const reader = { observe: vi.fn(), recover: vi.fn(async () => recovery), stop: vi.fn(async () => {}) }
    const manager = new ThreadManager(f.db, f.factory, vi.fn(), undefined, undefined, undefined, undefined, undefined, reader)
    expect(await manager.observe(id)).not.toHaveProperty('recoveredItems')
    const tool = manager.read(id).events.find(event => event.type === 'tool')
    expect(tool).toMatchObject({ state: 'completed', files: [{ artifactId: expect.any(String), additions: 1, deletions: 1, authorship: 'provider' }] })
    if (tool?.type !== 'tool') throw Error('Missing recovered tool')
    expect(tool.files![0]).not.toHaveProperty('patch')
    expect(new ThreadHistory(f.db).artifact(id, tool.files![0].artifactId!).content).toBe(patch)
    expect(manager.read(id).events.filter(event => event.type === 'tool')).toHaveLength(1)
    await manager.stop()
  })
  it('discards recovered output if the native identity changes while the provider is queried', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Original')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'old-turn', at: 1 })
    await f.manager.stop()
    let finish!: (value: import('../../electron/main/services/conversation/codex-state-reader').NativeStateResult) => void
    const passive = { observe: vi.fn(), recover: vi.fn(() => new Promise<import('../../electron/main/services/conversation/codex-state-reader').NativeStateResult>(resolve => { finish = resolve })), stop: vi.fn(async () => {}) }
    const manager = new ThreadManager(f.db, f.factory, vi.fn(), undefined, undefined, undefined, undefined, undefined, passive)
    const before = [...manager.read(id).events]
    const query = manager.observe(id)
    manager.read(id).thread.nativeSessionId = 'replacement-session'
    finish({ state: 'completed', source: 'codex-app-server', observedAt: 100, nativeTurnId: 'old-turn', detail: 'Old', recoveredMessages: [{ type: 'message', id: 'old-answer', role: 'assistant', text: 'Must not appear' }] })
    await expect(query).rejects.toThrow('conversation changed')
    expect(manager.read(id).events).toEqual(before)
    await manager.stop()
  })
  it('recovers a partial response and terminal journal after restart without draining the queue', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Original request')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'acknowledged', at: Date.now() })
    f.callbacks[0]({ type: 'message', id: 'answer', role: 'assistant', text: 'Partial' })
    f.manager.read(id).thread.queue = [{ id: 'next', text: 'Do not resend', createdAt: 1, state: 'unknown' }]
    await f.manager.stop()
    const passive = { observe: vi.fn(), recover: vi.fn(async () => ({ state: 'completed' as const, source: 'codex-app-server' as const, nativeTurnId: 'acknowledged', observedAt: 123, detail: 'Confirmed', recoveredMessages: [{ type: 'message' as const, id: 'answer', role: 'assistant' as const, text: 'Complete answer' }] })), stop: vi.fn(async () => {}) }
    const factory = vi.fn(async () => { throw Error('Must not execute') })
    const manager = new ThreadManager(f.db, factory, vi.fn(), undefined, undefined, undefined, undefined, undefined, passive)
    const observation = await manager.observe(id)
    expect(observation).not.toHaveProperty('recoveredMessages')
    const result = manager.read(id)
    expect(result.thread.status).toBe('idle')
    expect(result.turns?.at(-1)?.status).toBe('completed')
    expect(result.events.filter(event => event.type === 'message' && event.id === 'answer')).toEqual([{ type: 'message', id: 'answer', role: 'assistant', text: 'Complete answer' }])
    expect(result.events.filter(event => event.type === 'completed')).toEqual([{ type: 'completed', status: 'completed' }])
    expect(result.thread.queue).toMatchObject([{ state: 'unknown', text: 'Do not resend' }])
    expect(new ThreadHistory(f.db).operations(id).at(-1)?.state).toBe('completed')
    expect(factory).not.toHaveBeenCalled()
    passive.observe.mockResolvedValue({ state: 'completed', source: 'codex-app-server', observedAt: 124, detail: 'Already settled' })
    await manager.observe(id)
    expect(passive.recover).toHaveBeenCalledOnce()
    expect(manager.read(id).events).toEqual(result.events)
    await manager.stop()
    const reopened = new ThreadManager(f.db, factory, vi.fn())
    expect(reopened.read(id).events).toEqual(result.events)
    await reopened.stop()
  })
  it('closes the adapter before awaiting an outstanding state query during shutdown', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Pending state check')
    let resolve!: (value: import('../../shared/types/thread').ThreadProviderObservation) => void
    f.adapters[0].observe = () => new Promise(done => { resolve = done })
    f.adapters[0].dispose = vi.fn(async () => { resolve({ state: 'unknown', source: 'unavailable', observedAt: Date.now(), detail: 'Closed' }) })
    const query = f.manager.observe(id)
    const rejected = expect(query).rejects.toThrow('shutting down')
    await f.manager.stop()
    await rejected
    expect(f.adapters[0].dispose).toHaveBeenCalledOnce()
  })
  it('checks a saved turn after restart without creating an adapter or replaying input', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Original input')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'acknowledged-turn', at: Date.now() })
    await f.manager.stop()
    const passive = { observe: vi.fn(async () => ({ state: 'completed' as const, source: 'codex-app-server' as const, nativeTurnId: 'acknowledged-turn', observedAt: Date.now(), detail: 'Provider journal checked' })), stop: vi.fn(async () => {}) }
    const factory = vi.fn(async () => { throw Error('Must not resume provider') })
    const restarted = new ThreadManager(f.db, factory, vi.fn(), undefined, undefined, undefined, undefined, undefined, passive)
    const before = restarted.read(id).events.length
    expect((await restarted.observe(id)).state).toBe('completed')
    expect(passive.observe).toHaveBeenCalledWith(expect.objectContaining({ nativeSessionId: 'native-1' }), 'acknowledged-turn')
    expect(factory).not.toHaveBeenCalled()
    expect(restarted.read(id).events).toHaveLength(before)
    expect(restarted.read(id).turns?.at(-1)?.status).toBe('interrupted')
    await restarted.stop()
    expect(passive.stop).toHaveBeenCalledOnce()
  })
  it('crosses only a bounded number of empty native pages and preserves progress for the next request', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const read = vi.fn(async (_thread, _id, cursor?: { before: number }) => cursor
      ? { events: [], truncated: true, cursor: { before: cursor.before - 10, size: 200, identity: 'fixture' } }
      : { events: [], truncated: true, cursor: { before: 100, size: 200, identity: 'fixture' } })
    const f = fixture(undefined, undefined, { read, open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5])
    const result = await f.manager.command(f.create(), `/resume ${nativeId}`)
    const page = await f.manager.historyPage(result.threadId!, 0)
    expect(page).toMatchObject({ events: [], before: 0, hasMore: true })
    expect(read).toHaveBeenCalledTimes(5)
    expect(f.manager.read(result.threadId!).thread.nativeHistoryCursor?.before).toBe(60)
    await f.manager.stop()
  })
  it('persists read-only provider observations without replaying or falsely completing an accepted turn', async () => {
    const f = fixture(), id = f.create()
    expect(await f.manager.observe(id)).toMatchObject({ state: 'unknown', source: 'unavailable' })
    await f.manager.send(id, 'Continue')
    f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'native-turn', at: Date.now() })
    expect(f.manager.read(id).turns?.at(-1)?.nativeId).toBe('native-turn')
    let resolve!: (value: import('../../shared/types/thread').ThreadProviderObservation) => void
    f.adapters[0].observe = vi.fn(() => new Promise(done => { resolve = done }))
    const first = f.manager.observe(id), second = f.manager.observe(id)
    resolve({ state: 'completed', source: 'codex-app-server', observedAt: 123, nativeTurnId: 'native-turn', detail: 'Confirmed by provider' })
    expect(await first).toEqual(await second)
    expect(f.adapters[0].observe).toHaveBeenCalledTimes(1)
    expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    expect(f.manager.read(id).thread.providerObservation?.state).toBe('completed')
    expect(f.manager.read(id).turns?.at(-1)?.status).toBe('running')
    expect(f.manager.read(id).events.some(event => event.type === 'turn-accepted')).toBe(false)
    await f.manager.stop()
  })
  it('persists earlier native pages separately from live events and coalesces concurrent loads', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const read = vi.fn().mockResolvedValueOnce({ cursor: { before: 100, size: 200, identity: 'fixture' }, truncated: true,
      events: [{ type: 'message', id: 'native:recent', role: 'assistant', text: 'Recent response' }] }).mockResolvedValue({
      events: [{ type: 'message', id: 'native:earlier', role: 'user', text: 'Earlier question' }] })
    const f = fixture(undefined, undefined, { read, open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5])
    const imported = await f.manager.command(f.create(), `/resume ${nativeId}`)
    const id = imported.threadId!
    expect(f.manager.readForRenderer(id).page).toMatchObject({ before: 0, hasMore: true, total: 1 })
    const [first, second] = await Promise.all([f.manager.historyPage(id, 0), f.manager.historyPage(id, 0)])
    expect(first).toEqual(second)
    expect(first).toMatchObject({ events: [{ text: 'Earlier question' }], hasMore: false, total: 2 })
    expect(read).toHaveBeenCalledTimes(2)
    expect(f.manager.readForRenderer(id).events).toMatchObject([{ text: 'Earlier question' }, { text: 'Recent response' }])
    expect(f.manager.read(id).events).toHaveLength(1)
    expect(f.manager.read(id).thread.nativeHistoryCursor).toBeUndefined()
    await f.manager.stop()
  })
  it('does not treat local turn failure as a provider heartbeat and records transport closure', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Continue')
    const heartbeat = f.manager.read(id).thread.connection?.lastHeartbeatAt
    f.callbacks[0]({ type: 'native-signal', at: 12345 })
    f.callbacks[0]({ type: 'completed', status: 'failed', error: 'Transport closed' })
    expect(f.manager.read(id).thread.connection).toMatchObject({ lastHeartbeatAt: heartbeat, lastNativeSignalAt: 12345 })
    f.callbacks[0]({ type: 'connection-closed', at: 12346 })
    expect(f.manager.read(id).thread.connection).toMatchObject({ state: 'closed', changedAt: 12346 })
    expect(f.manager.read(id).events.some(event => event.type === 'connection-closed')).toBe(false)
    await f.manager.stop()
  })
  it('publishes an accepted message before slow repository baseline collection finishes', async () => {
    const f = fixture(), id = f.create()
    let releaseBaseline!: () => void
    const baseline = new Promise<undefined>(resolve => { releaseBaseline = () => resolve(undefined) })
    vi.spyOn(f.manager as unknown as { workingState: (path: string) => Promise<undefined> }, 'workingState').mockReturnValue(baseline)
    const sending = f.manager.send(id, 'Show this immediately')
    try {
      await vi.waitFor(() => expect(new ThreadHistory(f.db).read(id).events).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', text: 'Show this immediately' })))
      expect(f.factory).not.toHaveBeenCalled()
    } finally { releaseBaseline() }
    await sending
    await f.manager.stop()
  })
  it.each([false, true])('finalizes checkpoints and observable command edits without claiming native authorship (recovery=%s)', async recovery => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-thread-diff-'))
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unsafe test cleanup')
    let manager: ThreadManager | undefined
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'OXESpace Test')
      writeFileSync(join(root, 'README.md'), 'Before\n')
      git('add', 'README.md')
      git('commit', '-qm', 'initial')
      const terminal = { state: 'completed' as const, source: 'codex-app-server' as const, nativeTurnId: 'native-turn', observedAt: 123, detail: 'Confirmed' }
      const reader = { observe: vi.fn(), recover: vi.fn(async () => ({ ...terminal, recoveredMessages: [] })), stop: vi.fn(async () => {}) }
      const f = fixture(undefined, undefined, undefined, undefined, reader), id = f.manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'codex' }).thread.id
      manager = f.manager
      await f.manager.send(id, 'Update the documentation')
      writeFileSync(join(root, 'README.md'), 'After\n')
      if (recovery) {
        f.callbacks[0]({ type: 'turn-accepted', nativeTurnId: 'native-turn', at: 1 })
        f.manager.read(id).thread.queue = [{ id: 'next', text: 'Do not replay', createdAt: 1, state: 'queued' }]
        f.adapters[0].observe = vi.fn(async () => terminal)
        f.adapters[0].commitRecoveredTurn = vi.fn((_turn, _state, commit) => { commit(); return true })
        await f.manager.observe(id)
      } else f.callbacks[0]({ type: 'completed', status: 'completed' })
      await vi.waitFor(() => expect(f.manager.read(id).events.some(event => event.type === 'turn-diff' && event.id.startsWith('verified-diff:'))).toBe(true), { timeout: 10_000 })
      expect(f.manager.read(id).events.find(event => event.type === 'turn-diff')).toMatchObject({ files: [{ path: 'README.md', source: 'working-tree-observation', authorship: 'indeterminate', additions: 1, deletions: 1, artifactId: expect.any(String) }] })
      await vi.waitFor(async () => expect((await f.manager.command(id, '/checkpoint')).rows?.[0].detail).toContain('ready'), { timeout: 10_000 })
      expect(f.adapters[0].send).toHaveBeenCalledTimes(1)
    } finally {
      await manager?.stop()
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 30_000)
  it('opens delegated work and exact task details locally without launching a provider', async () => {
    const f = fixture(), id = f.create()
    expect(await f.manager.command(id, '/delegations')).toMatchObject({ kind: 'panel', surface: 'delegations' })
    expect(await f.manager.command(id, '/delegation 12345678-1234')).toMatchObject({ kind: 'panel', surface: 'delegations', text: '12345678-1234' })
    await f.manager.send(id, '/delegation 12345678-1234')
    expect(f.factory).not.toHaveBeenCalled()
    await f.manager.stop()
  })
  it('imports only an explicitly selected native session from the same provider and directory', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const read = vi.fn(async () => ({ title: 'Recovered work', events: [{ type: 'message' as const, id: 'native:one', role: 'assistant' as const, text: 'Public result' }] }))
    const cli = { read, open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5]
    const f = fixture(undefined, undefined, cli), id = f.create()
    const imported = await f.manager.command(id, `/resume ${nativeId}`)
    expect(imported).toMatchObject({ kind: 'navigate' })
    const recovered = f.manager.read(imported.threadId!)
    expect(recovered.thread).toMatchObject({ nativeSessionId: nativeId, title: 'Recovered work', provider: 'codex', rootPath: '/project-A' })
    expect(recovered.events).toMatchObject([{ text: 'Public result' }])
    expect(await f.manager.command(id, `/resume ${nativeId}`)).toMatchObject({ kind: 'navigate', threadId: recovered.thread.id })
    expect(read).toHaveBeenCalledTimes(1)
    expect(f.factory).not.toHaveBeenCalled()
    await f.manager.stop()
  })
  it('replaces a generic title on an older imported session with its first real prompt', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const cli = { read: vi.fn(async () => ({ events: [
      { type: 'message' as const, id: 'native:meta', role: 'user' as const, text: '<environment_context><current_date>2026-09-24</current_date></environment_context>' },
      { type: 'message' as const, id: 'native:prompt', role: 'user' as const, text: 'Implementar autenticação na branch de trabalho' }
    ] })), open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5]
    const f = fixture(undefined, undefined, cli), id = f.create()
    const imported = await f.manager.command(id, `/resume ${nativeId}`)
    expect(f.manager.read(imported.threadId!).thread.title).toBe('Recovered codex session')
    expect(f.manager.readForRenderer(imported.threadId!).thread.title).toBe('Implementar autenticação na branch de trabalho')
    expect(f.manager.read(imported.threadId!).thread.title).toBe('Implementar autenticação na branch de trabalho')
    await f.manager.stop()
  })
  it('repairs a raw environment title on a previously imported session', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const cli = { read: vi.fn(async () => ({ title: '<environment_context><cwd>/project-A</cwd>', events: [
      { type: 'message' as const, id: 'native:meta', role: 'user' as const, text: '<environment_context><cwd>/project-A</cwd><shell>powershell</shell></environment_context>' },
      { type: 'message' as const, id: 'native:prompt', role: 'user' as const, text: 'Review the project architecture' }
    ] })), open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5]
    const f = fixture(undefined, undefined, cli), id = f.create()
    const imported = await f.manager.command(id, `/resume ${nativeId}`)
    expect(f.manager.readForRenderer(imported.threadId!).thread.title).toBe('Review the project architecture')
    await f.manager.stop()
  })
  it('keeps native resume unlinked when the provider rejects the project identity', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const cli = { read: vi.fn(async () => { throw Error('Native session belongs to a different project') }), open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5]
    const f = fixture(undefined, undefined, cli), id = f.create()
    await expect(f.manager.command(id, `/resume ${nativeId}`)).rejects.toThrow('different project')
    expect(f.manager.list('A')).toHaveLength(1)
    await f.manager.stop()
  })
  it('retains image blobs across a failed turn and releases them after a successful retry', async () => {
    const remove = vi.fn(async () => {}), attachment = { id: 'a'.repeat(64) + '-12345678', name: 'screen.png', mimeType: 'image/png' as const, bytes: 12, path: '/private/screen.png' }
    const store = { resolve: vi.fn(async () => [attachment]), remove, removeThread: vi.fn(async () => {}) } as unknown as ConstructorParameters<typeof ThreadManager>[7]
    const f = fixture(undefined, undefined, undefined, store), id = f.create()
    await f.manager.send(id, 'Inspect image', [attachment.id])
    expect(f.manager.read(id).events[0]).toMatchObject({ type: 'message', attachments: [{ id: attachment.id, name: 'screen.png' }] })
    expect(JSON.stringify(f.manager.read(id))).not.toContain('/private/screen.png')
    f.callbacks[0]({ type: 'completed', status: 'failed' })
    expect(remove).not.toHaveBeenCalled()
    await f.manager.send(id, 'Retry image', [attachment.id])
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(id, attachment.id))
    await f.manager.stop()
  })
  it('prevents two local conversations from writing the same native session', async () => {
    const f = fixture(), first = f.create(), second = f.create()
    await f.manager.send(first, 'Open native session')
    const secondThread = f.manager.read(second).thread
    secondThread.nativeSessionId = 'native-1'
    f.db.prepare('UPDATE conversation_threads SET data_json = ? WHERE id = ?').run(JSON.stringify(secondThread), second)
    await expect(f.manager.send(second, 'Competing writer')).rejects.toThrow('already open')
    expect(f.manager.read(second).events).toEqual([])
    await f.manager.stop()
  })
  it('reconnects after a provider adapter closes during a failed turn', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First attempt')
    Object.defineProperty(f.adapters[0], 'closed', { value: true })
    f.callbacks[0]({ type: 'completed', status: 'failed', error: 'Provider stopped responding' })
    await f.manager.send(id, 'Retry')
    expect(f.factory).toHaveBeenCalledTimes(2)
    expect(f.adapters[1].send).toHaveBeenCalledWith('Retry', undefined)
    await f.manager.stop()
  })
  it('persists the provider consolidated diff independently from individual tool patches', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Edit repeatedly')
    f.callbacks[0]({ type: 'turn-diff', id: 'turn-diff:native-turn', turnId: 'native-turn', files: [{ path: 'a.ts', kind: 'update', source: 'native-patch', state: 'running', patch: '@@ -1 +1,2 @@\n-old\n+new\n+second\n' }] })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const saved = f.manager.read(id), diff = saved.events.find(event => event.type === 'turn-diff')
    expect(saved.turns![0].nativeId).toBe('native-turn')
    expect(diff).toMatchObject({ files: [{ state: 'completed', additions: 2, deletions: 1 }] })
    if (diff?.type !== 'turn-diff') throw Error('Missing aggregate')
    expect(f.manager.artifact(id, diff.files[0].artifactId!).content).toContain('+second')
    await f.manager.stop()
  })
  it('exports inert conversation evidence with session metadata and redaction', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Inspect the project')
    f.callbacks[0]({ type: 'tool', id: 'command', name: 'commandExecution', state: 'completed', detail: 'npm test', output: 'authorization=private-token', files: [{ path: 'src/a.ts', kind: 'update', source: 'native-patch', state: 'completed', patch: '@@ -1 +1 @@\n-old\n+new\n' }] })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const result = await f.manager.command(id, '/export')
    expect(result.text).toContain(`Thread ID: \`${id}\``)
    expect(result.text).toContain('Native session: `native-1`')
    expect(result.text).toContain('Tool · commandExecution · completed')
    expect(result.text).toContain('```diff')
    expect(result.text).not.toContain('private-token')
    expect(result.text).toContain('[redacted]')
    await f.manager.stop()
  })
  it('roundtrips a portable conversation without resuming or exposing its native session', async () => {
    const f = fixture(), source = f.create(), target = f.create()
    await f.manager.send(source, 'Create evidence')
    f.callbacks[0]({ type: 'tool', id: 'edit', name: 'fileChange', state: 'completed', files: [{ path: 'src/a.ts', kind: 'update', source: 'native-patch', state: 'completed', patch: '@@ -1 +1 @@\n-old\n+new\n' }] })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const raw = f.manager.exportPortable(source)
    expect(raw).not.toContain('native-1')
    const imported = f.manager.importPortable(target, raw)
    expect(imported.thread).toMatchObject({ provider: 'codex', rootPath: '/project-A', nativeSessionId: null, status: 'idle' })
    expect(imported.thread.id).not.toBe(source)
    expect(imported.events.some(event => event.type === 'session')).toBe(false)
    const tool = imported.events.find(event => event.type === 'tool')
    if (tool?.type !== 'tool') throw Error('Missing imported evidence')
    expect(f.manager.artifact(imported.thread.id, tool.files![0].artifactId!).content).toContain('+new')
    await f.manager.stop()
  })
  it('reports durable conversation, project, session, connection and operation identity', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Inspect the project')
    f.callbacks[0]({ type: 'completed', status: 'completed' })

    const result = await f.manager.command(id, '/status')
    expect(result).toMatchObject({ kind: 'panel', title: 'Conversation status' })
    expect(Object.fromEntries(result.rows?.map(row => [row.label, row.detail]) ?? [])).toMatchObject({
      'Thread ID': id,
      'Project ID': 'project-A',
      'Workspace ID': 'A',
      Connection: 'connected',
      Generation: '1',
      Directory: '/project-A',
      'Native session ID (resume)': 'native-1'
    })
    expect(result.rows?.find(row => row.label === 'Operation')?.detail).toMatch(/^[0-9a-f-]+ · completed$/)
    await f.manager.stop()
  })
  it('coalesces token bursts and flushes them before completion with execution metadata', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'First request')
    f.callbacks[0]({ type: 'delta', id: 'answer', text: 'First ' })
    f.callbacks[0]({ type: 'delta', id: 'answer', text: 'second' })
    expect(f.manager.read(id).events.filter(event => event.type === 'message' && event.role === 'user')).toHaveLength(1)
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const saved = f.manager.read(id)
    expect(saved.thread).toMatchObject({ status: 'idle', lastTurnStatus: 'completed' })
    f.db.prepare("UPDATE conversation_threads SET data_json = json_remove(data_json, '$.lastTurnStatus') WHERE id = ?").run(id)
    expect(f.manager.list('A').find(thread => thread.id === id)?.lastTurnStatus).toBe('completed')
    expect(f.manager.readForRenderer(id).thread.lastTurnStatus).toBe('completed')
    expect(saved.events.find(event => event.type === 'message' && event.id === 'answer')).toEqual({ type: 'message', id: 'answer', role: 'assistant', text: 'First second' })
    expect(saved.turns).toHaveLength(1)
    expect(saved.turns![0]).toMatchObject({ id: saved.events[0].type === 'message' ? saved.events[0].id : '', operationId: expect.any(String), status: 'completed', startedAt: expect.any(Number), completedAt: expect.any(Number), configuration: { access: 'read-only' } })
    expect(f.db.prepare('SELECT state FROM conversation_operations WHERE id = ?').get(saved.turns![0].operationId)).toEqual({ state: 'completed' })
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM conversation_event_envelopes WHERE thread_id = ?').get(id)).toEqual({ count: saved.events.length })
    await f.manager.stop()
  })
  it('merges late usage by failure ID without interrupting a later turn or creating extra transcript events', async () => {
    const f = fixture(), id = f.create(), other = f.create('B')
    await f.manager.send(id, 'First turn')
    const failure = threadFailure({ codexErrorInfo: 'usageLimitExceeded', message: 'Session exhausted' })
    f.callbacks[0]({ type: 'completed', status: 'failed', failure, errorCode: 'usage' })
    await f.manager.send(id, 'Next turn')
    const count = f.manager.read(id).events.length
    const usage = { checkedAt: Date.now(), windows: [{ label: 'Session', usedPercent: 100, resetsAt: Date.now() + 3600000 }] }
    f.callbacks[0]({ type: 'failure-details', id: failure.id, usage })
    expect(f.manager.read(id).thread.status).toBe('running')
    expect(f.manager.read(id).events).toHaveLength(count)
    expect(f.manager.read(id).events.find(event => event.type === 'completed')).toMatchObject({ failure: { id: failure.id, usage } })
    f.callbacks[0]({ type: 'failure-details', id: 'wrong-id', usage })
    expect(f.manager.read(id).events).toHaveLength(count)
    expect(f.manager.read(other).events).toEqual([])
    await f.manager.stop()
  })
  it('retains typed launch failures instead of replacing the cause with a generic message', async () => {
    const f = fixture(), id = f.create()
    const failure = threadFailure({ codexErrorInfo: 'unauthorized', message: 'OAuth refresh token revoked. api_key=sensitive-key' })
    f.factory.mockRejectedValueOnce(new ThreadAgentError(failure))
    await expect(f.manager.send(id, 'Investigate')).rejects.toThrow('Agent Settings')
    expect(f.manager.read(id).events.at(-1)).toMatchObject({ type: 'completed', errorCode: 'authentication', failure: { providerCode: 'unauthorized', detail: 'OAuth refresh token revoked. api_key=[redacted]' } })
    expect(f.manager.read(id).thread.connection).toMatchObject({ state: 'degraded', attempt: 1, nextRetryAt: expect.any(Number) })
    expect(JSON.stringify(f.manager.read(id))).not.toContain('sensitive-key')
    await f.manager.stop()
  })
  it('queues configuration for the next turn and rejects stale revisions and invalid effort', async () => {
    const f = fixture(), id = f.create()
    await expect(f.manager.configure(id, { model: 'native-model', reasoningEffort: 'impossible' }, 0)).rejects.toThrow('not supported')
    await f.manager.send(id, 'Inspect the project')
    const apply = vi.fn(async () => {})
    f.adapters[0].configure = apply
    await f.manager.configure(id, { model: 'native-model', reasoningEffort: 'high' }, 0)
    expect(apply).not.toHaveBeenCalled()
    expect(f.manager.read(id).thread.pendingConfiguration).toMatchObject({ model: 'native-model', reasoningEffort: 'high' })
    await expect(f.manager.configure(id, { reasoningEffort: 'low' }, 0)).rejects.toThrow('Configuration changed')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await f.manager.send(id, 'Continue')
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ model: 'native-model', reasoningEffort: 'high' }))
    expect(f.manager.read(id).thread.pendingConfiguration).toBeUndefined()
    await f.manager.stop()
  })
  it('keeps slash panels out of the transcript and confirms destructive local commands', async () => {
    const f = fixture(), id = f.create()
    expect(await f.manager.command(id, '/model')).toMatchObject({ surface: 'model' })
    expect(await f.manager.command(id, '/permissions')).toMatchObject({ surface: 'permissions' })
    expect(f.factory).not.toHaveBeenCalled()
    expect(f.manager.read(id).events).toHaveLength(0)
    expect(await f.manager.command(id, '/delete')).toMatchObject({ kind: 'panel', rows: [{ id: '/delete confirm' }] })
    expect(f.manager.read(id).thread.id).toBe(id)
    await f.manager.command(id, '/archive confirm')
    expect(f.manager.read(id).thread.archived).toBe(true)
    await f.manager.command(id, '/delete confirm')
    expect(() => f.manager.read(id)).toThrow()
    await f.manager.stop()
  })
  it('archives linked Codex conversations locally without asking the provider to delete its native session', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Keep the native session')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await vi.waitFor(() => expect(f.manager.read(id).thread.status).toBe('idle'))
    const nativeCommand = vi.fn(async () => { throw Error('outside this execution scope') })
    f.adapters[0].command = nativeCommand
    await f.manager.command(id, '/archive confirm')
    expect(f.manager.read(id).thread.archived).toBe(true)
    expect(nativeCommand).not.toHaveBeenCalled()
    await f.manager.command(id, '/delete confirm')
    expect(() => f.manager.read(id)).toThrow()
    expect(nativeCommand).not.toHaveBeenCalled()
    await f.manager.stop()
  })
  it('links a different saved session after the CLI has exited, replacing stale history before ordinary resume', async () => {
    let ended: ((id: string | null) => Promise<void>) | undefined, running = true, nativeSessionId = 'original'
    const session = { state: () => ({ running, nativeSessionId }), write: async () => {}, resize: () => {}, attach: () => ({ running, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }), detach: () => {}, insertCommand: async () => {},
      linkSession: vi.fn(async (id: string) => { nativeSessionId = id }), close: vi.fn(async () => {}) }
    const cli = { open: vi.fn<NonNullable<ConstructorParameters<typeof ThreadManager>[5]>['open']>(async (_thread, _command, callback) => { ended = callback; return session }), read: vi.fn(async (_thread, id: string) => ({ title: id, events: [{ type: 'message' as const, role: 'user' as const, id, text: id }] })) }
    const f = fixture(undefined, undefined, cli), id = f.create()
    await f.manager.openCli(id)
    running = false; await ended?.('original')
    await f.manager.linkCliSession(id, 'selected')
    expect(f.manager.read(id)).toMatchObject({ thread: { nativeSessionId: 'selected', title: 'selected', cliActive: false }, events: [{ text: 'selected' }] })
    await f.manager.send(id, 'Continue')
    expect(f.adapters[0].start).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'selected', networkAccess: false, approvalPolicy: 'on-request' }), expect.any(Function))
    await f.manager.stop()
  })
  it('offers TUI-only commands without opening a terminal, then leases the CLI only on an explicit tool action', async () => {
    let finish: ((id: string | null) => Promise<void>) | undefined
    let running = true
    const cliSession = { state: () => ({ running, nativeSessionId: 'native-1' }), write: vi.fn(async () => {}), resize: vi.fn(), attach: vi.fn(), detach: vi.fn(), insertCommand: vi.fn(async () => {}), linkSession: vi.fn(async () => {}),
      close: vi.fn(async () => { if (running) { running = false; await finish?.('native-chosen') } }) }
    const cli = { open: vi.fn<NonNullable<ConstructorParameters<typeof ThreadManager>[5]>['open']>(async (_thread, _command, ended) => { finish = ended; return cliSession }), read: vi.fn(async () => ({ title: 'Native renamed', events: [{ type: 'message' as const, id: 'native-message', role: 'user' as const, text: 'Native CLI prompt' }] })) }
    const commands = { list: vi.fn(async () => ({ commands: [] })), prepare: vi.fn<NonNullable<ConstructorParameters<typeof ThreadManager>[4]>['prepare']>(async (_thread, text) => ({ text, nativeCli: text.startsWith('/') })) }
    const f = fixture(undefined, commands, cli), id = f.create()
    await f.manager.send(id, 'Initial question'); f.callbacks[0]({ type: 'completed', status: 'completed' })
    await f.manager.send(id, '/permissions')
    expect(cli.open).not.toHaveBeenCalled()
    expect(f.adapters[0].dispose).not.toHaveBeenCalled()
    expect(await f.manager.command(id, '/permissions')).toMatchObject({ kind: 'panel', surface: 'permissions' })
    expect(f.manager.read(id).events.some(event => event.type === 'cli-command')).toBe(false)
    expect(f.manager.hasRunning('codex')).toBe(false)
    await f.manager.openCli(id, '/permissions')
    expect(f.adapters[0].dispose).toHaveBeenCalledOnce()
    expect(cli.open).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'native-1' }), '/permissions', expect.any(Function))
    expect(f.manager.read(id).thread.cliActive).toBe(true)
    await expect(f.manager.send(id, 'Concurrent')).rejects.toThrow('native CLI')
    await expect(f.manager.openCli(id, '/model')).rejects.toThrow('native CLI input')
    await f.manager.stopCli(id)
    expect(f.manager.read(id)).toMatchObject({ thread: { cliActive: false, nativeSessionId: 'native-chosen', title: 'Native renamed' }, events: [{ text: 'Native CLI prompt' }] })
    await f.manager.send(id, 'Continue')
    expect(f.adapters[1].start).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'native-chosen', networkAccess: false, approvalPolicy: 'on-request' }), expect.any(Function))
    await f.manager.stop()
  })
  it('persists a chosen model and reasoning effort and restores them with the same native session', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, '/model native-model high')
    expect(f.factory).not.toHaveBeenCalled()
    await f.manager.send(id, 'Initial question')
    f.callbacks[0]({ type: 'configuration', model: 'native-model', reasoningEffort: 'high' })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    expect(f.manager.read(id).thread).toMatchObject({ model: 'native-model', reasoningEffort: 'high', title: 'Initial question' })
    expect(f.manager.read(id).events.some(event => event.type === 'configuration')).toBe(false)
    await f.manager.stop()
    const restarted = new ThreadManager(f.db, f.factory, vi.fn())
    await restarted.send(id, 'Continue')
    expect(f.adapters[1].start).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'native-1', model: 'native-model', reasoningEffort: 'high', access: 'read-only', networkAccess: false, approvalPolicy: 'on-request', mode: 'default' }), expect.any(Function))
    await restarted.stop()
  })
  it('never opens a CLI during a turn, releases a failed CLI launch, and blocks stale context after a failed import', async () => {
    const cli = { open: vi.fn<NonNullable<ConstructorParameters<typeof ThreadManager>[5]>['open']>().mockRejectedValueOnce(Error('CLI unavailable')), read: vi.fn(async () => { throw Error('Other project') }) }
    const f = fixture(undefined, undefined, cli), id = f.create()
    await expect(f.manager.openCli(id)).rejects.toThrow('unavailable')
    expect(f.manager.hasRunning('codex')).toBe(false)
    await f.manager.send(id, 'Question')
    await expect(f.manager.openCli(id)).rejects.toThrow('active turn')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    cli.open.mockImplementationOnce(async (_thread, _command, ended) => ({ state: () => ({ running: true, nativeSessionId: 'native-1' }), write: async () => {}, resize: () => {}, attach: () => ({ running: true, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }), detach: () => {}, insertCommand: async () => {}, linkSession: async () => {}, close: async () => { await ended('native-1') } }))
    await f.manager.openCli(id); await f.manager.stopCli(id)
    expect(f.manager.read(id).thread.cliNotice).toContain('could not be imported')
    await expect(f.manager.send(id, 'Continue')).rejects.toThrow('could not be imported')
    expect(f.factory).toHaveBeenCalledOnce()
    await f.manager.stop()
  })
  it('keeps slash invocations in history while sending resolved native skills to the adapter', async () => {
    const input = { text: '$oxe-plan Review auth', skill: { name: 'oxe-plan', path: '/native/oxe-plan/SKILL.md' } }
    const commands = { list: vi.fn(async () => ({ commands: [] })), prepare: vi.fn(async () => input), stop: vi.fn(async () => {}) }
    const f = fixture(undefined, commands), id = f.create()
    await f.manager.commands(id)
    expect(commands.list).toHaveBeenCalledWith(f.manager.read(id).thread, false)
    await f.manager.commands(id, true)
    expect(commands.list).toHaveBeenLastCalledWith(f.manager.read(id).thread, true)
    await f.manager.send(id, '/oxe-plan Review auth')
    expect(f.manager.read(id).events[0]).toMatchObject({ type: 'message', role: 'user', text: '/oxe-plan Review auth' })
    expect(f.adapters[0].send).toHaveBeenCalledWith(input.text, input.skill)
    await f.manager.stop()
    expect(commands.stop).toHaveBeenCalledOnce()
  })
  it('rejects unsupported or oversized skill prompts before auth, history, and process startup', async () => {
    const preflight = vi.fn(async () => {})
    const commands = { list: vi.fn(async () => ({ commands: [] })), prepare: vi.fn().mockRejectedValueOnce(Error('Unknown command')).mockResolvedValueOnce({ text: 'x'.repeat(65537) }) }
    const f = fixture(preflight, commands), id = f.create(), before = f.manager.read(id)
    await expect(f.manager.send(id, '/unknown')).rejects.toThrow('Unknown command')
    await expect(f.manager.send(id, '/oversized')).rejects.toThrow('Skill prompt')
    expect(f.manager.read(id)).toEqual(before)
    expect(preflight).not.toHaveBeenCalled()
    expect(f.factory).not.toHaveBeenCalled()
    expect(f.manager.hasRunning('codex')).toBe(false)
    await f.manager.stop()
  })
  it('does not mark a turn interrupted when shutdown happens during auth preflight', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = fixture(() => gate), id = f.create(), before = f.manager.read(id)
    const pending = f.manager.send(id, 'Unsent request')
    await f.manager.stop()
    release()
    await expect(pending).rejects.toThrow('shutting down')
    expect(f.manager.read(id)).toEqual(before)
    expect(f.factory).not.toHaveBeenCalled()
  })
  it('keeps a bounded native transcript informational so imported sessions can continue', async () => {
    const nativeId = '11111111-1111-4111-8111-111111111111'
    const cli = { read: vi.fn(async () => ({ truncated: true, events: [{ type: 'message' as const, id: 'native:last', role: 'assistant' as const, text: 'Recent answer' }] })), open: vi.fn() } as unknown as ConstructorParameters<typeof ThreadManager>[5]
    const f = fixture(undefined, undefined, cli), source = f.create()
    const imported = await f.manager.command(source, `/resume ${nativeId}`)
    const id = imported.threadId!
    expect(f.manager.read(id).thread.cliNotice).toContain('recent part')
    await f.manager.configure(id, { access: 'workspace-write' }, 0)
    await f.manager.send(id, 'Continue this long session')
    expect(f.manager.read(id).events).toContainEqual(expect.objectContaining({ type: 'message', role: 'user', text: 'Continue this long session' }))
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await f.manager.recover(id)
    expect(f.manager.read(id).thread.cliNotice).toContain('recent part')
    await f.manager.send(id, 'Continue after recovery')
    expect(f.adapters.at(-1)?.send).toHaveBeenCalledWith('Continue after recovery', undefined)
    await f.manager.stop()
  })
  it('settles a tool without a native result as unconfirmed when its turn completes', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Run a command')
    f.callbacks[0]({ type: 'tool', id: 'command', name: 'Bash', state: 'running', detail: 'git status', startedAt: 1 })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    expect(f.manager.read(id).thread.status).toBe('idle')
    expect(f.manager.read(id).events.find(event => event.type === 'tool' && event.id === 'command')).toMatchObject({ state: 'unknown', completedAt: expect.any(Number) })
    expect(f.manager.readForRenderer(id).events.find(event => event.type === 'tool' && event.id === 'command')).toMatchObject({ state: 'unknown' })
    await f.manager.stop()
  })
  it('repairs previously saved completed turns whose commands still show running', async () => {
    const f = fixture(), id = f.create()
    const old = f.manager.read(id)
    old.events = [{ type: 'message', id: 'turn-old', role: 'user', text: 'Inspect' }, { type: 'tool', id: 'old-command', name: 'Bash', state: 'running', detail: 'git status' }, { type: 'completed', status: 'completed' }]
    new ThreadHistory(f.db).write(old)
    const reopened = new ThreadManager(f.db, f.factory, vi.fn())
    expect(reopened.readForRenderer(id).events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
    expect(reopened.read(id).events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
    expect(new ThreadHistory(f.db).read(id).events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
    await reopened.stop(); await f.manager.stop()
  })
  it('settles active operations during graceful shutdown and does not duplicate recovery on restart', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Keep shutdown history coherent')
    f.callbacks[0]({ type: 'tool', id: 'shutdown-tool', name: 'commandExecution', state: 'running', detail: 'npm test', files: [{ path: 'src/a.ts', kind: 'update', source: 'native-patch', state: 'running' }] })
    f.callbacks[0]({ type: 'request', id: 'shutdown-request', request: { id: 'shutdown-request', nativeId: 'native-request', nativeMethod: 'item/tool/requestUserInput', kind: 'question', title: 'Choose', detail: '', state: 'pending', createdAt: 12, generation: 1 } })
    const beforeStop = f.manager.read(id)
    beforeStop.thread.queue = [{ id: 'sending', text: 'Possibly delivered', createdAt: 13, state: 'sending' }]
    new ThreadHistory(f.db).write(beforeStop)

    await f.manager.stop()
    const stopped = f.manager.read(id)
    expect(stopped.thread.status).toBe('interrupted')
    expect(stopped.turns?.at(-1)).toMatchObject({ status: 'interrupted', completedAt: expect.any(Number) })
    expect(stopped.events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown', output: expect.stringContaining('OXESpace closed'), files: [{ state: 'unknown' }] })
    expect(stopped.thread.providerObservation).toMatchObject({ state: 'unknown', detail: expect.stringContaining('provider outcome remains unknown') })
    expect(stopped.events.find(event => event.type === 'request')).toMatchObject({ request: { state: 'cancelled' } })
    expect(stopped.thread.queue).toEqual([expect.objectContaining({ state: 'unknown', error: expect.stringContaining('could not be confirmed') })])
    expect(stopped.events.filter(event => event.type === 'completed' && event.status === 'interrupted')).toHaveLength(1)

    const restarted = new ThreadManager(f.db, f.factory, vi.fn())
    expect(restarted.read(id).events.filter(event => event.type === 'completed' && event.status === 'interrupted')).toHaveLength(1)
    await restarted.stop()
  })
  it('leaves the thread unchanged after auth preflight failure and releases ownership', async () => {
    const preflight = vi.fn().mockRejectedValueOnce(Error('THREAD_AUTH_REQUIRED')).mockResolvedValue(undefined)
    const f = fixture(preflight), id = f.create(), before = f.manager.read(id)
    await expect(f.manager.send(id, 'Keep my draft')).rejects.toThrow('THREAD_AUTH_REQUIRED')
    expect(f.manager.read(id)).toEqual(before)
    expect(f.factory).not.toHaveBeenCalled()
    expect(f.manager.hasRunning('codex')).toBe(false)
    await f.manager.send(id, 'Explicit retry')
    expect(f.manager.read(id).events.filter(event => event.type === 'message')).toHaveLength(1)
    await f.manager.stop()
  })
  it('refreshes idle account adapters without stopping an active turn', async () => {
    const f = fixture(), idle = f.create(), busy = f.create()
    await f.manager.send(idle, 'A'); f.callbacks[0]({ type: 'completed', status: 'completed' })
    await f.manager.send(busy, 'B')
    await f.manager.refreshAccounts('codex')
    expect(f.adapters[0].dispose).toHaveBeenCalledOnce()
    expect(f.adapters[1].dispose).not.toHaveBeenCalled()
    await f.manager.send(idle, 'Continue with fresh account')
    expect(f.factory).toHaveBeenCalledTimes(3)
    expect(f.adapters[2].start).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'native-1', networkAccess: false, approvalPolicy: 'on-request' }), expect.any(Function))
    await f.manager.stop()
  })
  it('does not crash when a workspace is deleted during an active turn', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Investigate')
    f.db.prepare('DELETE FROM workspaces WHERE id = ?').run('A')
    expect(() => f.callbacks[0]({ type: 'delta', id: 'message', text: 'late output' })).not.toThrow()
    expect(f.adapters[0].dispose).not.toHaveBeenCalled()
    expect(f.manager.read(id).thread.id).toBe(id)
    await f.manager.stop()
  })
  it('persists streaming without duplicate final messages and isolates projects', async () => {
    const f = fixture(), id = f.create(), other = f.create('B')
    await f.manager.send(id, 'Investigate JWT authentication')
    f.callbacks[0]({ type: 'delta', id: 'message-1', text: 'JWT ' })
    f.callbacks[0]({ type: 'delta', id: 'message-1', text: 'HttpOnly' })
    f.callbacks[0]({ type: 'message', id: 'message-1', role: 'assistant', text: 'JWT HttpOnly' })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    expect(f.manager.read(id).events.filter(event => event.type === 'message')).toHaveLength(2)
    expect(f.manager.read(other).events).toEqual([])
    expect(f.manager.list().map(thread => thread.id)).toEqual(expect.arrayContaining([id, other]))
    await f.manager.stop()
  })
  it('ignores callbacks captured by an older conversation generation', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Generation one')
    f.manager.read(id).thread.generation = 2
    f.callbacks[0]({ type: 'delta', id: 'stale-answer', text: 'must not be persisted' })
    f.callbacks[0]({ type: 'tool', id: 'stale-tool', name: 'command', state: 'completed', detail: 'old generation' })
    expect(f.manager.read(id).events.filter(event => event.type !== 'activity')).toEqual([expect.objectContaining({ type: 'message', role: 'user', text: 'Generation one' })])
    await f.manager.stop()
  })
  it('reserves ownership before asynchronous startup and permits distinct threads', async () => {
    const f = fixture(), first = f.create(), second = f.create()
    const pending = f.manager.send(first, 'A')
    await expect(f.manager.send(first, 'Duplicate')).resolves.toBeUndefined()
    expect(f.manager.read(first).thread.queue).toEqual([expect.objectContaining({ text: 'Duplicate', state: 'queued' })])
    await pending
    await f.manager.send(second, 'B')
    expect(f.factory).toHaveBeenCalledTimes(2)
    expect(f.manager.read(first).thread.nativeSessionId).not.toBe(f.manager.read(second).thread.nativeSessionId)
    await f.manager.stop()
  })
  it('recovers interrupted work without launching and resumes only on explicit send', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Analyze')
    const restarted = new ThreadManager(f.db, f.factory, vi.fn())
    expect(restarted.read(id).thread.status).toBe('interrupted')
    expect(f.factory).toHaveBeenCalledTimes(1)
    await restarted.send(id, 'Continue')
    expect(f.adapters[1].start).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/project-A', nativeSessionId: 'native-1', networkAccess: false, approvalPolicy: 'on-request' }), expect.any(Function))
    await restarted.stop(); await f.manager.stop()
  })
  it('settles every volatile operation after restart without leaving false running state', async () => {
    const f = fixture(), id = f.create()
    await f.manager.send(id, 'Coordinate work')
    f.callbacks[0]({ type: 'tool', id: 'tool-running', name: 'commandExecution', state: 'running', detail: 'npm test', startedAt: 10, files: [{ path: 'src/a.ts', kind: 'update', source: 'native-patch', state: 'running' }] })
    f.callbacks[0]({ type: 'subagent', id: 'child-running', action: 'spawnAgent', state: 'running', senderThreadId: 'native-1', receiverThreadIds: ['child-1'], agents: [{ threadId: 'child-1', status: 'running' }], turnId: 'turn-1', startedAt: 11 })
    f.callbacks[0]({ type: 'turn-diff', id: 'turn-diff:turn-1', turnId: 'turn-1', files: [{ path: 'src/b.ts', kind: 'update', source: 'native-patch', state: 'running' }] })
    f.callbacks[0]({ type: 'request', id: 'question', request: { id: 'question', nativeId: 'native-question', nativeMethod: 'item/tool/requestUserInput', kind: 'question', title: 'Choose', detail: '', state: 'pending', createdAt: 12, generation: 1 } })
    f.callbacks[0]({ type: 'approval', id: 'approval', title: 'Approve command', detail: 'npm test' })
    const beforeRestart = f.manager.read(id)
    beforeRestart.thread.queue = [{ id: 'queued', text: 'Follow up', createdAt: 13, state: 'sending' }]
    new ThreadHistory(f.db).write(beforeRestart)

    const restarted = new ThreadManager(f.db, f.factory, vi.fn())
    const recovered = restarted.read(id)
    expect(recovered.thread.status).toBe('interrupted')
    expect(recovered.thread.queue).toEqual([expect.objectContaining({ id: 'queued', state: 'unknown', error: expect.stringContaining('could not be confirmed') })])
    expect(recovered.turns?.at(-1)).toMatchObject({ status: 'interrupted', completedAt: expect.any(Number) })
    expect(recovered.events.find(event => event.type === 'tool' && event.id === 'tool-running')).toMatchObject({ state: 'unknown', completedAt: expect.any(Number), files: [{ state: 'unknown' }] })
    expect(recovered.events.find(event => event.type === 'subagent' && event.id === 'child-running')).toMatchObject({ state: 'unknown', completedAt: expect.any(Number), agents: [{ status: 'unknown' }] })
    expect(recovered.events.find(event => event.type === 'turn-diff')).toMatchObject({ files: [{ state: 'unknown' }] })
    expect(recovered.events.find(event => event.type === 'request' && event.id === 'question')).toMatchObject({ request: { state: 'cancelled' } })
    expect(recovered.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'request-resolved', id: 'question', state: 'cancelled', resolution: 'connection-lost' }), { type: 'approval-resolved', id: 'approval' }]))
    expect(recovered.events.at(-1)).toEqual({ type: 'completed', status: 'interrupted', error: 'OXESpace restarted before this turn completed.' })
    await restarted.deleteQueued(id, 'queued')
    expect(restarted.read(id).thread.queue).toEqual([])
    await restarted.stop(); await f.manager.stop()
  })
  it('gracefully preserves history after unavailable agents and validates input', async () => {
    const f = fixture(), id = f.create()
    f.factory.mockRejectedValueOnce(new Error('Missing executable'))
    await expect(f.manager.send(id, 'Investigate')).rejects.toThrow('Agent Settings')
    expect(f.manager.read(id).thread.status).toBe('failed')
    expect(f.manager.read(id).events[0]).toMatchObject({ role: 'user', text: 'Investigate' })
    await expect(f.manager.send(id, ' ')).rejects.toThrow('Message')
    f.manager.pin(id, true)
    expect(f.manager.read(id).thread.pinned).toBe(true)
    await f.manager.stop()
  })
})
