import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { AgentAccountContext, AgentAccountSnapshot } from '../../../../shared/types/agentAuth'
import type { ThreadProvider } from '../../../../shared/types/thread'
import { AgentRpcPeer } from './rpc-peer'
import { AgentProcessTransport } from './process-transport'

export interface NativeAuthScope { id: string; provider: ThreadProvider; command: string; cwd: string }
export interface AccountTransport {
  write(text: string): void
  onData(listener: (data: Uint8Array) => void): void
  onDiagnostic(listener: (data: Uint8Array) => void): void
  onClose(listener: () => void): void
  endInput(): void
  close(): Promise<void>
  readonly exitCode: number | null
}
export function authScopeId(provider: ThreadProvider, command: string, cwd: string): string {
  return createHash('sha256').update(JSON.stringify([provider, command, cwd, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR, process.env.USERPROFILE ?? process.env.HOME])).digest('hex').slice(0, 24)
}
export function loginUrl(value: string, provider: ThreadProvider): string | null {
  try {
    const url = new URL(value)
    const hosts = provider === 'codex' ? ['auth.openai.com', 'chatgpt.com'] : ['claude.ai', 'claude.com', 'platform.claude.com', 'console.anthropic.com']
    return url.protocol === 'https:' && !url.username && !url.password && hosts.includes(url.hostname) ? url.href : null
  } catch { return null }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function label(value: unknown): string | undefined { return typeof value === 'string' && value.length < 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined }
export function claudeAccount(scope: NativeAuthScope, payload: unknown): AgentAccountSnapshot {
  const value = object(payload)
  if (typeof value.loggedIn !== 'boolean') throw Error('Invalid status')
  const method = value.authMethod === 'claude.ai' ? 'subscription' : value.authMethod === 'api_key' ? 'api' : value.loggedIn ? 'other' : 'unknown'
  return { provider: scope.provider, scopeId: scope.id, state: value.loggedIn ? 'connected' : 'signed-out', method,
    checkedAt: Date.now(), accountLabel: label(value.email), planLabel: typeof value.subscriptionType === 'string' ? value.subscriptionType.slice(0, 40) : undefined }
}
export function codexAccount(scope: NativeAuthScope, payload: unknown): AgentAccountSnapshot {
  const value = object(payload)
  if (!('account' in value)) throw Error('Invalid status')
  const account = object(value.account)
  return { provider: scope.provider, scopeId: scope.id, state: value.account ? 'connected' : 'signed-out',
    method: account.type === 'chatgpt' ? 'subscription' : account.type === 'apiKey' ? 'api' : value.account ? 'other' : 'unknown',
    accountLabel: label(account.email), planLabel: typeof account.planType === 'string' ? account.planType.slice(0, 40) : undefined, checkedAt: Date.now() }
}
interface Attempt {
  id: string; scope: NativeAuthScope; transport?: AccountTransport; rpc?: AgentRpcPeer; timer: ReturnType<typeof setTimeout>
  nativeId?: string; url?: string; completing?: boolean; earlyCompletion?: Record<string, unknown>
}
interface AccountDependencies {
  resolve(context: AgentAccountContext): Promise<NativeAuthScope>
  openExternal(url: string): Promise<unknown>
  changed(snapshot: AgentAccountSnapshot): void
  beforeLogin?(provider: ThreadProvider): Promise<void>
  connected?(provider: ThreadProvider): Promise<void>
  transport?(command: string, args: string[], cwd: string): AccountTransport
  timeoutMs?: number
}
export class NativeAccountService {
  private readonly attempts = new Map<string, Attempt>()
  private readonly snapshots = new Map<string, AgentAccountSnapshot>()
  private stopped = false
  private readonly probes = new Set<AccountTransport>()
  constructor(private readonly deps: AccountDependencies) {}
  private transport(scope: NativeAuthScope, args: string[]): AccountTransport {
    return this.deps.transport?.(scope.command, args, scope.cwd) ?? new AgentProcessTransport(scope.command, args, scope.cwd)
  }
  private publish(snapshot: AgentAccountSnapshot): AgentAccountSnapshot {
    if (!this.stopped) { this.snapshots.set(snapshot.scopeId, snapshot); this.deps.changed(snapshot) }
    return snapshot
  }
  private failure(scope: NativeAuthScope, code: AgentAccountSnapshot['errorCode']): AgentAccountSnapshot {
    return this.publish({ provider: scope.provider, scopeId: scope.id, state: code === 'installation' ? 'missing-cli' : 'error', method: 'unknown', checkedAt: Date.now(), errorCode: code })
  }
  private async rpc(scope: NativeAuthScope, transport: AccountTransport, notification: (method: string, params: unknown) => void = () => {}): Promise<AgentRpcPeer> {
    const rpc = new AgentRpcPeer(line => transport.write(line), message => notification(message.method ?? '', message.params), message => {
      if (message.id !== undefined) rpc.rejectRequest(message.id)
    }, 8000)
    transport.onData(chunk => { try { rpc.push(chunk) } catch { void transport.close() } })
    transport.onClose(() => rpc.close())
    await rpc.request('initialize', { clientInfo: { name: 'oxespace-accounts', title: 'OXESpace', version: '0.13.0' } })
    rpc.notify('initialized')
    return rpc
  }
  async read(context: AgentAccountContext): Promise<AgentAccountSnapshot> {
    const scope = await this.deps.resolve(context)
    const active = [...this.attempts.values()].find(attempt => attempt.scope.id === scope.id)
    if (active) return this.snapshots.get(scope.id)!
    if (this.stopped) return this.failure(scope, 'connection')
    return this.probe(scope)
  }
  private async probe(scope: NativeAuthScope): Promise<AgentAccountSnapshot> {
    let transport: AccountTransport
    try { transport = this.transport(scope, scope.provider === 'codex' ? ['app-server', '--listen', 'stdio://'] : ['auth', 'status', '--json']) }
    catch { return this.failure(scope, 'installation') }
    this.probes.add(transport)
    let rpc: AgentRpcPeer | undefined
    try {
      if (scope.provider === 'codex') {
        rpc = await this.rpc(scope, transport)
        return this.publish(codexAccount(scope, await rpc.request('account/read', { refreshToken: true })))
      }
      const json = await new Promise<string>((resolve, reject) => {
        let output = ''; const decoder = new StringDecoder('utf8')
        const timer = setTimeout(() => reject(Error('timeout')), 8000)
        transport.onData(data => { output += decoder.write(Buffer.from(data)); if (output.length > 65536) { clearTimeout(timer); reject(Error('limit')) } })
        transport.onClose(() => { clearTimeout(timer); resolve(output + decoder.end()) })
        transport.endInput()
      })
      return this.publish(claudeAccount(scope, JSON.parse(json)))
    } catch { return this.failure(scope, 'connection') }
    finally { rpc?.close(); this.probes.delete(transport); await transport.close() }
  }
  async requireSubscription(context: AgentAccountContext): Promise<void> {
    if ([...this.attempts.values()].some(attempt => attempt.scope.provider === context.provider)) throw Error('THREAD_AUTH_REQUIRED')
    const status = await this.read(context)
    if ([...this.attempts.values()].some(attempt => attempt.scope.provider === context.provider)) throw Error('THREAD_AUTH_REQUIRED')
    if (status.state !== 'connected' || status.method !== 'subscription') throw Error('THREAD_AUTH_REQUIRED')
  }
  async login(context: AgentAccountContext): Promise<AgentAccountSnapshot> {
    const scope = await this.deps.resolve(context)
    if (this.stopped) return this.failure(scope, 'connection')
    const existing = [...this.attempts.values()].find(attempt => attempt.scope.id === scope.id)
    if (existing) return this.snapshots.get(scope.id)!
    // Native stores are shared across contexts: a second login for a provider is rejected.
    if ([...this.attempts.values()].some(attempt => attempt.scope.provider === scope.provider)) return this.failure(scope, 'configuration')
    const id = randomUUID()
    const attempt: Attempt = { id, scope, timer: setTimeout(() => { void this.finish(attempt, 'timeout') }, this.deps.timeoutMs ?? 300000) }
    this.attempts.set(id, attempt)
    this.publish({ provider: scope.provider, scopeId: scope.id, state: 'connecting', method: 'unknown', checkedAt: Date.now(), attemptId: id })
    try {
      try { await this.deps.beforeLogin?.(scope.provider) } catch { await this.finish(attempt, 'active-turn'); return this.snapshots.get(scope.id)! }
      if (!this.attempts.has(id) || this.stopped) return this.snapshots.get(scope.id)!
      const transport = attempt.transport = this.transport(scope, scope.provider === 'codex' ? ['app-server', '--listen', 'stdio://'] : ['auth', 'login', '--claudeai'])
      if (scope.provider === 'codex') {
        const rpc = attempt.rpc = await this.rpc(scope, transport, (method, payload) => {
          if (method !== 'account/login/completed' || !this.attempts.has(id)) return
          const params = object(payload)
          if (!attempt.nativeId) { attempt.earlyCompletion = params; return }
          if (params.loginId === attempt.nativeId) void this.finish(attempt, params.success === true ? undefined : 'connection')
        })
        if (!this.attempts.has(id)) { await transport.close(); return this.snapshots.get(scope.id)! }
        const response = object(await rpc.request('account/login/start', { type: 'chatgpt' }))
        if (!this.attempts.has(id) || attempt.completing) return this.snapshots.get(scope.id)!
        if (typeof response.loginId !== 'string' || typeof response.authUrl !== 'string') throw Error('Unsupported login')
        attempt.nativeId = response.loginId
        attempt.url = loginUrl(response.authUrl, scope.provider) ?? undefined
        if (!attempt.url) throw Error('Invalid URL')
        this.publish({ provider: scope.provider, scopeId: scope.id, state: 'awaiting-browser', method: 'unknown', checkedAt: Date.now(), attemptId: id, canOpenBrowser: true })
        await this.deps.openExternal(attempt.url)
        const early = attempt.earlyCompletion
        if (early?.loginId === attempt.nativeId) void this.finish(attempt, early.success === true ? undefined : 'connection')
        transport.onClose(() => { rpc.close(); if (!attempt.completing) void this.finish(attempt, 'connection') })
      } else {
        const decoder = new StringDecoder('utf8')
        let pending = ''
        const receive = (data: Uint8Array) => {
          if (!this.attempts.has(id)) return
          pending = (pending + decoder.write(Buffer.from(data))).slice(-16384)
          // Only recognized prompts/HTTPS URLs leave this parser, never raw process output.
          const urls = pending.match(/https:\/\/[^\s<>"\u001b]+/g) ?? []
          const url = urls.map(value => loginUrl(value, 'claude')).find(Boolean)
          if (url) attempt.url = url
          const codePrompt = /(?:paste|enter) (?:the |your )?(?:authentication |authorization |login )?code|paste code here/i.test(pending)
          this.publish({ provider: scope.provider, scopeId: scope.id, state: codePrompt ? 'awaiting-code' : 'awaiting-browser', method: 'unknown', checkedAt: Date.now(), attemptId: id, canOpenBrowser: Boolean(attempt.url) })
        }
        transport.onData(receive); transport.onDiagnostic(receive)
        transport.onClose(() => { void this.finish(attempt, transport.exitCode === 0 ? undefined : 'connection') })
        this.publish({ provider: scope.provider, scopeId: scope.id, state: 'awaiting-browser', method: 'unknown', checkedAt: Date.now(), attemptId: id })
      }
    } catch { await this.finish(attempt, attempt.transport ? 'connection' : 'installation') }
    return this.snapshots.get(scope.id)!
  }
  async logout(context: AgentAccountContext): Promise<AgentAccountSnapshot> {
    const scope = await this.deps.resolve(context)
    if (this.stopped) return this.failure(scope, 'connection')
    if ([...this.attempts.values()].some(attempt => attempt.scope.provider === scope.provider)) return this.failure(scope, 'configuration')
    try { await this.deps.beforeLogin?.(scope.provider) } catch { return this.failure(scope, 'active-turn') }
    let transport: AccountTransport | undefined, rpc: AgentRpcPeer | undefined
    try {
      transport = this.transport(scope, scope.provider === 'codex' ? ['app-server', '--listen', 'stdio://'] : ['auth', 'logout'])
      if (scope.provider === 'codex') {
        rpc = await this.rpc(scope, transport)
        await rpc.request('account/logout', {})
      } else {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('timeout')), 15000)
          transport!.onClose(() => { clearTimeout(timer); if (transport!.exitCode === 0) resolve(); else reject(Error('logout failed')) })
          transport!.endInput()
        })
      }
      return this.publish({ provider: scope.provider, scopeId: scope.id, state: 'signed-out', method: 'unknown', checkedAt: Date.now() })
    } catch { return this.failure(scope, 'connection') }
    finally { rpc?.close(); await transport?.close().catch(() => {}) }
  }
  private async finish(attempt: Attempt, errorCode?: AgentAccountSnapshot['errorCode']): Promise<void> {
    if (!this.attempts.has(attempt.id) || attempt.completing) return
    attempt.completing = true
    clearTimeout(attempt.timer)
    if (errorCode && attempt.rpc && attempt.nativeId) await attempt.rpc.request('account/login/cancel', { loginId: attempt.nativeId }).catch(() => {})
    attempt.rpc?.close()
    await attempt.transport?.close()
    if (this.stopped) { this.attempts.delete(attempt.id); return }
    if (errorCode) { this.attempts.delete(attempt.id); this.failure(attempt.scope, errorCode); return }
    const status = await this.probe(attempt.scope)
    this.attempts.delete(attempt.id)
    if (status.state === 'connected' && status.method === 'subscription' && !this.stopped) await this.deps.connected?.(attempt.scope.provider).catch(() => { this.failure(attempt.scope, 'connection') })
  }
  async cancel(id: string): Promise<void> { const attempt = this.attempts.get(id); if (attempt) await this.finish(attempt, 'cancelled') }
  async submitCode(id: string, code: string): Promise<void> {
    const attempt = this.attempts.get(id)
    if (!attempt || attempt.scope.provider !== 'claude' || this.snapshots.get(attempt.scope.id)?.state !== 'awaiting-code' || !code || code.length > 4096 || /[\r\n\0]/.test(code)) throw Error('Invalid login code')
    attempt.transport?.write(code + '\n')
  }
  async openBrowser(id: string): Promise<void> { const attempt = this.attempts.get(id); if (!attempt?.url) throw Error('Login browser link unavailable'); await this.deps.openExternal(attempt.url) }
  async stop(): Promise<void> { this.stopped = true; await Promise.all([...this.probes].map(transport => transport.close())); await Promise.all([...this.attempts.values()].map(attempt => this.finish(attempt, 'cancelled'))) }
}
