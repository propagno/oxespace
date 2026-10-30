import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { CodexConversationAdapter, CodexForkUnsupportedError, type ConversationTransport } from '../electron/main/services/conversation/codex-conversation'
import { claudeTranscriptPath, removeClaudeSessionCopy } from '../electron/main/services/conversation/claude-transcript-fork'
import { SIDE_CHAT_DISALLOWED_TOOLS, sideChatConfiguration, ThreadSideChats, type ThreadSideHost } from '../electron/main/services/conversation/thread-side-chat'
import { THREAD_MESSAGE_MAX_CHARS } from '../shared/threadLimits'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent, ThreadSideEvent } from '../shared/types/thread'

const MAIN = '11111111-1111-4111-8111-111111111111'
const FORK = '22222222-2222-4222-8222-222222222222'

function claudeFixture(fork = { sessionId: FORK, args: ['--disallowedTools', ...SIDE_CHAT_DISALLOWED_TOOLS] }) {
  const launches: { args: string[]; data: (chunk: Uint8Array) => void; writes: Record<string, unknown>[] }[] = []
  const adapter = new ClaudeConversationAdapter(args => {
    const launch = { args, data: (_chunk: Uint8Array) => {}, writes: [] as Record<string, unknown>[] }
    launches.push(launch)
    return { write: text => { const message = JSON.parse(text); launch.writes.push(message); if (message.request_id === 'initialize') launch.data(Buffer.from(JSON.stringify({ type: 'control_response', response: { request_id: 'initialize', subtype: 'success', response: {} } }) + '\n')) },
      endInput: () => {}, onData: callback => { launch.data = callback }, onClose: () => {}, close: vi.fn(async () => {}) }
  }, fork)
  return { adapter, launches, emit: (index: number, value: unknown) => launches[index].data(Buffer.from(JSON.stringify(value) + '\n')) }
}

function codexFixture(fork: (params: Record<string, unknown>) => { result?: unknown; error?: string }) {
  let receive: (chunk: Uint8Array) => void = () => {}
  const requests: { method: string; params: Record<string, unknown> }[] = []
  const transport: ConversationTransport = {
    write: line => {
      const message = JSON.parse(line)
      if (!message.method) return
      requests.push({ method: message.method, params: message.params })
      if (message.id === undefined) return
      const answer = message.method === 'thread/fork' ? fork(message.params) : { result: {} }
      queueMicrotask(() => receive(Buffer.from(JSON.stringify(answer.error ? { id: message.id, error: { code: -32601, message: answer.error } } : { id: message.id, result: answer.result }) + '\n')))
    },
    onData: listener => { receive = listener }, onClose: () => {}, close: vi.fn(async () => {})
  }
  return { adapter: new CodexConversationAdapter(transport, { ephemeral: true }), requests, transport }
}

function thread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return { id: 'thread-A', provider: 'claude', rootPath: '/project', workspaceId: 'thread:p', nativeSessionId: MAIN, status: 'idle', generation: 1, title: 'Main', createdAt: 1, updatedAt: 1, ...overrides } as ConversationThread
}

function fakeAdapter(): AgentConversationAdapter & { emit: (event: ThreadEvent) => void; sent: string[] } {
  const adapter = {
    capabilities: {}, emit: (_event: ThreadEvent) => {}, sent: [] as string[],
    start: vi.fn(async (_context: unknown, emit: (event: ThreadEvent) => void) => { adapter.emit = emit }),
    send: vi.fn(async (text: string) => { adapter.sent.push(text) }),
    interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), respondRequest: vi.fn(async () => {}), dispose: vi.fn(async () => {})
  }
  return adapter as unknown as AgentConversationAdapter & { emit: (event: ThreadEvent) => void; sent: string[] }
}

