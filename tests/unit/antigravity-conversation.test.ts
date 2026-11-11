import { describe, expect, it, vi } from 'vitest'
import { AntigravityConversationAdapter, ANTIGRAVITY_FALLBACK_MODELS, antigravityLaunchArgs, antigravityMode, parseAntigravityModels, type AntigravityMcpServer } from '../../electron/main/services/conversation/antigravity-conversation'
import type { ConversationTransport } from '../../electron/main/services/conversation/codex-conversation'
import { antigravityMcpServers, threadMcpArguments } from '../../electron/main/services/conversation/thread-mcp'
import { ThreadAgentError } from '../../electron/main/services/conversation/thread-failure'
import { threadCapabilityManifest } from '../../electron/main/services/conversation/thread-capabilities'
import type { ThreadConfiguration, ThreadEvent } from '../../shared/types/thread'
import { assertAdapterConformance } from '../thread-adapter-conformance'

type Message = { id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }
type Answer = (params: Record<string, unknown>) => unknown
interface Launch { args: string[]; cwd: string; sent: Message[]; receive: (chunk: Uint8Array) => void; closed: () => void; promptId?: number | string; transport: ConversationTransport }

const SESSION = { sessionId: 'sess-A', models: { currentModelId: 'gemini-4-carbon-medium', availableModels: [
  { modelId: 'gemini-4-carbon-low', name: 'Gemini 4 Carbon (Low)' }, { modelId: 'gemini-4-carbon-medium', name: 'Gemini 4 Carbon (Medium)' },
  { modelId: 'gemini-4-carbon-high', name: 'Gemini 4 Carbon (High)' }, { modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }] },
modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'accept-edits' }, { id: 'auto' }, { id: 'plan' }] } }

