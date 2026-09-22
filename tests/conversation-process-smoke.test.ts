import { expect, it } from 'vitest'
import { AgentProcessTransport } from '../electron/main/services/conversation/process-transport'
import { AgentRpcPeer } from '../electron/main/services/conversation/rpc-peer'
import { NativeAccountService, authScopeId } from '../electron/main/services/conversation/native-account.service'
import { ThreadCommandService } from '../electron/main/services/conversation/thread-commands'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import type { ConversationThread, ThreadEvent } from '../shared/types/thread'
import { parseThreadUsage } from '../electron/main/services/conversation/thread-failure'

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('native Codex supplies usage windows and reset times without starting inference', async () => {
  const transport = new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], process.cwd())
  const peer = new AgentRpcPeer(line => transport.write(line), () => {}, request => { if (request.id !== undefined) peer.rejectRequest(request.id) }, 8000)
  transport.onData(chunk => peer.push(chunk)); transport.onClose(() => peer.close())
  try {
    await peer.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' } }); peer.notify('initialized')
    const usage = parseThreadUsage(await peer.request('account/rateLimits/read', {}))
    expect(usage.windows.length).toBeGreaterThan(0)
    for (const window of usage.windows) {
      expect(Number.isFinite(window.usedPercent)).toBe(true)
      if (window.resetsAt !== undefined) expect(window.resetsAt).toBeGreaterThan(1000000000000)
    }
  } finally { peer.close(); await transport.close() }
}, 20000)

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('native Codex acknowledges model and effort changes without inference', async () => {
  const transport = new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], process.cwd())
  const peer = new AgentRpcPeer(line => transport.write(line), () => {}, request => { if (request.id !== undefined) peer.rejectRequest(request.id) }, 15000)
  transport.onData(chunk => peer.push(chunk)); transport.onClose(() => peer.close())
  try {
    await peer.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' }, capabilities: { experimentalApi: true } }); peer.notify('initialized')
    const catalog = await peer.request('model/list', { limit: 100 }) as { data: { model: string; defaultReasoningEffort: string }[] }
    const model = catalog.data[0]
    const started = await peer.request('thread/start', { cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request', model: model.model }) as { thread: { id: string } }
    // The installed schema marks thread/settings/update as experimental.
    await expect(peer.request('thread/settings/update', { threadId: started.thread.id, model: model.model, effort: model.defaultReasoningEffort, sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'on-request' })).resolves.toBeTypeOf('object')
  } finally { peer.close(); await transport.close() }
}, 30000)

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('native model catalogs support Thread selectors without starting inference', async () => {
  const transport = new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], process.cwd())
  const peer = new AgentRpcPeer(line => transport.write(line), () => {}, message => { if (message.id !== undefined) peer.rejectRequest(message.id) }, 8000)
  transport.onData(chunk => peer.push(chunk)); transport.onClose(() => peer.close())
  try {
    await peer.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' } }); peer.notify('initialized')
    const result = await peer.request('model/list', { limit: 100, includeHidden: false }) as { data: { model: string; displayName: string; supportedReasoningEfforts: unknown[] }[] }
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.data[0].model).toBeTypeOf('string')
    expect(Array.isArray(result.data[0].supportedReasoningEfforts)).toBe(true)
  } finally { peer.close(); await transport.close() }
  const events: ThreadEvent[] = []
  const adapter = new ClaudeConversationAdapter((args, cwd) => {
    expect(args).toContain('--no-session-persistence')
    const native = new AgentProcessTransport('claude', args, cwd)
    const write = native.write.bind(native)
    native.write = line => { expect(JSON.parse(line).type).toBe('control_request'); write(line) }
    return native
  })
  try {
    await adapter.start({ rootPath: process.cwd(), nativeSessionId: null }, event => events.push(event))
    await adapter.send('/model')
    const picker = events.find(event => event.type === 'model-picker')
    expect(picker?.type === 'model-picker' ? picker.models.length : 0).toBeGreaterThan(0)
    expect(events.some(event => event.type === 'session')).toBe(false)
  } finally { await adapter.dispose() }
}, 25000)

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('native subscription account protocols return sanitized status', async () => {
  const openExternal = async () => { throw Error('Status checks must not open a login browser') }
  const service = new NativeAccountService({
    resolve: async context => ({ id: authScopeId(context.provider, context.provider, process.cwd()), provider: context.provider, command: context.provider, cwd: process.cwd() }),
    changed: () => {}, openExternal
  })
  try {
    for (const provider of ['codex', 'claude'] as const) {
      const status = await service.read({ provider, workspaceId: 'native-smoke' })
      expect(['connected', 'signed-out']).toContain(status.state)
      expect(['subscription', 'api', 'other', 'unknown']).toContain(status.method)
      expect(Object.keys(status)).not.toContain('accessToken')
    }
  } finally { await service.stop() }
}, 25000)

// Explicit opt-in. Handshake only: no thread creation or model inference.
it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('native Codex App Server initializes over stdio', async () => {
  const transport = new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], process.cwd())
  const peer = new AgentRpcPeer(line => transport.write(line), () => {}, message => {
    if (message.id !== undefined) peer.rejectRequest(message.id)
  }, 8000)
  transport.onData(chunk => peer.push(chunk))
  transport.onClose(() => peer.close())
  try {
    const result = await peer.request('initialize', { clientInfo: { name: 'oxespace', title: 'OXESpace smoke', version: '0.13.0' } })
    expect(result).toBeTypeOf('object')
    peer.notify('initialized')
  } finally { peer.close(); await transport.close() }
}, 15000)

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('installed native CLIs discover Thread commands without inference or account changes', async () => {
  const service = new ThreadCommandService(thread => thread.provider)
  try {
    for (const provider of ['claude', 'codex'] as const) {
      const catalog = await service.list({ rootPath: process.cwd(), provider } as ConversationThread)
      expect(catalog.warning).toBeUndefined()
      expect(catalog.commands.some(command => command.name === 'compact')).toBe(true)
      expect(catalog.commands.some(command => command.name === 'model')).toBe(true)
      expect(catalog.commands.filter(command => command.source === provider).length).toBeGreaterThan(4)
    }
  } finally { await service.stop() }
}, 25000)

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('Claude local CLI commands retain model choice in a persistent Thread process without inference', async () => {
  let launches = 0, resolveTurn: (() => void) | undefined
  const events: ThreadEvent[] = []
  const adapter = new ClaudeConversationAdapter((args, cwd) => { launches++; return new AgentProcessTransport('claude', [...args, '--no-session-persistence'], cwd) })
  await adapter.start({ rootPath: process.cwd(), nativeSessionId: null }, event => { events.push(event); if (event.type === 'completed') resolveTurn?.() })
  const turn = async (command: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = new Promise<void>((resolve, reject) => { resolveTurn = resolve; timer = setTimeout(() => reject(Error('Native local command timed out')), 8000) })
    try { await adapter.send(command); await completed; expect(events.at(-1)).toMatchObject({ type: 'completed', status: 'completed' }) }
    finally { clearTimeout(timer); resolveTurn = undefined }
  }
  try {
    await turn('/context')
    await turn('/model sonnet')
    await turn('/context')
    expect(launches).toBe(1)
    expect(events.filter(event => event.type === 'message').at(-1)).toMatchObject({ text: expect.stringMatching(/sonnet/i) })
  } finally { await adapter.dispose() }
}, 30000)