function sideFixture(main = thread()) {
  let current: ConversationThread | null = main
  const listeners = new Set<() => void>()
  const adapters: ReturnType<typeof fakeAdapter>[] = []
  const host: ThreadSideHost & { discard: ReturnType<typeof vi.fn> } = {
    readThread: vi.fn(() => { if (!current) throw Error('Thread not found'); return current }),
    subscribe: vi.fn((_id: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }),
    connect: vi.fn(async () => { const adapter = fakeAdapter(); adapters.push(adapter); return adapter }),
    unavailable: error => error instanceof CodexForkUnsupportedError,
    discard: vi.fn(async () => {})
  }
  const events: ThreadSideEvent[] = []
  const chats = new ThreadSideChats(host)
  return { chats, host, adapters, events, listeners, emit: (event: ThreadSideEvent) => events.push(event),
    change: (next: ConversationThread | null) => { current = next; for (const listener of [...listeners]) listener() } }
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('side chat: Claude launch', () => {
  it('forks the session in plan mode with write tools disallowed and only read tools', async () => {
    const f = claudeFixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: MAIN, ...sideChatConfiguration(thread()) }, () => {})
    await f.adapter.send('What did it decide?')
    const args = f.launches[0].args
    expect(args.join(' ')).toContain('--permission-mode plan')
    expect(args.join(' ')).toContain('--disallowedTools Bash Edit Write NotebookEdit')
    expect(args.join(' ')).toContain(`--resume ${MAIN} --fork-session --session-id ${FORK}`)
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,AskUserQuestion')
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--settings') + 1]).toContain('"disableAllHooks":true')
    await f.adapter.dispose()
  })

  it('resumes its own copy, not the main session, after the process restarts', async () => {
    const f = claudeFixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: MAIN, ...sideChatConfiguration(thread()) }, () => {})
    await f.adapter.send('First')
    f.emit(0, { type: 'system', subtype: 'init', session_id: FORK })
    f.emit(0, { type: 'result', subtype: 'success', session_id: FORK })
    await f.adapter.configure({ ...sideChatConfiguration(thread()) })
    await f.adapter.send('Second')
    expect(f.launches[1].args.join(' ')).toContain(`--resume ${FORK}`)
    expect(f.launches[1].args).not.toContain('--fork-session')
    expect(f.launches[1].args.join(' ')).not.toContain(MAIN)
    await f.adapter.dispose()
  })

  it('leaves an ordinary conversation launch unchanged', async () => {
    const f = claudeFixture(null as never)
    await f.adapter.start({ rootPath: '/project', nativeSessionId: MAIN }, () => {})
    await f.adapter.send('Hello')
    expect(f.launches[0].args).not.toContain('--fork-session')
    expect(f.launches[0].args).not.toContain('--disallowedTools')
    await f.adapter.dispose()
  })
})

describe('side chat: Codex fork', () => {
  const start = (adapter: CodexConversationAdapter, nativeSessionId: string | null = MAIN, events: ThreadEvent[] = []) =>
    adapter.start({ rootPath: '/project', nativeSessionId, ...sideChatConfiguration(thread()) }, event => events.push(event))

  it('forks an ephemeral read-only copy and never resumes the main thread', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true, forkedFromId: 'native-A' }, model: 'gpt' } }))
    const events: ThreadEvent[] = []
    await start(f.adapter, 'native-A', events)
    const fork = f.requests.find(request => request.method === 'thread/fork')!
    expect(fork.params).toMatchObject({ threadId: 'native-A', ephemeral: true, excludeTurns: true, sandbox: 'read-only', approvalPolicy: 'on-request' })
    expect(f.requests.map(request => request.method)).not.toContain('thread/resume')
    expect(events).toContainEqual({ type: 'session', nativeSessionId: 'fork-A' })
    await f.adapter.dispose()
  })

  it('reports an app-server without thread/fork as unavailable', async () => {
    const f = codexFixture(() => ({ error: 'Method not found: thread/fork' }))
    await expect(start(f.adapter)).rejects.toBeInstanceOf(CodexForkUnsupportedError)
  })

  it('reports a copy the version would keep on disk as unavailable and removes only that copy', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-B' } } }))
    await expect(start(f.adapter, 'native-A')).rejects.toBeInstanceOf(CodexForkUnsupportedError)
    expect(f.requests.filter(request => request.method === 'thread/delete')).toEqual([{ method: 'thread/delete', params: { threadId: 'fork-B' } }])
  })

  it('refuses a fork that returns the main thread itself', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'native-A', ephemeral: true } } }))
    await expect(start(f.adapter, 'native-A')).rejects.toBeInstanceOf(CodexForkUnsupportedError)
    expect(f.requests.map(request => request.method)).not.toContain('thread/delete')
  })

  it('answers unavailable through the side chat service, with no copy kept', async () => {
    const f = codexFixture(() => ({ error: 'unknown variant `thread/fork`' }))
    const s = sideFixture(thread({ provider: 'codex' }))
    vi.mocked(s.host.connect).mockResolvedValueOnce(f.adapter)
    expect(await s.chats.open('thread-A', s.emit)).toEqual({ ok: false, message: { code: 'thread.side.unavailable', params: {} } })
    expect(s.chats.size).toBe(0)
    expect(f.transport.close).toHaveBeenCalled()
  })
})

