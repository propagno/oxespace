import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { ThreadAgentError, threadFailure } from '../../electron/main/services/conversation/thread-failure'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture(preflight?: ConstructorParameters<typeof ThreadManager>[3], commands?: ConstructorParameters<typeof ThreadManager>[4], cli?: ConstructorParameters<typeof ThreadManager>[5], attachments?: ConstructorParameters<typeof ThreadManager>[7]) {
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
  const manager = new ThreadManager(db, factory, vi.fn(), preflight, commands, cli, models, attachments)
  const create = (workspaceId = 'A') => manager.create({ workspaceId, projectId: `project-${workspaceId}`, rootPath: `/project-${workspaceId}`, provider: 'codex' }).thread.id
  return { db, manager, factory, adapters, callbacks, create }
}

describe('thread persistence and ownership', () => {
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
  it('shows Codex command edits as observable file evidence without claiming native authorship', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-thread-diff-'))
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
      git('init', '-q')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'user.name', 'OXESpace Test')
      writeFileSync(join(root, 'README.md'), 'Before\n')
      git('add', 'README.md')
      git('commit', '-qm', 'initial')
      const f = fixture(), id = f.manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'codex' }).thread.id
      await f.manager.send(id, 'Update the documentation')
      writeFileSync(join(root, 'README.md'), 'After\n')
      f.callbacks[0]({ type: 'completed', status: 'completed' })
      await vi.waitFor(() => expect(f.manager.read(id).events.some(event => event.type === 'turn-diff' && event.id.startsWith('verified-diff:'))).toBe(true))
      expect(f.manager.read(id).events.find(event => event.type === 'turn-diff')).toMatchObject({ files: [{ path: 'README.md', source: 'working-tree-observation', authorship: 'indeterminate', additions: 1, deletions: 1, artifactId: expect.any(String) }] })
      await f.manager.stop()
    } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
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
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM conversation_events WHERE thread_id = ?').get(id)).toEqual({ count: 1 })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    const saved = f.manager.read(id)
    expect(saved.thread).toMatchObject({ status: 'idle', lastTurnStatus: 'completed' })
    f.db.prepare("UPDATE conversation_threads SET data_json = json_remove(data_json, '$.lastTurnStatus') WHERE id = ?").run(id)
    expect(f.manager.list('A').find(thread => thread.id === id)?.lastTurnStatus).toBe('completed')
    expect(f.manager.readForRenderer(id).thread.lastTurnStatus).toBe('completed')
    expect(saved.events[1]).toEqual({ type: 'message', id: 'answer', role: 'assistant', text: 'First second' })
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
    expect(f.manager.read(id).events.at(-1)).toMatchObject({ type: 'message', role: 'user', text: 'Continue this long session' })
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
    expect(stopped.events.find(event => event.type === 'tool')).toMatchObject({ state: 'failed', output: expect.stringContaining('OXESpace closed'), files: [{ state: 'failed' }] })
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
    expect(f.manager.read(id).events).toHaveLength(1)
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
    expect(f.manager.read(id).events).toEqual([expect.objectContaining({ type: 'message', role: 'user', text: 'Generation one' })])
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
    expect(recovered.events.find(event => event.type === 'tool' && event.id === 'tool-running')).toMatchObject({ state: 'failed', completedAt: expect.any(Number), files: [{ state: 'failed' }] })
    expect(recovered.events.find(event => event.type === 'subagent' && event.id === 'child-running')).toMatchObject({ state: 'interrupted', completedAt: expect.any(Number), agents: [{ status: 'interrupted' }] })
    expect(recovered.events.find(event => event.type === 'turn-diff')).toMatchObject({ files: [{ state: 'failed' }] })
    expect(recovered.events.find(event => event.type === 'request' && event.id === 'question')).toMatchObject({ request: { state: 'cancelled' } })
    expect(recovered.events).toEqual(expect.arrayContaining([{ type: 'request-resolved', id: 'question', state: 'cancelled' }, { type: 'approval-resolved', id: 'approval' }]))
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
