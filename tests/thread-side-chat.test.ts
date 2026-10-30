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

const USER_SERVERS = { 'oxespace-delegation': { command: 'node' }, userwriter: { command: 'node', default_tools_approval_mode: 'auto', tools: { write_marker: { approval_mode: 'approve' } } } }

function codexFixture(fork: (params: Record<string, unknown>) => { result?: unknown; error?: string }, options: { version?: string; servers?: unknown; statuses?: unknown[]; config?: unknown; lookups?: string[] } = {}) {
  let receive: (chunk: Uint8Array) => void = () => {}
  const requests: { method: string; params: Record<string, unknown> }[] = []
  const responses: Record<string, unknown>[] = []
  const transport: ConversationTransport = {
    write: line => {
      const message = JSON.parse(line)
      if (!message.method) { responses.push(message); return }
      requests.push({ method: message.method, params: message.params })
      if (message.id === undefined) return
      const answer = message.method === 'thread/fork' ? fork(message.params)
        : message.method === 'initialize' ? { result: { userAgent: `oxespace/${options.version ?? '0.166.0'} (Windows; x86_64)` } }
        : message.method === 'config/read' ? { result: options.config ?? { config: { mcp_servers: options.servers ?? USER_SERVERS, plugins: { 'browser@openai-bundled': { enabled: true } } } } }
        : message.method === 'mcpServerStatus/list' ? { result: { data: options.statuses ?? Object.keys(USER_SERVERS).map(name => ({ name, pluginId: null })), nextCursor: null } }
        : message.method === 'turn/start' ? { result: { turn: { id: 't' } } }
        : { result: {} }
      queueMicrotask(() => receive(Buffer.from(JSON.stringify(answer.error ? { id: message.id, error: { code: -32601, message: answer.error } } : { id: message.id, result: answer.result }) + '\n')))
    },
    onData: listener => { receive = listener }, onClose: () => {}, close: vi.fn(async () => {})
  }
  const serverRequest = (id: number, method: string, params: unknown) => receive(Buffer.from(JSON.stringify({ id, method, params }) + '\n'))
  const ran: string[] = []
  let nextRequest = 900
  /**
   * A tool call as the app-server decides it, with the precedence verified live on codex-cli 0.166.0: a per-tool
   * `approval_mode` wins over the server's `default_tools_approval_mode`. "approve" runs without asking; "prompt"
   * raises an approval request and runs only if it is accepted.
   */
  const callTool = async (server: string, tool: string): Promise<{ asked: boolean; ran: boolean }> => {
    const config = (requests.find(request => request.method === 'thread/fork')?.params.config ?? {}) as Record<string, unknown>
    const mode = config[`mcp_servers.${server}.tools.${tool}.approval_mode`] ?? config[`mcp_servers.${server}.default_tools_approval_mode`] ?? 'auto'
    if (mode !== 'prompt') { ran.push(`${server}/${tool}`); return { asked: false, ran: true } }
    const id = nextRequest++
    serverRequest(id, 'mcpServer/elicitation/request', { threadId: 'fork-A', turnId: 't', serverName: server, mode: 'form', message: `Allow the ${server} MCP server to run tool "${tool}"?`,
      requestedSchema: { type: 'object', properties: {} }, _meta: { codex_approval_kind: 'mcp_tool_call' } })
    await vi.waitFor(() => expect(responses.some(response => response.id === id)).toBe(true))
    const accepted = (responses.find(response => response.id === id)?.result as { action?: string } | undefined)?.action === 'accept'
    if (accepted) ran.push(`${server}/${tool}`)
    return { asked: true, ran: accepted }
  }
  return { adapter: new CodexConversationAdapter(transport, { ephemeral: true, lookups: options.lookups }), requests, responses, transport, serverRequest, callTool, ran }
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

  it('makes every MCP tool ask first, overriding per-tool settings in the user config', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true } } }))
    await start(f.adapter, 'native-A')
    expect(f.requests.find(request => request.method === 'thread/fork')!.params.config).toEqual({
      'mcp_servers.oxespace-delegation.default_tools_approval_mode': 'prompt',
      'mcp_servers.userwriter.default_tools_approval_mode': 'prompt',
      'mcp_servers.userwriter.tools.write_marker.approval_mode': 'prompt',
      'features.apps': false,
      plugins: { 'browser@openai-bundled': { enabled: false } }
    })
    expect(f.requests.find(request => request.method === 'mcpServerStatus/list')!.params).toMatchObject({ threadId: 'fork-A' })
    await f.adapter.dispose()
  })

  it.each([
    ['an older Codex', { version: '0.165.9' }],
    ['a server name the override cannot address', { servers: { 'my.server': { command: 'x' } } }],
    ['a tool name the override cannot address', { servers: { userwriter: { tools: { 'a.b': {} } } } }],
    ['a plugin server the override did not reach', { statuses: [{ name: 'userwriter', pluginId: null }, { name: 'browser', pluginId: 'openai-bundled/browser' }] }],
    ['an app connector the override did not reach', { statuses: [{ name: 'codex_apps', pluginId: null }] }],
    ['no effective configuration to read', { config: {} }]
  ])('refuses to open with %s', async (_name, options) => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true } } }), options as Parameters<typeof codexFixture>[1])
    await expect(start(f.adapter, 'native-A')).rejects.toBeInstanceOf(CodexForkUnsupportedError)
  })

  it('approves only the listed OXESpace read-only lookups by name, never the whole bridge', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true } } }), { lookups: ['oxespace_code_search', 'oxespace_memory_search', 'oxespace_thread_send', 'oxespace_memory_remember', 'bad.name'] })
    await start(f.adapter, 'native-A')
    const config = f.requests.find(request => request.method === 'thread/fork')!.params.config as Record<string, unknown>
    const approved = Object.entries(config).filter(([, value]) => value === 'approve').map(([key]) => key)
    expect(approved.sort()).toEqual(['mcp_servers.oxespace-delegation.tools.oxespace_code_search.approval_mode', 'mcp_servers.oxespace-delegation.tools.oxespace_memory_search.approval_mode'])
    expect(config['mcp_servers.oxespace-delegation.default_tools_approval_mode']).toBe('prompt')
    expect(config['mcp_servers.userwriter.default_tools_approval_mode']).toBe('prompt')
    await f.adapter.dispose()
  })

  it('runs a listed lookup, and asks about and declines an unlisted OXESpace tool and a user MCP tool', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true } } }), { lookups: ['oxespace_code_search', 'oxespace_thread_send'] })
    const s = sideFixture(thread({ provider: 'codex' }))
    vi.mocked(s.host.connect).mockResolvedValueOnce(f.adapter)
    const opened = await s.chats.open('thread-A', s.emit)
    if (!opened.ok) throw Error('expected a side chat')
    await s.chats.send(opened.side.sideId, 'Look around')
    expect(await f.callTool('oxespace-delegation', 'oxespace_code_search')).toEqual({ asked: false, ran: true })
    expect(await f.callTool('oxespace-delegation', 'oxespace_thread_send')).toEqual({ asked: true, ran: false })
    expect(await f.callTool('oxespace-delegation', 'oxespace_memory_remember')).toEqual({ asked: true, ran: false })
    expect(await f.callTool('userwriter', 'write_marker')).toEqual({ asked: true, ran: false })
    expect(f.ran).toEqual(['oxespace-delegation/oxespace_code_search'])
    expect(f.responses.filter(response => (response.result as { action?: string } | undefined)?.action === 'decline')).toHaveLength(3)
    expect(s.events.some(event => event.event.type === 'request')).toBe(false)
    await s.chats.stop()
  })

  it('declines a user MCP tool call the copy asks about, and shows nothing', async () => {
    const f = codexFixture(() => ({ result: { thread: { id: 'fork-A', ephemeral: true } } }))
    const s = sideFixture(thread({ provider: 'codex' }))
    vi.mocked(s.host.connect).mockResolvedValueOnce(f.adapter)
    const opened = await s.chats.open('thread-A', s.emit)
    if (!opened.ok) throw Error('expected a side chat')
    await s.chats.send(opened.side.sideId, 'Write the marker')
    f.serverRequest(900, 'mcpServer/elicitation/request', { threadId: 'fork-A', turnId: 't', serverName: 'userwriter', mode: 'form', message: 'Allow the userwriter MCP server to run tool "write_marker"?',
      requestedSchema: { type: 'object', properties: {} }, _meta: { codex_approval_kind: 'mcp_tool_call' } })
    await vi.waitFor(() => expect(f.responses).toContainEqual(expect.objectContaining({ id: 900, result: expect.objectContaining({ action: 'decline' }) })))
    expect(s.events.some(event => event.event.type === 'request')).toBe(false)
    await s.chats.stop()
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