/** A scripted `agy acp`: every request is answered at once, except `session/prompt`, which the test ends. */
function fixture(answers: Record<string, Answer> = {}, mcpServers?: (access: NonNullable<ThreadConfiguration['access']>) => AntigravityMcpServer[]) {
  const launches: Launch[] = []
  const defaults: Record<string, Answer> = {
    initialize: () => ({ protocolVersion: 1, agentInfo: { name: 'Antigravity ACP Server', version: '1.5.6' }, agentCapabilities: { loadSession: true } }),
    'session/new': () => SESSION, 'session/resume': () => ({ modes: SESSION.modes, models: SESSION.models })
  }
  const adapter = new AntigravityConversationAdapter((args, cwd) => {
    const launch: Launch = { args, cwd, sent: [], receive: () => {}, closed: () => {}, transport: {
      write: line => {
        const message = JSON.parse(line) as Message
        launch.sent.push(message)
        if (!message.method || message.id === undefined) return
        if (message.method === 'session/prompt') { launch.promptId = message.id; return }
        let reply: Message
        try { reply = { id: message.id, result: (answers[message.method] ?? defaults[message.method] ?? (() => ({})))(message.params ?? {}) } }
        catch (error) { reply = { id: message.id, error: { code: -32000, message: (error as Error).message } } }
        queueMicrotask(() => launch.receive(Buffer.from(JSON.stringify(reply) + '\n')))
      },
      onData: listener => { launch.receive = listener },
      onClose: listener => { launch.closed = listener },
      close: vi.fn(async () => {})
    } }
    launches.push(launch)
    return launch.transport
  }, { mcpServers, readImage: async path => Buffer.from(`image:${path}`) })
  const events: ThreadEvent[] = []
  const current = (): Launch => launches.at(-1)!
  const server = (message: Message): void => current().receive(Buffer.from(JSON.stringify(message) + '\n'))
  return {
    adapter, launches, events, current, server,
    emit: (event: ThreadEvent) => { events.push(event) },
    update: (update: Record<string, unknown>, sessionId = 'sess-A') => server({ method: 'session/update', params: { sessionId, update } }),
    endTurn: (result: Record<string, unknown>) => server({ id: current().promptId, result }),
    sent: (method: string) => current().sent.filter(message => message.method === method),
    of: <T extends ThreadEvent['type']>(type: T) => events.filter((event): event is Extract<ThreadEvent, { type: T }> => event.type === type)
  }
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const context = (extra: Partial<{ nativeSessionId: string | null } & ThreadConfiguration> = {}) => ({ rootPath: '/repo', nativeSessionId: null, access: 'workspace-write' as const, ...extra })

describe('Antigravity conversation adapter', () => {
  it('passes the gate every provider passes before OxeChat offers it', () => {
    assertAdapterConformance('antigravity', fixture().adapter)
    // What ACP does not give is reported as unavailable, never as a Claude or Codex feature.
    const manifest = threadCapabilityManifest('antigravity', fixture().adapter.capabilities, true)
    expect(manifest.features.rewind.enabled).toBe(false)
    expect(manifest.features.hooks.reason).toContain('Antigravity')
    expect(manifest.features.fork.enabled).toBe(false)
    expect(manifest.features.effort.enabled).toBe(true)
  })

  it('opens a new session sandboxed, with the MCP servers in session/new', async () => {
    const servers: AntigravityMcpServer[] = [{ name: 'oxespace-delegation', command: 'node', args: ['/bridge.cjs'], env: [{ name: 'OXESPACE_MCP_PORT', value: '41000' }] }]
    const f = fixture({}, () => servers)
    await f.adapter.start(context({ model: 'gemini-4-carbon', reasoningEffort: 'high' }), f.emit)
    expect(f.current().args).toEqual(['acp', '--sandbox'])
    expect(f.current().cwd).toBe('/repo')
    expect(f.sent('initialize')[0].params).toMatchObject({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    expect(f.sent('session/new')[0].params).toEqual({ cwd: '/repo', mcpServers: servers })
    expect(f.sent('session/set_config_option').map(message => message.params)).toEqual([
      { sessionId: 'sess-A', configId: 'model', value: 'gemini-4-carbon' }, { sessionId: 'sess-A', configId: 'thought_level', value: 'high' }])
    // The session already is in `default` mode, so no mode is set.
    expect(f.sent('session/set_mode')).toEqual([])
    expect(f.of('session')).toEqual([{ type: 'session', nativeSessionId: 'sess-A' }])
    expect(f.of('configuration')[0]).toMatchObject({ model: 'gemini-4-carbon', reasoningEffort: 'high', access: 'workspace-write', approvalPolicy: 'on-request', confirmed: true })
    expect(f.adapter.evidence).toMatchObject({ transport: 'antigravity-acp-jsonrpc', verified: 'native', providerVersion: '1.5.6', protocolVersion: '1' })
  })

  it('resumes a saved session by its id and never opens a new one', async () => {
    const f = fixture()
    await f.adapter.start(context({ nativeSessionId: 'sess-saved' }), f.emit)
    expect(f.sent('session/resume')[0].params).toMatchObject({ sessionId: 'sess-saved', cwd: '/repo' })
    expect(f.sent('session/new')).toEqual([])
    expect(f.of('session')[0].nativeSessionId).toBe('sess-saved')
  })

  it('loads the session on a server without resume, and drops the history it replays', async () => {
    let replay = (): void => {}
    // The server replays the saved turns as updates before it answers `session/load`.
    const f = fixture({ 'session/resume': () => { throw Error('Method not found') }, 'session/load': () => { replay(); return SESSION } })
    replay = () => {
      f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } })
      f.update({ sessionUpdate: 'usage_update', used: 900, size: 1000 })
    }
    await f.adapter.start(context({ nativeSessionId: 'sess-A' }), f.emit)
    expect(f.sent('session/load')[0].params).toMatchObject({ sessionId: 'sess-A' })
    expect(f.of('delta')).toEqual([])
    expect(f.of('message')).toEqual([])
    expect(f.of('context-usage')).toEqual([])
    // Once loaded, the same update is the live context size.
    f.update({ sessionUpdate: 'usage_update', used: 250, size: 1000 })
    expect(f.of('context-usage')[0].report).toMatchObject({ usedTokens: 250, windowTokens: 1000, percentage: 25, source: 'antigravity-usage' })
  })

  it('maps the access level to launch flags and the session mode', async () => {
    expect(antigravityLaunchArgs({ access: 'read-only' })).toEqual(['acp', '--sandbox'])
    expect(antigravityLaunchArgs({ access: 'workspace-write', approvalPolicy: 'never' })).toEqual(['acp', '--sandbox'])
    expect(antigravityLaunchArgs({ access: 'full-access', approvalPolicy: 'on-request' })).toEqual(['acp'])
    expect(antigravityLaunchArgs({ access: 'full-access', approvalPolicy: 'never' })).toEqual(['acp', '--dangerously-skip-permissions'])
    expect(antigravityMode({ mode: 'plan', access: 'full-access', approvalPolicy: 'never' })).toBe('plan')
    expect(antigravityMode({ mode: 'acceptEdits', access: 'workspace-write' })).toBe('accept-edits')
    expect(antigravityMode({ mode: 'default', access: 'workspace-write', approvalPolicy: 'never' })).toBe('default')
    expect(antigravityMode({ mode: 'default', access: 'full-access', approvalPolicy: 'never' })).toBe('auto')
    const f = fixture()
    await f.adapter.start(context({ mode: 'plan' }), f.emit)
    expect(f.sent('session/set_mode')[0].params).toEqual({ sessionId: 'sess-A', modeId: 'plan' })
  })

  it('streams thoughts, the answer, tools and the plan of a turn, then reports its tokens', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Run the tests', undefined, [{ id: 'a1', name: 'shot.png', mimeType: 'image/png', bytes: 3, path: '/tmp/shot.png' }])
    expect(f.sent('session/prompt')[0].params).toEqual({ sessionId: 'sess-A', prompt: [{ type: 'text', text: 'Run the tests' },
      { type: 'image', mimeType: 'image/png', data: Buffer.from('image:/tmp/shot.png').toString('base64') }] })

    f.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I should run vitest.' } })
    f.update({ sessionUpdate: 'plan', entries: [{ content: 'Run the suite', status: 'in_progress', priority: 'high' }, { content: 'Report', status: 'pending', priority: 'low' }] })
    f.update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'npm test', kind: 'execute', status: 'pending', rawInput: { command: 'npm', args: ['test'] } })
    f.update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '12 passed' } }] })
    f.update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Edit a.ts', kind: 'edit', status: 'in_progress', locations: [{ path: '/repo/a.ts' }] })
    f.update({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed', content: [{ type: 'diff', path: '/repo/b.ts', oldText: null, newText: 'x' }] })
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All ' } })
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'green.' } })
    // Another session's update on the same connection is not this conversation's.
    f.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'leak' } }, 'sess-other')
    f.endTurn({ stopReason: 'end_turn', usage: { inputTokens: 120, outputTokens: 30, cachedReadTokens: 400, cachedWriteTokens: 8, thoughtTokens: 5, totalTokens: 563 } })
    await settle()

    const reasoning = f.of('reasoning')
    expect(reasoning.at(-1)).toMatchObject({ text: 'I should run vitest.' })
    expect(reasoning.at(-1)!.completedAt).toEqual(expect.any(Number))
    expect(f.of('plan')[0].steps).toEqual([{ label: 'Run the suite', status: 'inProgress' }, { label: 'Report', status: 'pending' }])
    const tools = f.of('tool')
    expect(tools.map(tool => [tool.id, tool.name, tool.state])).toEqual([['t1', 'commandExecution', 'running'], ['t1', 'commandExecution', 'completed'], ['t2', 'fileChange', 'running'], ['t2', 'fileChange', 'failed']])
    expect(tools[1]).toMatchObject({ detail: 'npm test', output: '12 passed' })
    expect(tools[3].files).toEqual([{ path: '/repo/b.ts', kind: 'add', source: 'tool-input', authorship: 'indeterminate', state: 'failed' },
      { path: '/repo/a.ts', kind: 'update', source: 'tool-input', authorship: 'indeterminate', state: 'failed' }])
    expect(f.of('delta').map(delta => delta.text)).toEqual(['All ', 'green.'])
    const message = f.of('message')
    expect(message).toHaveLength(1)
    expect(message[0]).toMatchObject({ role: 'assistant', text: 'All green.', id: f.of('delta')[0].id })
    expect(f.of('turn-cost')).toEqual([{ type: 'turn-cost', inputTokens: 120, outputTokens: 30, cacheReadTokens: 400, cacheCreationTokens: 8 }])
    expect(f.events.at(-1)).toEqual({ type: 'completed', status: 'completed' })
    // The turn is over: the next message is accepted.
    await expect(f.adapter.send('And again')).resolves.toBeUndefined()
  })

  it('fails the turn with the provider reason when the model stops for another cause', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Write a novel')
    f.endTurn({ stopReason: 'max_tokens' })
    await settle()
    const completed = f.of('completed')[0]
    expect(completed).toMatchObject({ status: 'failed', errorCode: 'context' })
    expect(completed.failure?.providerCode).toBe('max_tokens')
  })

  it('asks a person before a command, and answers with the option the provider offered', async () => {
    const options = [{ optionId: 'opt-once', name: 'Allow', kind: 'allow_once' }, { optionId: 'opt-always', name: 'Always', kind: 'allow_always' }, { optionId: 'opt-no', name: 'Reject', kind: 'reject_once' }]
    const ask = (f: ReturnType<typeof fixture>, id: number) => f.server({ id, method: 'session/request_permission', params: { sessionId: 'sess-A',
      toolCall: { toolCallId: 't9', title: 'git push', kind: 'execute', rawInput: { command: 'git push origin main', cwd: '/repo' } }, options } })
    for (const [decision, outcome] of [['accept', { outcome: 'selected', optionId: 'opt-once' }], ['acceptForSession', { outcome: 'selected', optionId: 'opt-always' }],
      ['decline', { outcome: 'selected', optionId: 'opt-no' }], ['cancel', { outcome: 'cancelled' }]] as const) {
      const f = fixture()
      await f.adapter.start(context(), f.emit)
      await f.adapter.send('Publish it')
      ask(f, 77)
      const request = f.of('request')[0].request
      expect(request).toMatchObject({ id: '77', kind: 'approval', nativeMethod: 'session/request_permission', toolName: 'command', command: 'git push origin main', cwd: '/repo', state: 'pending',
        availableDecisions: ['accept', 'acceptForSession', 'decline'] })
      expect(f.of('approval')).toHaveLength(1)
      await f.adapter.respondRequest!('77', { decision })
      expect(f.current().sent.find(message => message.id === 77 && !message.method)).toEqual({ id: 77, result: { outcome } })
      expect(f.of('request-resolved')[0]).toMatchObject({ id: '77', state: decision === 'cancel' ? 'cancelled' : 'resolved' })
      await expect(f.adapter.respondRequest!('77', { decision: 'accept' })).rejects.toThrow('no longer pending')
    }
  })

  it('names the files of an edit it asks about, and never widens an approval to an option that was not offered', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Fix it')
    f.server({ id: 5, method: 'session/request_permission', params: { sessionId: 'sess-A', toolCall: { toolCallId: 't1', title: 'Edit', kind: 'edit', locations: [{ path: '/repo/.env' }] },
      options: [{ optionId: 'opt-once', name: 'Allow', kind: 'allow_once' }, { optionId: 'opt-no', name: 'Reject', kind: 'reject_once' }] } })
    expect(f.of('request')[0].request).toMatchObject({ toolName: 'fileChange', paths: ['/repo/.env'], availableDecisions: ['accept', 'decline'] })
    await expect(f.adapter.respondRequest!('5', { decision: 'acceptForSession' })).rejects.toThrow('did not offer')
    expect(f.current().sent.some(message => message.id === 5 && !message.method)).toBe(false)
    await f.adapter.approve('5', 'accept')
    expect(f.current().sent.find(message => message.id === 5 && !message.method)).toEqual({ id: 5, result: { outcome: { outcome: 'selected', optionId: 'opt-once' } } })
  })

  it('declines a write in a read-only conversation without asking anyone', async () => {
    const f = fixture()
    await f.adapter.start(context({ access: 'read-only' }), f.emit)
    await f.adapter.send('Delete the build folder')
    for (const [id, kind] of [[1, 'execute'], [2, 'edit'], [3, 'delete'], [4, 'move']] as const) {
      f.server({ id, method: 'session/request_permission', params: { sessionId: 'sess-A', toolCall: { toolCallId: `t${id}`, title: 'x', kind },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }] } })
      expect(f.current().sent.find(message => message.id === id && !message.method)).toEqual({ id, result: { outcome: { outcome: 'selected', optionId: 'no' } } })
    }
    expect(f.of('request')).toEqual([])
    // A lookup is still a person's decision.
    f.server({ id: 9, method: 'session/request_permission', params: { sessionId: 'sess-A', toolCall: { toolCallId: 't9', title: 'Fetch docs', kind: 'fetch' }, options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }] } })
    expect(f.of('request')).toHaveLength(1)
  })

  it('refuses a host request it does not know, or one for another session', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Go')
    f.server({ id: 1, method: 'fs/write_text_file', params: { sessionId: 'sess-A', path: '/repo/a', content: 'x' } })
    f.server({ id: 2, method: 'session/request_permission', params: { sessionId: 'sess-other', toolCall: { toolCallId: 't', kind: 'execute' }, options: [] } })
    expect(f.current().sent.filter(message => message.error).map(message => message.id)).toEqual([1, 2])
    expect(f.of('request')).toEqual([])
  })

  it('cancels the turn: open requests are answered cancelled and the turn ends interrupted', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Long task')
    f.server({ id: 3, method: 'session/request_permission', params: { sessionId: 'sess-A', toolCall: { toolCallId: 't1', title: 'rm', kind: 'execute', rawInput: { command: 'rm -rf dist' } },
      options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }] } })
    await f.adapter.interrupt()
    expect(f.current().sent.find(message => message.id === 3 && !message.method)).toEqual({ id: 3, result: { outcome: { outcome: 'cancelled' } } })
    expect(f.sent('session/cancel')).toEqual([{ method: 'session/cancel', params: { sessionId: 'sess-A' } }])
    expect(f.of('request-resolved')[0]).toMatchObject({ id: '3', state: 'cancelled', resolution: 'interrupted' })
    // Still running until the provider answers the prompt.
    await expect(f.adapter.send('Next')).rejects.toThrow('already running')
    f.endTurn({ stopReason: 'cancelled' })
    await settle()
    expect(f.events.at(-1)).toEqual({ type: 'completed', status: 'interrupted' })
  })

  it('reports a signed-out account as an authentication failure', async () => {
    const f = fixture({ 'session/new': () => { throw Error('Authentication required') } })
    const failure = await f.adapter.start(context(), f.emit).then(() => null, error => error)
    expect(failure).toBeInstanceOf(ThreadAgentError)
    expect((failure as ThreadAgentError).failure.code).toBe('authentication')
    expect(f.adapter.closed).toBe(true)
    expect(f.current().transport.close).toHaveBeenCalled()
  })

  it('fails the running turn when the process exits, and is then closed', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('Go')
    f.current().closed()
    await settle()
    expect(f.of('completed')[0]).toMatchObject({ status: 'failed' })
    expect(f.adapter.closed).toBe(true)
  })

  it('relaunches for a new access level and resumes the same session; a model change needs no relaunch', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.configure!({ model: 'gpt-oss-120b-medium' })
    expect(f.launches).toHaveLength(1)
    expect(f.sent('session/set_config_option').at(-1)!.params).toEqual({ sessionId: 'sess-A', configId: 'model', value: 'gpt-oss-120b-medium' })

    await f.adapter.configure!({ access: 'full-access', approvalPolicy: 'never' })
    expect(f.launches).toHaveLength(2)
    expect(f.launches[0].transport.close).toHaveBeenCalled()
    expect(f.current().args).toEqual(['acp', '--dangerously-skip-permissions'])
    expect(f.sent('session/resume')[0].params).toMatchObject({ sessionId: 'sess-A' })
    expect(f.sent('session/set_mode')[0].params).toEqual({ sessionId: 'sess-A', modeId: 'auto' })
    expect(f.adapter.closed).toBe(false)
    expect(f.of('configuration').at(-1)).toMatchObject({ access: 'full-access', approvalPolicy: 'never', model: 'gpt-oss-120b-medium', confirmed: true })
    // The old process closing late must not close the new connection.
    f.launches[0].closed()
    expect(f.adapter.closed).toBe(false)
  })

  it('answers /model and /status from the session, without a model request', async () => {
    const f = fixture()
    await f.adapter.start(context(), f.emit)
    await f.adapter.send('/model')
    expect(f.of('model-picker')[0].models).toEqual([
      { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', description: '', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', description: '', efforts: [] }])
    await f.adapter.send('/model gemini-4-carbon high')
    expect(f.sent('session/set_config_option').map(message => message.params)).toEqual([
      { sessionId: 'sess-A', configId: 'model', value: 'gemini-4-carbon' }, { sessionId: 'sess-A', configId: 'thought_level', value: 'high' }])
    await f.adapter.send('/model gemini-4-carbon extreme')
    expect(f.of('message').at(-1)!.text).toContain('Unsupported reasoning effort')
    await f.adapter.send('/status')
    expect(f.of('message').at(-1)!.text).toContain('sess-A')
    expect(f.sent('session/prompt')).toEqual([])
  })
})

