import { splitThreadPatch } from '../../../../shared/threadPatch'
import { randomUUID } from 'node:crypto'
import type { AgentConversationAdapter, ConversationProtocolEvidence, ThreadAgentInput, ThreadEvent, ThreadConfiguration, ThreadCommandResult, ThreadFailure, ThreadUsage, ThreadAttachment, ThreadQueuedInput, ThreadRequest, ThreadRequestResponse } from '../../../../shared/types/thread'
import { AgentRpcPeer, type AgentRpcMessage } from './rpc-peer'
import { parseThreadUsage, threadFailure, ThreadAgentError } from './thread-failure'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'

export interface ConversationTransport {
  write(line: string): void
  onData(listener: (chunk: Uint8Array) => void): void
  onClose(listener: () => void): void
  close(): Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function subagentStatus(value: unknown): import('../../../../shared/types/thread').ThreadSubagent['status'] {
  if (value === 'pendingInit') return 'pending'
  if (value === 'running') return 'running'
  if (value === 'interrupted') return 'interrupted'
  if (value === 'completed') return 'completed'
  if (value === 'errored') return 'failed'
  if (value === 'shutdown') return 'closed'
  return 'not-found'
}
function collabState(value: unknown, started: boolean): 'running' | 'completed' | 'failed' | 'interrupted' {
  if (started || value === 'inProgress') return 'running'
  if (value === 'failed') return 'failed'
  if (value === 'interrupted') return 'interrupted'
  return 'completed'
}
function dynamicToolOutput(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(entry => {
    const item = record(entry)
    if (item.type === 'inputText') return text(item.text)
    if (item.type === 'inputImage') return '[image output]'
    if (item.type === 'inputAudio') return '[audio output]'
    return ''
  }).filter(Boolean).join('\n').slice(-65536)
}

/** Codex stable App Server protocol. The transport owns process spawning/cleanup. */
export class CodexConversationAdapter implements AgentConversationAdapter {
  readonly capabilities = { resume: true, approvals: true, attachments: true, modelSelection: true, questions: true, permissions: true, elicitation: true, queue: true, steering: true, nativeSessions: true }
  readonly evidence: ConversationProtocolEvidence = { transport: 'codex-app-server-jsonrpc', verified: 'fixture' }
  private rpc: AgentRpcPeer | null = null
  private threadId = ''
  private turnId = ''
  private busy = false
  private disposed = false
  private model = ''
  private effort = ''
  private rootPath = ''
  private access: ThreadConfiguration['access'] = 'read-only'
  private networkAccess = false
  private approvalPolicy: NonNullable<ThreadConfiguration['approvalPolicy']> = 'on-request'
  private mode: ThreadConfiguration['mode'] = 'default'
  private usage?: ThreadUsage
  private usageRequest?: Promise<ThreadUsage>
  private usageSnapshots: Record<string, Record<string, unknown>> = {}
  private turnError?: ThreadFailure
  private lastNativeSignalAt = 0
  private readonly reasoningSummaries = new Map<string, { text: string; emittedAt: number }>()
  private readonly commandOutputs = new Map<string, { text: string; emittedAt: number }>()
  private emit: (event: ThreadEvent) => void = () => {}
  private readonly approvals = new Map<string, { rpcId: string | number; method: string; params: Record<string, unknown> }>()
  private readonly pendingOauth = new Set<string>()

  constructor(private readonly transport: ConversationTransport) {}