describe('side chat service', () => {
  it('answers noSession when the conversation has no native session yet', async () => {
    const s = sideFixture(thread({ nativeSessionId: null }))
    expect(await s.chats.open('thread-A', s.emit)).toEqual({ ok: false, message: { code: 'thread.side.noSession', params: {} } })
    expect(s.host.connect).not.toHaveBeenCalled()
  })

  it('sends events only as side events, usage included, and declines requests without showing them', async () => {
    const s = sideFixture()
    const opened = await s.chats.open('thread-A', s.emit)
    if (!opened.ok) throw Error('expected a side chat')
    expect(opened.side).toMatchObject({ threadId: 'thread-A', provider: 'claude', readOnly: true })
    const adapter = s.adapters[0]
    expect(vi.mocked(adapter.start).mock.calls[0][0]).toMatchObject({ nativeSessionId: MAIN, access: 'read-only', mode: 'plan', hooksEnabled: false })
    await s.chats.send(opened.side.sideId, 'Why?')
    adapter.emit({ type: 'message', id: 'm', role: 'assistant', text: 'Because.' })
    adapter.emit({ type: 'turn-cost', usd: 0.01, inputTokens: 10, outputTokens: 5 } as ThreadEvent)
    adapter.emit({ type: 'request', id: 'r', request: { id: 'r', kind: 'approval', title: 'Edit?', generation: 0, createdAt: 1, state: 'pending' } } as ThreadEvent)
    adapter.emit({ type: 'approval', id: 'r', title: 'Edit?' } as ThreadEvent)
    expect(adapter.respondRequest).toHaveBeenCalledWith('r', expect.objectContaining({ decision: 'decline' }))
    expect(s.events.map(event => event.event.type)).toEqual(['message', 'turn-cost'])
    expect(s.events.every(event => event.sideId === opened.side.sideId)).toBe(true)
    expect(adapter.sent).toEqual(['Why?'])
  })

  it('rejects nonsense input and an unknown or closed side chat', async () => {
    const s = sideFixture()
    const opened = await s.chats.open('thread-A', s.emit)
    if (!opened.ok) throw Error('expected a side chat')
    const id = opened.side.sideId
    for (const text of ['', '   ', 42, null, { text: 'x' }, 'a\0b', 'x'.repeat(THREAD_MESSAGE_MAX_CHARS + 1)]) await expect(s.chats.send(id, text)).rejects.toThrow('Invalid side chat input')
    for (const sideId of [undefined, 7, 'not-a-uuid', '../etc']) await expect(s.chats.send(sideId, 'hi')).rejects.toThrow('Invalid side chat input')
    await expect(s.chats.send('33333333-3333-4333-8333-333333333333', 'hi')).rejects.toThrow('closed')
    await s.chats.close(id)
    await expect(s.chats.send(id, 'hi')).rejects.toThrow('closed')
    await expect(s.chats.close(id)).resolves.toBeUndefined()
    s.adapters[0].emit({ type: 'message', id: 'late', role: 'assistant', text: 'late' })
    expect(s.events).toEqual([])
  })

  it('tears down on close, deleting only the copies it created or learned', async () => {
    const s = sideFixture()
    const opened = await s.chats.open('thread-A', s.emit)
    if (!opened.ok) throw Error('expected a side chat')
    s.adapters[0].emit({ type: 'session', nativeSessionId: FORK })
    s.adapters[0].emit({ type: 'session', nativeSessionId: MAIN })
    await s.chats.close(opened.side.sideId)
    expect(s.adapters[0].dispose).toHaveBeenCalled()
    const forkIds = s.host.discard.mock.calls.map(call => call[1])
    expect(forkIds).toContain(FORK)
    expect(forkIds).not.toContain(MAIN)
    expect(s.host.discard.mock.calls.every(call => (call[2] as string[]).includes(MAIN))).toBe(true)
    expect(s.listeners.size).toBe(0)
  })

  it('tears down when the main conversation is archived or deleted', async () => {
    for (const next of [thread({ archived: true }), null]) {
      const s = sideFixture()
      await s.chats.open('thread-A', s.emit)
      s.change(thread({ title: 'Renamed' }))
      expect(s.chats.size).toBe(1)
      s.change(next)
      await vi.waitFor(() => expect(s.host.discard).toHaveBeenCalled())
      expect(s.chats.size).toBe(0)
      expect(s.adapters[0].dispose).toHaveBeenCalled()
    }
  })

  it('tears every side chat down on quit, and keeps one per conversation', async () => {
    const s = sideFixture()
    await s.chats.open('thread-A', s.emit)
    await s.chats.open('thread-A', s.emit)
    expect(s.adapters[0].dispose).toHaveBeenCalled()
    expect(s.chats.size).toBe(1)
    await s.chats.stop()
    expect(s.chats.size).toBe(0)
    expect(s.adapters[1].dispose).toHaveBeenCalled()
  })
})

describe('side chat copy removal', () => {
  it('deletes only the fork file when two session files share the folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'oxe-side-')); roots.push(home)
    const env = { CLAUDE_CONFIG_DIR: home }
    const main = claudeTranscriptPath('/project', MAIN, env), fork = claudeTranscriptPath('/project', FORK, env)
    await mkdir(join(main, '..'), { recursive: true })
    await writeFile(main, '{"type":"user"}\n'); await writeFile(fork, '{"type":"user"}\n')
    expect(await removeClaudeSessionCopy({ rootPath: '/project', forkId: MAIN, keep: [MAIN], env })).toBe(false)
    expect(await removeClaudeSessionCopy({ rootPath: '/project', forkId: '../escape', keep: [MAIN], env })).toBe(false)
    expect(await removeClaudeSessionCopy({ rootPath: '/project', forkId: FORK, keep: [MAIN], env })).toBe(true)
    expect(await readdir(join(main, '..'))).toEqual([`${MAIN}.jsonl`])
    expect(await removeClaudeSessionCopy({ rootPath: '/project', forkId: FORK, keep: [MAIN], env })).toBe(false)
  })
})
