import { describe, expect, it, vi } from 'vitest'
import { NativeAccountService, claudeAccount, codexAccount, loginUrl, type AccountTransport, type NativeAuthScope } from '../electron/main/services/conversation/native-account.service'
import { subscriptionEnvironment } from '../electron/main/services/conversation/process-transport'
const scope: NativeAuthScope = { id: 'scope', provider: 'codex', command: 'codex', cwd: '/repo' }
class FakeTransport implements AccountTransport {
  data: (data: Uint8Array) => void = () => {}
  diagnostic: (data: Uint8Array) => void = () => {}
  closed: () => void = () => {}
  exitCode: number | null = null
  requests: Record<string, unknown>[] = []
  writes: string[] = []
  constructor(private readonly reply: (method: string) => unknown = () => ({})) {}
  write(line: string) {
    this.writes.push(line)
    if (!line.startsWith('{')) return
    const request = JSON.parse(line); this.requests.push(request)
    if (request.id) queueMicrotask(() => this.emit({ id: request.id, result: this.reply(request.method) }))
  }
  emit(value: unknown) { this.data(Buffer.from(JSON.stringify(value) + '\n')) }
  onData(listener: (data: Uint8Array) => void) { this.data = listener }
  onDiagnostic(listener: (data: Uint8Array) => void) { this.diagnostic = listener }
  onClose(listener: () => void) { this.closed = listener }
  endInput() {}
  close = vi.fn(async () => {})
}
function fixture(provider = 'codex' as 'codex' | 'claude') {
  const login = new FakeTransport(method => method === 'account/login/start' ? { loginId: 'native-login', authUrl: 'https://auth.openai.com/authorize?state=private-value' } : {})
  const probe = new FakeTransport(method => method === 'account/read' ? { account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro' } } : {})
  const changed = vi.fn(), openExternal = vi.fn(async () => {}), connected = vi.fn(async () => {})
  const service = new NativeAccountService({ resolve: async () => ({ ...scope, provider }), openExternal, changed, connected,
    transport: (_command, args) => args.includes('status') ? probe : args.includes('login') ? login : connected.mock.calls.length ? probe : login })
  return { service, login, probe, changed, openExternal, connected }
}
describe('Native subscription accounts', () => {
  it('confirms Claude login after native exit through a fresh JSON status check', async () => {
    const login = new FakeTransport(), probe = new FakeTransport(), changed = vi.fn(), connected = vi.fn(async () => {})
    probe.endInput = () => { queueMicrotask(() => { probe.emit({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }); probe.exitCode = 0; probe.closed() }) }
    const service = new NativeAccountService({ resolve: async () => ({ ...scope, provider: 'claude' }), changed, connected, openExternal: vi.fn(),
      transport: (_command, args) => args.includes('status') ? probe : login })
    await service.login({ provider: 'claude', workspaceId: 'ws' })
    login.data(Buffer.from('Login successful.\n'))
    expect(login.writes).toEqual([])
    login.exitCode = 0; login.closed()
    await vi.waitFor(() => expect(connected).toHaveBeenCalledWith('claude'))
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'connected', method: 'subscription', planLabel: 'max' })
    expect(probe.close).toHaveBeenCalled()
    await service.stop()
  })
  it('expires and closes pending login processes without accepting late callbacks', async () => {
    const transport = new FakeTransport(method => method === 'account/login/start' ? { loginId: 'login', authUrl: 'https://auth.openai.com/authorize' } : {})
    const changed = vi.fn(), connected = vi.fn()
    const service = new NativeAccountService({ resolve: async () => scope, openExternal: vi.fn(async () => {}), changed, connected, transport: () => transport, timeoutMs: 25 })
    await service.login({ provider: 'codex', workspaceId: 'ws' })
    await vi.waitFor(() => expect(changed.mock.calls.at(-1)?.[0].errorCode).toBe('timeout'))
    expect(transport.close).toHaveBeenCalledOnce()
    transport.emit({ method: 'account/login/completed', params: { loginId: 'login', success: true } })
    expect(connected).not.toHaveBeenCalled()
    await service.stop()
  })
  it('blocks sends in a different directory while the shared provider account is reconnecting', async () => {
    const f = fixture()
    await f.service.login({ provider: 'codex', workspaceId: 'ws' })
    await expect(f.service.requireSubscription({ provider: 'codex', workspaceId: 'another-workspace' })).rejects.toThrow('THREAD_AUTH_REQUIRED')
    await f.service.stop()
  })
  it('reports missing executables without publishing native errors', async () => {
    const changed = vi.fn()
    const service = new NativeAccountService({ resolve: async () => scope, openExternal: vi.fn(), changed, transport: () => { throw Error('Sensitive executable detail') } })
    expect(await service.read({ provider: 'codex', workspaceId: 'ws' })).toMatchObject({ state: 'missing-cli', errorCode: 'installation' })
    expect(JSON.stringify(changed.mock.calls)).not.toContain('Sensitive executable detail')
    await service.stop()
  })
  it('allows only official HTTPS login URLs', () => {
    expect(loginUrl('https://auth.openai.com/authorize', 'codex')).toBeTruthy()
    for (const url of ['http://auth.openai.com/x', 'https://auth.openai.com.evil.test/x', 'file:///secret', 'https://user:pass@auth.openai.com/x']) expect(loginUrl(url, 'codex')).toBeNull()
    expect(loginUrl('https://claude.ai/oauth/authorize', 'claude')).toBeTruthy()
  })
  it('does not classify API authentication as a subscription', () => {
    expect(codexAccount(scope, { account: { type: 'apiKey' } }).method).toBe('api')
    expect(claudeAccount({ ...scope, provider: 'claude' }, { loggedIn: true, authMethod: 'api_key' }).method).toBe('api')
    expect(claudeAccount({ ...scope, provider: 'claude' }, { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' })).toMatchObject({ state: 'connected', method: 'subscription', planLabel: 'max' })
    expect(() => claudeAccount(scope, { error: 'sensitive stderr' })).toThrow('Invalid status')
  })
  it('isolates subprocess credentials without mutating the host environment', () => {
    const source = { Path: 'native-path', OXESPACE_MCP_TOKEN: 'secret', ANTHROPIC_API_KEY: 'secret', OPENAI_API_KEY: 'secret', CODEX_HOME: 'native-home', CLAUDE_CONFIG_DIR: 'native-claude', HTTPS_PROXY: 'proxy' }
    expect(subscriptionEnvironment(source)).toEqual({ Path: 'native-path', CODEX_HOME: 'native-home', CLAUDE_CONFIG_DIR: 'native-claude', HTTPS_PROXY: 'proxy' })
    expect(source.ANTHROPIC_API_KEY).toBe('secret')
  })
  it('starts a managed Codex login without creating a model thread and cancels it', async () => {
    const f = fixture()
    const status = await f.service.login({ provider: 'codex', workspaceId: 'ws' })
    expect(status).toMatchObject({ state: 'awaiting-browser', canOpenBrowser: true })
    expect(f.openExternal).toHaveBeenCalledOnce()
    expect(f.login.requests.map(r => r.method)).toEqual(['initialize', 'initialized', 'account/login/start'])
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain('private-value')
    await f.service.cancel(status.attemptId!)
    expect(f.login.requests.at(-1)?.method).toBe('account/login/cancel')
    expect(f.changed.mock.calls.at(-1)?.[0].errorCode).toBe('cancelled')
    f.login.emit({ method: 'account/login/completed', params: { loginId: 'native-login', success: true } })
    expect(f.connected).not.toHaveBeenCalled()
    await f.service.stop()
  })
  it('deduplicates login clicks and refuses a reconnect during an active turn', async () => {
    const f = fixture()
    const [a, b] = await Promise.all([f.service.login({ provider: 'codex', workspaceId: 'ws' }), f.service.login({ provider: 'codex', workspaceId: 'ws' })])
    expect(a.attemptId).toBe(b.attemptId)
    expect(f.login.requests.filter(r => r.method === 'account/login/start')).toHaveLength(1)
    await f.service.stop()
    const blocked = new NativeAccountService({ resolve: async () => scope, openExternal: vi.fn(), changed: vi.fn(), beforeLogin: async () => { throw Error('busy') }, transport: vi.fn() })
    expect(await blocked.login({ provider: 'codex', workspaceId: 'ws' })).toMatchObject({ errorCode: 'active-turn' })
    await blocked.stop()
  })
  it('forwards a Claude callback code only to the active login and never publishes it', async () => {
    const f = fixture('claude')
    const status = await f.service.login({ provider: 'claude', workspaceId: 'ws' })
    f.login.data(Buffer.from('https://claude.ai/oauth/authorize?state=private\nPaste code here if prompted:'))
    expect(f.changed.mock.calls.at(-1)?.[0].state).toBe('awaiting-code')
    await f.service.submitCode(status.attemptId!, 'private-code')
    expect(f.login.writes.at(-1)).toBe('private-code\n')
    expect(JSON.stringify(f.changed.mock.calls)).not.toContain('private-code')
    await f.service.cancel(status.attemptId!)
    await expect(f.service.submitCode(status.attemptId!, 'stale')).rejects.toThrow()
    await f.service.stop()
  })
  it('checks a Codex account through the native RPC and blocks non-subscription preflight', async () => {
    const transport = new FakeTransport(method => method === 'account/read' ? { account: { type: 'apiKey' } } : {})
    const service = new NativeAccountService({ resolve: async () => scope, openExternal: vi.fn(), changed: vi.fn(), transport: () => transport })
    expect(await service.read({ provider: 'codex', workspaceId: 'ws' })).toMatchObject({ state: 'connected', method: 'api' })
    await expect(service.requireSubscription({ provider: 'codex', workspaceId: 'ws' })).rejects.toThrow('THREAD_AUTH_REQUIRED')
    expect(transport.close).toHaveBeenCalled()
    await service.stop()
  })
  it('confirms successful login through a fresh native account probe', async () => {
    let calls = 0
    const login = new FakeTransport(method => method === 'account/login/start' ? { loginId: 'native-login', authUrl: 'https://auth.openai.com/authorize' } : {})
    const probe = new FakeTransport(method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'pro' } } : {})
    const changed = vi.fn(), connected = vi.fn(async () => {})
    const service = new NativeAccountService({ resolve: async () => scope, changed, connected, openExternal: vi.fn(async () => {}), transport: () => ++calls === 1 ? login : probe })
    await service.login({ provider: 'codex', workspaceId: 'ws' })
    login.emit({ method: 'account/login/completed', params: { loginId: 'native-login', success: true } })
    await vi.waitFor(() => expect(connected).toHaveBeenCalledOnce())
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ state: 'connected', method: 'subscription' })
    await service.stop()
  })
})