describe('Antigravity model catalog', () => {
  it('reads `agy models`: three levels are one model, a single level is the model id', () => {
    const output = ['Fetching available models...', 'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)', 'gemini-4-carbon-high\tGemini 4 Carbon (High)', 'gemini-4-carbon-low\tGemini 4 Carbon (Low)',
      'claude-opus-5-5-low\tClaude Opus 5.5 (Low)', 'claude-opus-5-5-high\tClaude Opus 5.5 (High)', 'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)', 'bad id\tNope', ''].join('\r\n')
    expect(parseAntigravityModels(output)).toEqual([
      { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', description: '', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: '', efforts: ['low', 'high'], defaultEffort: 'low' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', description: '', efforts: [] }])
    expect(parseAntigravityModels('agy: command failed')).toEqual([])
    expect(ANTIGRAVITY_FALLBACK_MODELS.map(model => model.id)).toEqual(['gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-oss-120b-medium'])
  })
})

describe('Antigravity MCP servers', () => {
  const env = { OXESPACE_MCP_PORT: '41000', OXESPACE_MCP_TOKEN: 'token', OXESPACE_EXECUTION_ID: 'exec-1', PATH: '/usr/bin', DB_URL: 'postgres://local' }
  const managed = { servers: [
    { key: 'db', transport: 'stdio' as const, command: 'db-mcp', args: ['--stdio'], env: { DATABASE_URL: 'DB_URL' }, headers: {} },
    { key: 'docs', transport: 'http' as const, url: 'https://docs.example/mcp', env: {}, headers: {} }], env: { DB_URL: 'postgres://local' } }
  const tools = ['oxespace_project_context', 'oxespace_search', 'oxespace_git_change']

  it('gives a writable conversation the bridge with its connection, and the stdio servers', () => {
    const servers = antigravityMcpServers('/bridge.cjs', env, 'workspace-write', managed, [], tools)
    expect(servers.map(server => server.name)).toEqual(['oxespace-delegation', 'db'])
    expect(servers[0]).toMatchObject({ command: 'node', args: ['/bridge.cjs', '--allowed-tools', JSON.stringify(tools)] })
    // Only OXESpace's own variables reach the bridge, never the rest of the process environment.
    expect(servers[0].env).toEqual([{ name: 'OXESPACE_MCP_PORT', value: '41000' }, { name: 'OXESPACE_MCP_TOKEN', value: 'token' }, { name: 'OXESPACE_EXECUTION_ID', value: 'exec-1' }])
    expect(servers[1]).toEqual({ name: 'db', command: 'db-mcp', args: ['--stdio'], env: [{ name: 'DATABASE_URL', value: 'postgres://local' }] })
  })

  it('gives a read-only conversation the lookups only, and none of the person\'s servers', () => {
    const servers = antigravityMcpServers('/bridge.cjs', env, 'read-only', managed, [], tools, [], { data: ['oxespace_db_query'] })
    expect(servers).toHaveLength(1)
    expect(servers[0].args).toEqual(['/bridge.cjs', '--allowed-tools', JSON.stringify(['oxespace_project_context', 'oxespace_search'])])
    expect(antigravityMcpServers('/bridge.cjs', env, undefined, managed, [], tools)).toHaveLength(1)
  })

  it('leaves out a denied server and a denied OXESpace tool', () => {
    const servers = antigravityMcpServers('/bridge.cjs', env, 'workspace-write', managed, [{ server: 'db', tool: '*' }, { server: 'oxespace-delegation', tool: 'oxespace_search' }], tools, ['mcp__oxespace__oxespace_git_change'])
    expect(servers.map(server => server.name)).toEqual(['oxespace-delegation'])
    expect(servers[0].args[2]).toBe(JSON.stringify(['oxespace_project_context']))
    expect(antigravityMcpServers('/bridge.cjs', env, 'workspace-write', managed, [{ server: 'oxespace-delegation', tool: '*' }], tools).map(server => server.name)).toEqual(['db'])
  })

  it('adds no MCP flag to the command line, which `agy acp` does not take', () => {
    expect(threadMcpArguments('antigravity', ['acp', '--sandbox'], '/bridge.cjs', managed)).toEqual(['acp', '--sandbox'])
  })
})