  async start(context: { rootPath: string; nativeSessionId: string | null } & ThreadConfiguration, emit: (event: ThreadEvent) => void): Promise<void> {
    if (this.rpc || this.disposed) throw new Error('Conversation adapter cannot be started twice')
    this.emit = emit
    this.rootPath = context.rootPath
    this.access = context.access ?? 'read-only'
    this.networkAccess = context.networkAccess ?? false
    this.approvalPolicy = context.approvalPolicy ?? 'on-request'
    this.mode = context.mode ?? 'default'
    const rpc = this.rpc = new AgentRpcPeer(
      line => this.transport.write(line),
      message => this.notification(message),
      message => this.hostRequest(message)
    )
    this.transport.onData(chunk => {
      try { rpc.push(chunk) } catch {
        this.fail('Invalid agent protocol stream')
        void this.dispose()
      }
    })
    this.transport.onClose(() => {
      rpc.close()
      if (!this.disposed && this.busy) this.fail('Agent connection closed during the turn')
    })
    try {
      const handshake = record(await rpc.request('initialize', { clientInfo: { name: 'oxespace', title: 'OXESpace', version: '0.13.0' }, capabilities: { experimentalApi: true } }))
      const serverInfo = record(handshake.serverInfo)
      const providerVersion = text(serverInfo.version) || text(handshake.version) || text(handshake.userAgent)
      const protocolVersion = text(handshake.protocolVersion)
      if (providerVersion) this.evidence.providerVersion = providerVersion.slice(0, 120)
      if (protocolVersion) this.evidence.protocolVersion = protocolVersion.slice(0, 80)
      this.evidence.verified = 'native'
      rpc.notify('initialized')
      const response = record(await rpc.request(context.nativeSessionId ? 'thread/resume' : 'thread/start', {
        ...(context.nativeSessionId ? { threadId: context.nativeSessionId } : {}),
        cwd: context.rootPath,
        modelProvider: 'openai',
        approvalPolicy: this.approvalPolicy,
        sandbox: this.access === 'full-access' ? 'danger-full-access' : this.access,
        ...(context.model ? { model: context.model } : {}), ...(context.reasoningEffort ? { effort: context.reasoningEffort } : {})
      }))
      this.threadId = text(record(response.thread).id)
      this.model = context.model || text(response.model)
      this.effort = context.reasoningEffort || text(response.reasoningEffort)
      if (!this.threadId) throw new Error('Agent did not return a conversation identifier')
      if (this.access === 'workspace-write' && this.networkAccess) await rpc.request('thread/settings/update', { threadId: this.threadId, sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.rootPath], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } })
      emit({ type: 'session', nativeSessionId: this.threadId })
      emit({ type: 'configuration', model: this.model || undefined, reasoningEffort: this.effort || undefined, access: this.access, networkAccess: this.networkAccess, approvalPolicy: this.approvalPolicy, confirmed: true })
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  async send(input: string, skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.rpc || !this.threadId || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('A conversation turn is already running')
    if (!input.trim() || Buffer.byteLength(input) > 64 * 1024) throw new Error('Invalid conversation input')
    this.busy = true
    this.turnError = undefined
    this.reasoningSummaries.clear()
    this.commandOutputs.clear()
    try {
      if (!skill && await this.slashCommand(input)) return
      if (input.trim() === '/compact' && !skill) {
        await this.rpc.request('thread/compact/start', { threadId: this.threadId })
        return
      }
      const result = record(await this.rpc.request('turn/start', {
        threadId: this.threadId, input: this.input(input, skill, attachments),
        ...(this.model ? { model: this.model } : {}), ...(this.effort ? { effort: this.effort } : {}),
        ...(this.mode === 'plan' ? { collaborationMode: { mode: 'plan', settings: { model: this.model, reasoning_effort: this.effort || null, developer_instructions: null } } } : {})
      }))
      if (this.busy) this.turnId = text(record(result.turn).id)
    } catch (error) {
      const failure = error instanceof ThreadAgentError ? error.failure : threadFailure({ message: error instanceof Error ? error.message : '' })
      this.fail(failure)
      throw new ThreadAgentError(failure)
    }
  }

  async steer(input: string, attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.rpc || !this.threadId || !this.turnId || !this.busy) throw Error('There is no active turn to steer')
    await this.rpc.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.turnId, input: this.input(input, undefined, attachments), clientUserMessageId: randomUUID() })
  }

  async enqueue(item: ThreadQueuedInput, attachments: ThreadAttachment[] = []): Promise<string | undefined> {
    if (!this.rpc || !this.threadId) throw Error('Conversation is not connected')
    const result = record(await this.rpc.request('thread/queue/add', { threadId: this.threadId, clientUserMessageId: item.id, input: this.input(item.text, undefined, attachments) }))
    return text(result.queuedSubmissionId) || text(record(result.queuedSubmission).id) || undefined
  }

  async startQueued(nativeId?: string): Promise<void> {
    if (!this.rpc || this.busy) throw Error('Conversation is not ready to start queued input')
    this.busy = true
    this.reasoningSummaries.clear()
    this.commandOutputs.clear()
    try {
      const result = record(await this.rpc.request('thread/queue/start', { threadId: this.threadId, queuedSubmissionId: nativeId ?? null }))
      this.turnId = text(record(result.turn).id)
    } catch (error) {
      this.busy = false
      throw error
    }
  }

  async updateQueued(nativeId: string, item: ThreadQueuedInput, attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.rpc) throw Error('Conversation is not connected')
    await this.rpc.request('thread/queue/update', { threadId: this.threadId, queuedSubmissionId: nativeId, input: this.input(item.text, undefined, attachments) })
  }

  async deleteQueued(nativeId: string): Promise<void> {
    if (!this.rpc) throw Error('Conversation is not connected')
    await this.rpc.request('thread/queue/delete', { threadId: this.threadId, queuedSubmissionId: nativeId })
  }

  async reorderQueued(nativeIds: string[]): Promise<void> {
    if (!this.rpc) throw Error('Conversation is not connected')
    await this.rpc.request('thread/queue/reorder', { threadId: this.threadId, queuedSubmissionIds: nativeIds })
  }

  private input(textValue: string, skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Record<string, unknown>[] {
    return [{ type: 'text', text: textValue },
      ...(skill ? [{ type: 'skill', ...skill }] : []),
      ...attachments.map(attachment => {
        if (!attachment.path) throw Error('Attachment is unavailable')
        return { type: 'localImage', path: attachment.path, detail: 'auto' }
      })]
  }

  private reply(text: string): void {
    this.busy = false
    this.emit({ type: 'message', id: randomUUID(), role: 'assistant', text })
    this.emit({ type: 'completed', status: 'completed' })
  }

  private async slashCommand(input: string): Promise<boolean> {
    const match = input.trim().match(/^\/(model|status|review)(?:\s+([\s\S]*))?$/)
    if (!match || !this.rpc) return false
    if (match[1] === 'status') {
      this.reply(`**Model:** ${this.model || 'Native default'}\n\n**Reasoning effort:** ${this.effort || 'Native default'}\n\n**Directory:** ${this.rootPath}\n\n**Sandbox:** ${this.access}\n\n**Network:** ${this.networkAccess ? 'allowed' : 'blocked'}\n\n**Approvals:** ${this.approvalPolicy}\n\n**Native thread:** ${this.threadId}`)
      return true
    }
    if (match[1] === 'review') {
      const result = record(await this.rpc.request('review/start', {
        threadId: this.threadId, delivery: 'inline', target: match[2]?.trim() ? { type: 'custom', instructions: match[2].trim() } : { type: 'uncommittedChanges' }
      }))
      if (this.busy) this.turnId = text(record(result.turn).id)
      return true
    }
    const result = record(await this.rpc.request('model/list', { limit: 100, includeHidden: false }))
    const models = (Array.isArray(result.data) ? result.data : []).map(record)
    if (!match[2]?.trim()) {
      this.busy = false
      this.emit({ type: 'model-picker', id: randomUUID(), selectedModel: this.model, selectedEffort: this.effort, models: models.filter(model => !model.hidden && /^[a-z0-9][a-z0-9._:/-]*$/i.test(text(model.model) || text(model.id))).slice(0, 100).map(model => ({ id: text(model.model) || text(model.id), label: text(model.displayName).slice(0, 120) || text(model.model), description: text(model.description).slice(0, 500), efforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).map(value => text(record(value).reasoningEffort)).filter(value => /^[a-z0-9_-]+$/i.test(value)), defaultEffort: text(model.defaultReasoningEffort) })) })
      this.emit({ type: 'completed', status: 'completed' })
      return true
    }
    const [name, effort, extra] = match[2].trim().split(/\s+/)
    const model = models.find(model => model.model === name || model.id === name)
    if (!model || extra) { this.reply('Model unavailable. Use `/model` to see the native model catalog.'); return true }
    const efforts = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts.map(value => text(record(value).reasoningEffort)) : []
    if (effort && !efforts.includes(effort)) { this.reply(`Unsupported reasoning effort. Available: ${efforts.join(', ') || 'native default'}.`); return true }
    this.model = text(model.model) || text(model.id)
    this.effort = effort || text(model.defaultReasoningEffort)
    this.emit({ type: 'configuration', model: this.model, reasoningEffort: this.effort })
    this.reply(`Model set to **${this.model}**${this.effort ? ` with **${this.effort}** reasoning effort` : ''}.`)
    return true
  }

  async interrupt(): Promise<void> {
    if (!this.busy) return
    if (!this.turnId || !this.rpc) throw new Error('Turn has not been acknowledged yet; retry cancellation shortly')
    await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }

  async configure(configuration: ThreadConfiguration): Promise<void> {
    if (!this.rpc || this.busy || this.disposed) throw Error('Finish the active turn before applying configuration')
    const access = configuration.access ?? this.access
    const networkAccess = configuration.networkAccess ?? this.networkAccess
    const approvalPolicy = configuration.approvalPolicy ?? this.approvalPolicy
    await this.rpc.request('thread/settings/update', { threadId: this.threadId,
      ...(configuration.model ? { model: configuration.model } : {}),
      effort: configuration.reasoningEffort ?? null,
      ...((configuration.access || configuration.networkAccess !== undefined) ? { sandboxPolicy: access === 'full-access' ? { type: 'dangerFullAccess' } : access === 'workspace-write' ? { type: 'workspaceWrite', writableRoots: [this.rootPath], networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false } : { type: 'readOnly' } } : {}),
      ...(configuration.approvalPolicy ? { approvalPolicy } : {}) })
    if (configuration.model) this.model = configuration.model
    this.effort = configuration.reasoningEffort ?? ''
    this.access = configuration.access ?? this.access
    this.networkAccess = networkAccess
    this.approvalPolicy = approvalPolicy
    this.mode = configuration.mode ?? this.mode
    this.emit({ type: 'configuration', model: this.model || undefined, reasoningEffort: this.effort || undefined, access: this.access, networkAccess: this.networkAccess, approvalPolicy: this.approvalPolicy, confirmed: true })
  }

  async command(name: string, argument: string): Promise<ThreadCommandResult> {
    if (!this.rpc || this.disposed) throw Error('Conversation is not connected')
    if (name === 'goal') {
      const value = argument.trim()
      if (value === 'clear') { await this.rpc.request('thread/goal/clear', { threadId: this.threadId }); return { kind: 'applied', title: 'Goal cleared' } }
      if (value) { await this.rpc.request('thread/goal/set', { threadId: this.threadId, goal: value }); return { kind: 'applied', title: 'Goal updated' } }
      const result = record(await this.rpc.request('thread/goal/get', { threadId: this.threadId }))
      return { kind: 'panel', title: 'Conversation goal', text: text(result.goal) || 'No active goal.' }
    }
    if (name === 'rename') { await this.rpc.request('thread/name/set', { threadId: this.threadId, name: argument }); return { kind: 'applied', title: 'Conversation renamed' } }
    if (name === 'archive') { await this.rpc.request('thread/archive', { threadId: this.threadId }); return { kind: 'applied', title: 'Conversation archived' } }
    if (name === 'delete') { await this.rpc.request('thread/delete', { threadId: this.threadId }); return { kind: 'applied', title: 'Conversation deleted' } }
    if (name === 'mcp' && argument) {
      const [action, value, extra] = argument.trim().split(/\s+/)
      if (extra || !['reload', 'login'].includes(action) || action === 'login' && !value) throw Error('Use /mcp reload or /mcp login <server>')
      if (action === 'reload') {
        await this.rpc.request('config/mcpServer/reload', {})
        return { kind: 'applied', title: 'MCP configuration reloaded' }
      }
      if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(value)) throw Error('Invalid MCP server name')
      const result = record(await this.rpc.request('mcpServer/oauth/login', { name: value, threadId: this.threadId }, 60_000))
      const authorizationUrl = text(result.authorizationUrl)
      if (!/^https?:\/\//i.test(authorizationUrl)) throw Error('The MCP server did not return an authorization URL')
      this.pendingOauth.add(value)
      return { kind: 'panel', title: `Connect ${value}`, text: 'Continue authorization in your browser. This conversation will receive the provider completion event.', externalUrl: authorizationUrl }
    }
    if (name === 'plugins' && argument) {
      const [action, value, extra] = argument.trim().split(/\s+/)
      if (extra || !['install', 'uninstall', 'reconcile'].includes(action) || action !== 'reconcile' && !value) throw Error('Use /plugins install <name>, /plugins uninstall <id> or /plugins reconcile')
      if (value && !/^[a-z0-9][a-z0-9._:/@-]{0,199}$/i.test(value)) throw Error('Invalid plugin identifier')
      if (action === 'install') await this.rpc.request('plugin/install', { pluginName: value, installAttemptId: randomUUID() }, 60_000)
      else if (action === 'uninstall') await this.rpc.request('plugin/uninstall', { pluginId: value }, 60_000)
      else await this.rpc.request('plugin/reconcile', { reason: 'Requested from OXESpace Thread' }, 60_000)
      return { kind: 'applied', title: action === 'install' ? 'Plugin installed' : action === 'uninstall' ? 'Plugin uninstalled' : 'Plugins reconciled' }
    }
    if (name === 'apps' && argument) {
      const appId = argument.trim()
      if (!/^[a-z0-9][a-z0-9._:/-]{0,199}$/i.test(appId)) throw Error('Invalid app identifier')
      const result = record(await this.rpc.request('app/read', { appIds: [appId], includeTools: true, threadId: this.threadId }))
      const entries = result.data ?? result.apps
      const rows = (Array.isArray(entries) ? entries : []).map(value => {
        const entry = record(value)
        const tools = Array.isArray(entry.tools) ? entry.tools.length : Object.keys(record(entry.tools)).length
        return { label: text(entry.name) || text(entry.id) || appId, detail: `${tools} tools${entry.enabled === false ? ' · disabled' : ''}` }
      })
      return { kind: 'panel', title: 'Connected app', rows }
    }
    const methods: Record<string, [string, unknown]> = {
      usage: ['account/rateLimits/read', {}], mcp: ['mcpServerStatus/list', { limit: 100, threadId: this.threadId }],
      apps: ['app/list', { limit: 100, threadId: this.threadId }], plugins: ['plugin/list', { cwds: [this.rootPath] }],
      hooks: ['hooks/list', { cwd: this.rootPath }], experimental: ['experimentalFeature/list', {}],
      'debug-config': ['config/read', { cwd: this.rootPath, includeLayers: true }],
      ps: ['thread/backgroundTerminals/list', { threadId: this.threadId }], memories: ['config/read', { cwd: this.rootPath, includeLayers: false }],
      fork: ['thread/fork', { threadId: this.threadId, cwd: this.rootPath, sandbox: this.access, approvalPolicy: 'on-request' }],
      rewind: ['thread/rollback', { threadId: this.threadId, numTurns: Number(argument) || 1 }]
    }
    const operation = methods[name]
    if (!operation) throw Error(`/${name} is not supported by this adapter`)
    if (['fork', 'rewind'].includes(name) && this.busy) throw Error('Finish the active turn first')
    if (name === 'usage') {
      const usage = await this.readUsage()
      return { kind: 'panel', title: 'Usage limits', usage, rows: usage.windows.map(window => ({ label: window.label, detail: `${window.usedPercent}% used${window.resetsAt ? ` · resets ${new Date(window.resetsAt).toLocaleString()}` : ' · reset not provided'}` })) }
    }
    const result = record(await this.rpc.request(operation[0], operation[1], ['mcp', 'plugins'].includes(name) ? 60_000 : undefined))
    if (name === 'fork') return { kind: 'navigate', threadId: text(record(result.thread).id) }
    if (name === 'rewind') return { kind: 'applied', title: 'Conversation rewound' }
    // Render only explicitly selected public fields, never raw provider payloads/configuration.
    const rows: NonNullable<ThreadCommandResult['rows']> = []
    if (name === 'debug-config' || name === 'memories') {
      const configuration = record(result.config ?? result.value ?? result)
      const visible = ['model', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode', 'memory_mode'].flatMap(key => configuration[key] === undefined ? [] : [{ label: key, detail: String(configuration[key]).slice(0, 500) }])
      return { kind: 'panel', title: name === 'debug-config' ? 'Effective configuration' : 'Memory configuration', rows: visible }
    }
    const entries = result.data ?? result.plugins ?? result.marketplaces ?? result.hooks ?? result.features ?? result.terminals
    for (const value of Array.isArray(entries) ? entries : []) {
      const entry = record(value)
      const detail = name === 'mcp'
        ? `${Object.keys(record(entry.tools)).length} tools · ${Array.isArray(entry.resources) ? entry.resources.length : 0} resources · ${Array.isArray(entry.resourceTemplates) ? entry.resourceTemplates.length : 0} templates`
        : text(entry.description) || text(entry.authStatus) || text(entry.status) || text(entry.command) || (entry.enabled === false ? 'Disabled' : entry.enabled === true ? 'Enabled' : '')
      rows.push({ label: text(entry.name) || text(entry.id) || 'Integration', detail })
    }
    const titles: Record<string, string> = { mcp: 'MCP servers', apps: 'Connected apps', plugins: 'Plugins', hooks: 'Hooks', experimental: 'Experimental features', ps: 'Background processes' }
    return { kind: 'panel', title: titles[name] ?? 'Provider integrations', rows }
  }

  async approve(requestId: string, decision: 'accept' | 'decline'): Promise<void> {
    await this.respondRequest(requestId, { decision })
  }

  async respondRequest(requestId: string, response: ThreadRequestResponse): Promise<void> {
    const pending = this.approvals.get(requestId)
    if (!pending || !this.rpc || this.disposed) throw new Error('Request is no longer pending')
    let result: unknown
    if (pending.method === 'item/tool/requestUserInput') {
      result = { answers: Object.fromEntries(Object.entries(response.answers ?? {}).map(([id, answers]) => [id, { answers }])) }
    } else if (pending.method === 'item/permissions/requestApproval') {
      if (!response.permissions) {
        result = { permissions: {}, scope: 'turn' }
      } else result = { permissions: response.permissions, scope: response.scope ?? 'turn' }
    } else if (pending.method === 'mcpServer/elicitation/request') {
      result = { action: response.decision ?? (response.content ? 'accept' : 'decline'), ...(response.content ? { content: response.content } : {}) }
    } else result = { decision: response.decision ?? 'decline' }
    this.rpc.respond(pending.rpcId, result)
    this.approvals.delete(requestId)
    const kind = pending.method === 'item/tool/requestUserInput' ? 'question' : pending.method === 'mcpServer/elicitation/request' ? 'elicitation' : 'approval'
    this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome(kind, response), resolvedAt: Date.now() })
    this.emit({ type: 'approval-resolved', id: requestId })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.approvals.clear()
    this.pendingOauth.clear()
    this.reasoningSummaries.clear()
    this.commandOutputs.clear()
    this.rpc?.close()
    await this.transport.close()
  }

  private readUsage(): Promise<ThreadUsage> {
    if (!this.rpc || this.disposed) return Promise.reject(Error('Conversation is not connected'))
    if (this.usageRequest) return this.usageRequest
    const request = this.rpc.request('account/rateLimits/read', {}, 8000).then(result => {
      const usage = parseThreadUsage(result)
      if (!this.disposed) {
        const response = record(result), all = record(response.rateLimitsByLimitId), limit = record(response.rateLimits)
        this.usageSnapshots = Object.keys(all).length ? Object.fromEntries(Object.entries(all).slice(0, 20).map(([id, value]) => [id, record(value)])) : { [text(limit.limitId) || 'account']: limit }
        this.usage = usage
      }
      return usage
    })
    this.usageRequest = request
    void request.finally(() => { if (this.usageRequest === request) this.usageRequest = undefined }).catch(() => {})
    return request
  }

  private fail(error: string | ThreadFailure): void {
    if (!this.busy || this.disposed) return
    const failure = typeof error === 'string' ? threadFailure({ message: error }) : error
    if (typeof error === 'string') failure.usageUnavailable = true
    if (this.usage) failure.usage = this.usage
    this.busy = false
    this.turnId = ''
    this.reasoningSummaries.clear()
    this.commandOutputs.clear()
    this.approvals.clear()
    this.emit({ type: 'completed', status: 'failed', error: failure.message, errorCode: failure.code, failure })
    if (failure.code === 'authentication' || failure.code === 'session-busy' || typeof error === 'string') return
    void this.readUsage().then(usage => {
      if (!this.disposed) this.emit({ type: 'failure-details', id: failure.id, usage, usageUnavailable: usage.windows.length === 0 })
    }, () => {
      if (!this.disposed) this.emit({ type: 'failure-details', id: failure.id, usageUnavailable: true })
    })
  }

  private notification(message: AgentRpcMessage): void {
    const params = record(message.params)
    if (this.disposed) return
    if (message.method === 'account/rateLimits/updated') {
      const update = record(params.rateLimits)
      const keys = Object.keys(this.usageSnapshots)
      const id = text(update.limitId) || (keys.length === 1 ? keys[0] : 'account')
      if (!this.usageSnapshots[id] && keys.length >= 20) return
      const previous = this.usageSnapshots[id] ?? {}, merged = { ...previous }
      for (const [key, value] of Object.entries(update)) {
        if (value === null || value === undefined) continue
        merged[key] = ['primary', 'secondary', 'individualLimit', 'workspaceLimit'].includes(key) ? { ...record(previous[key]), ...record(value) } : value
      }
      this.usageSnapshots[id] = merged
      this.usage = parseThreadUsage({ rateLimitsByLimitId: this.usageSnapshots })
      return
    }
    if (message.method === 'mcpServer/oauthLogin/completed') {
      const name = text(params.name)
      if (!name || !this.pendingOauth.has(name) || params.threadId && params.threadId !== this.threadId) return
      this.pendingOauth.delete(name)
      const success = params.success === true
      this.emit({ type: 'tool', id: `mcp-oauth:${name}:${Date.now()}`, name: 'mcpOAuth', state: success ? 'completed' : 'failed', detail: `${name} authorization`, output: success ? 'Connected' : text(params.error).slice(0, 2000) || 'Authorization failed', completedAt: Date.now() })
      return
    }
    if (params.threadId !== this.threadId) return
    if (params.turnId && this.turnId && params.turnId !== this.turnId) return
    if (this.busy && Date.now() - this.lastNativeSignalAt >= 2_000) {
      this.lastNativeSignalAt = Date.now()
      this.emit({ type: 'native-signal', at: this.lastNativeSignalAt })
    }
    if (message.method === 'error') {
      if (this.busy) this.turnError = threadFailure(params.error)
      return
    }
    if (message.method === 'turn/diff/updated') {
      const turnId = text(params.turnId)
      const files = splitThreadPatch(text(params.diff))
      if (turnId) this.emit({ type: 'turn-diff', id: `turn-diff:${turnId}`, turnId, files: files.slice(0, 100).map(file => files.length > 100 ? { ...file, truncated: true } : file) })
    }
    else if (message.method === 'item/reasoning/summaryTextDelta' && this.busy) {
      const id = text(params.itemId)
      const delta = text(params.delta)
      if (!id || !delta) return
      const previous = this.reasoningSummaries.get(id) ?? { text: '', emittedAt: 0 }
      const summary = { text: (previous.text + delta).slice(-3_000), emittedAt: previous.emittedAt }
      const now = Date.now()
      if (now - summary.emittedAt >= 750) {
        summary.emittedAt = now
        this.emit({ type: 'activity', id: `reasoning:${id}`, phase: 'reasoning', at: now, summary: summary.text })
      }
      this.reasoningSummaries.set(id, summary)
    }
    else if (message.method === 'item/commandExecution/outputDelta' && this.busy) {
      const id = text(params.itemId)
      const delta = text(params.delta)
      if (!id || !delta) return
      const previous = this.commandOutputs.get(id) ?? { text: '', emittedAt: 0 }
      const output = { text: (previous.text + delta).slice(-65_536), emittedAt: previous.emittedAt }
      const now = Date.now()
      if (now - output.emittedAt >= 750) {
        output.emittedAt = now
        this.emit({ type: 'tool', id, name: 'commandExecution', state: 'running', detail: '', output: output.text, turnId: text(params.turnId) })
      }
      this.commandOutputs.set(id, output)
    }
    else if (message.method === 'turn/plan/updated' && Array.isArray(params.plan)) {
      const turnId = text(params.turnId)
      this.emit({ type: 'plan', id: `plan:${turnId}`, turnId, explanation: text(params.explanation).slice(0, 12000), steps: params.plan.slice(0, 100).map(value => {
        const step = record(value)
        return { label: text(step.step).slice(0, 2000), status: step.status === 'completed' ? 'completed' as const : step.status === 'inProgress' ? 'inProgress' as const : 'pending' as const }
      }).filter(step => Boolean(step.label)) })
    }
    else if (message.method === 'turn/started') this.turnId = text(record(params.turn).id)
    else if (message.method === 'item/agentMessage/delta') {
      this.emit({ type: 'delta', id: text(params.itemId), text: text(params.delta) })
    } else if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = record(params.item)
      const id = text(item.id)
      if (item.type === 'reasoning' && id) {
        const summary = this.reasoningSummaries.get(id)?.text
        if (message.method === 'item/started') this.emit({ type: 'activity', id: `reasoning:${id}`, phase: 'reasoning', at: Date.now() })
        else if (summary) this.emit({ type: 'activity', id: `reasoning:${id}`, phase: 'reasoning', at: Date.now(), summary })
      } else if (item.type === 'agentMessage' && message.method === 'item/completed') {
        this.emit({ type: 'message', id, role: 'assistant', text: text(item.text) })
      } else if (item.type === 'collabAgentToolCall') {
        const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter(value => typeof value === 'string') as string[] : []
        const states = record(item.agentsStates)
        const agents = Object.entries(states).map(([threadId, value]) => {
          const state = record(value)
          const message = text(state.message).slice(0, 4000)
          return { threadId, status: subagentStatus(state.status), ...(message ? { message } : {}) }
        })
        for (const threadId of receivers) if (!agents.some(agent => agent.threadId === threadId)) agents.push({ threadId, status: message.method === 'item/started' ? 'running' : 'pending' })
        this.emit({ type: 'subagent', id, action: text(item.tool) || 'agent', state: collabState(item.status, message.method === 'item/started'),
          senderThreadId: text(item.senderThreadId) || undefined, receiverThreadIds: receivers, agents,
          prompt: text(item.prompt).slice(0, 16000) || undefined, model: text(item.model) || undefined, reasoningEffort: text(item.reasoningEffort) || undefined,
          turnId: text(params.turnId), ...(message.method === 'item/started' ? { startedAt: Date.now() } : { completedAt: Date.now() }) })
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'contextCompaction'].includes(text(item.type))) {
        const failed = item.status === 'failed' || item.status === 'declined' || item.success === false || typeof item.exitCode === 'number' && item.exitCode !== 0 || Boolean(item.error)
        this.emit({ type: 'tool', id, name: text(item.type),
          state: message.method === 'item/started' ? 'running' : failed ? 'failed' : 'completed',
          detail: (text(item.command) || [text(item.namespace), text(item.tool)].filter(Boolean).join('/') || text(record(item.error).message) || (Array.isArray(item.changes) ? item.changes.map(value => text(record(value).path)).join('\n') : '')).slice(0, 65536),
          output: (text(item.aggregatedOutput) || this.commandOutputs.get(id)?.text || dynamicToolOutput(item.contentItems)).slice(-65536), ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}), turnId: text(params.turnId),
          ...(item.type === 'fileChange' && Array.isArray(item.changes) ? { files: item.changes.slice(0, 100).map(value => {
            const change = record(value), kind = record(change.kind), move = text(kind.move_path)
            return { path: move || text(change.path), ...(move ? { previousPath: text(change.path) } : {}),
              kind: move ? 'rename' as const : kind.type === 'add' ? 'add' as const : kind.type === 'delete' ? 'delete' as const : 'update' as const,
              source: 'native-patch' as const, authorship: 'provider' as const, state: message.method === 'item/started' ? 'running' as const : failed ? 'failed' as const : 'completed' as const,
              ...(typeof change.diff === 'string' ? { patch: change.diff } : {}), ...(item.changes instanceof Array && item.changes.length > 100 ? { truncated: true } : {}) }
          }).filter(file => Boolean(file.path)) } : {}),
          ...(message.method === 'item/started' ? { startedAt: Date.now() } : { completedAt: Date.now() }) })
      }
    } else if (message.method === 'serverRequest/resolved') {
      const id = String(params.requestId)
      if (this.approvals.delete(id)) {
        this.emit({ type: 'request-resolved', id, state: 'resolved' })
        this.emit({ type: 'approval-resolved', id })
      }
    }
    else if (message.method === 'turn/completed') {
      const turn = record(params.turn)
      const status = turn.status
      if (this.turnId && turn.id && turn.id !== this.turnId) return
      if (status !== 'completed' && status !== 'interrupted') {
        this.fail(turn.error ? threadFailure(turn.error) : this.turnError ?? threadFailure({}))
        return
      }
      this.busy = false
      this.reasoningSummaries.clear()
      this.commandOutputs.clear()
      this.turnId = ''
      this.approvals.clear()
      this.emit({ type: 'completed', status })
    }
  }

  private hostRequest(message: AgentRpcMessage): void {
    if (message.id === undefined || !this.rpc) return
    const params = record(message.params)
    const method = message.method ?? ''
    if (method === 'currentTime/read') {
      this.rpc.respond(message.id, { currentTimeAt: Math.floor(Date.now() / 1000) })
      return
    }
    const legacyThread = params.conversationId
    const belongs = params.threadId === this.threadId || legacyThread === this.threadId
    if (method === 'item/tool/call' && belongs && this.busy) {
      const tool = text(params.tool) || 'dynamic tool'
      this.rpc.respond(message.id, { success: false, contentItems: [{ type: 'inputText', text: 'This dynamic host tool was not registered by OXESpace Thread.' }] })
      this.emit({ type: 'tool', id: text(params.callId) || `dynamic-tool:${message.id}`, name: tool, state: 'failed', detail: 'Provider requested an unregistered dynamic host tool.', output: 'The call was rejected without executing code.', completedAt: Date.now(), turnId: text(params.turnId) })
      return
    }
    const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval',
      'item/tool/requestUserInput', 'mcpServer/elicitation/request', 'applyPatchApproval', 'execCommandApproval'].includes(method)
    if (!belongs || !this.busy || (params.turnId !== undefined && this.turnId && params.turnId !== this.turnId) || !supported) {
      this.rpc.rejectRequest(message.id)
      return
    }
    const id = String(message.id)
    this.approvals.set(id, { rpcId: message.id, method, params })
    const request = this.toRequest(id, method, params)
    this.emit({ type: 'request', id, request })
    if (request.kind === 'approval') this.emit({ type: 'approval', id, title: request.title, detail: request.detail ?? '' })
  }

  private toRequest(id: string, method: string, params: Record<string, unknown>): ThreadRequest {
    const command = (text(params.command) || (Array.isArray(params.command) ? params.command.filter((value): value is string => typeof value === 'string').join(' ') : '')).slice(0, 12000)
    const reason = text(params.reason).slice(0, 2000)
    const detail = command || reason || text(params.message).slice(0, 12000)
    if (method === 'item/tool/requestUserInput') return {
      id, nativeId: id, nativeMethod: method, kind: 'question', title: 'Input required', detail, generation: 0, createdAt: Date.now(), state: 'pending',
      turnId: text(params.turnId), questions: (Array.isArray(params.questions) ? params.questions : []).slice(0, 20).map(value => {
        const question = record(value)
        return { id: text(question.id), header: text(question.header).slice(0, 80), question: text(question.question).slice(0, 2000), secret: question.isSecret === true,
          options: (Array.isArray(question.options) ? question.options : []).slice(0, 20).map(option => ({ label: text(record(option).label).slice(0, 200), description: text(record(option).description).slice(0, 500) })) }
      }).filter(question => Boolean(question.id && question.question)) }
    if (method === 'item/permissions/requestApproval') return { id, nativeId: id, nativeMethod: method, kind: 'permissions', title: 'Additional permissions', detail: detail || 'The agent requests additional access.', generation: 0, createdAt: Date.now(), state: 'pending', turnId: text(params.turnId), requestedPermissions: record(params.permissions) }
    if (method === 'mcpServer/elicitation/request') return { id, nativeId: id, nativeMethod: method, kind: 'elicitation', title: text(params.serverName) || 'MCP input required', detail, generation: 0, createdAt: Date.now(), state: 'pending', turnId: text(params.turnId), schema: record(params.requestedSchema), url: text(params.url) || undefined }
    type RequestDecision = NonNullable<ThreadRequest['availableDecisions']>[number]
    const available = (Array.isArray(params.availableDecisions) ? params.availableDecisions : []).filter((value): value is RequestDecision => typeof value === 'string' && ['accept', 'acceptForSession', 'decline', 'cancel'].includes(value))
    return { id, nativeId: id, nativeMethod: method, kind: 'approval', title: method.includes('file') || method === 'applyPatchApproval' ? 'Approve file changes' : 'Approve command', detail: detail || 'The agent requests your permission.', ...(command ? { command } : {}), ...(reason ? { reason } : {}), ...(text(params.cwd) ? { cwd: text(params.cwd).slice(0, 1000) } : {}), generation: 0, createdAt: Date.now(), state: 'pending', turnId: text(params.turnId), availableDecisions: available.length ? available : ['accept', 'decline'] }
  }
}
