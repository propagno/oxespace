import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AgentConversationAdapter, ConversationProtocolEvidence, ThreadAgentInput, ThreadAttachment, ThreadConfiguration, ThreadEvent, ThreadFailure, ThreadFileChange, ThreadModel, ThreadRequest, ThreadRequestResponse } from '../../../../shared/types/thread'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'
import { THREAD_PROMPT_MAX_CHARS } from '../../../../shared/threadLimits'
import type { ConversationTransport } from './codex-conversation'
import { AgentRpcPeer, type AgentRpcMessage } from './rpc-peer'
import { ReasoningStream } from './reasoning-stream'
import { ThreadAgentError, threadFailure } from './thread-failure'

// A completed tool call carries its whole output in one frame; keep a finite ceiling.
const MAX_ACP_FRAME_BYTES = 32 * 1024 * 1024
// The whole of what Antigravity says when its own run broke, with or without the warning sign in front.
const TERMINATED_BY_ERROR = /^[^\p{L}]*Agent execution terminated due to error\.?$/iu
// A turn is one `session/prompt` request that answers only when the turn ends, which can take hours.
const TURN_TIMEOUT_MS = 12 * 60 * 60 * 1000
const WRITE_KINDS = new Set(['edit', 'delete', 'move', 'execute'])
const FILE_KINDS = new Set(['edit', 'delete', 'move'])

/** An MCP server as ACP's `session/new` takes it: the environment is a list, not an object. */
export interface AntigravityMcpServer { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
type Access = NonNullable<ThreadConfiguration['access']>
type NativeMode = 'default' | 'accept-edits' | 'auto' | 'plan'
interface ToolCall { id: string; title: string; kind: string; status: string; paths: string[]; command: string; output: string; diffs: { path: string; added: boolean }[]; startedAt: number }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function amount(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 ? value : undefined }

/** Launch flags of `agy acp`: sandboxed unless the conversation has full access; nothing is auto-approved unless it also never asks. */
export function antigravityLaunchArgs(configuration: Pick<ThreadConfiguration, 'access' | 'approvalPolicy'>): string[] {
  const full = configuration.access === 'full-access'
  return ['acp', ...(full ? [] : ['--sandbox']), ...(full && configuration.approvalPolicy === 'never' ? ['--dangerously-skip-permissions'] : [])]
}

/** The native session mode a conversation's configuration maps to. */
export function antigravityMode(configuration: Pick<ThreadConfiguration, 'access' | 'approvalPolicy' | 'mode'>): NativeMode {
  if (configuration.mode === 'plan') return 'plan'
  if (configuration.mode === 'acceptEdits') return 'accept-edits'
  return configuration.approvalPolicy === 'never' && configuration.access === 'full-access' ? 'auto' : 'default'
}

/**
 * `gemini-4-carbon-low|medium|high` are one model with three reasoning levels. A name with a single level
 * (`gpt-oss-120b-medium`) is that model's own id and is kept whole.
 */
export function antigravityModels(entries: { id: string; label: string }[]): ThreadModel[] {
  const valid = entries.filter(entry => /^[a-z0-9][a-z0-9._:/-]*$/i.test(entry.id))
  const split = (id: string): RegExpExecArray | null => /^(.+)-(low|medium|high)$/.exec(id)
  const levels = new Map<string, Set<string>>()
  for (const entry of valid) {
    const match = split(entry.id)
    if (match) levels.set(match[1], (levels.get(match[1]) ?? new Set<string>()).add(match[2]))
  }
  const models = new Map<string, ThreadModel>()
  for (const entry of valid) {
    const match = split(entry.id)
    const grouped = match && (levels.get(match[1])?.size ?? 0) > 1 ? match : null
    const id = grouped ? grouped[1] : entry.id
    if (models.has(id)) continue
    const efforts = grouped ? ['low', 'medium', 'high'].filter(level => levels.get(id)!.has(level)) : []
    const label = (grouped ? entry.label.replace(/\s*\((?:low|medium|high)\)\s*$/i, '') : entry.label).slice(0, 120) || id
    models.set(id, { id, label, description: '', efforts, ...(efforts.length ? { defaultEffort: efforts.includes('medium') ? 'medium' : efforts[0] } : {}) })
  }
  return [...models.values()].slice(0, 100)
}

/** The lines of `agy models`: `<id>\t<name>`; anything else (its progress line) is skipped. */
export function parseAntigravityModels(output: string): ThreadModel[] {
  return antigravityModels(output.split(/\r?\n/).flatMap(line => {
    const [id, label, extra] = line.split('\t')
    return id && label && extra === undefined ? [{ id: id.trim(), label: label.trim() }] : []
  }))
}

/** Used when `agy models` cannot run: the names it listed when this adapter was verified (agy 1.5.5). */
export const ANTIGRAVITY_FALLBACK_MODELS: ThreadModel[] = antigravityModels([
  ...[['gemini-4-carbon', 'Gemini 4 Carbon'], ['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['claude-opus-5-5', 'Claude Opus 5.5'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5']]
    .flatMap(([id, label]) => ['low', 'medium', 'high'].map(level => ({ id: `${id}-${level}`, label: `${label} (${level[0].toUpperCase()}${level.slice(1)})` }))),
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' }
])

/** Antigravity's Agent Client Protocol (v1, JSON-RPC 2.0 over stdio) through `agy acp`. */
export class AntigravityConversationAdapter implements AgentConversationAdapter {
  readonly capabilities = { resume: true, approvals: true, attachments: true, modelSelection: true, questions: false, permissions: false, elicitation: false, queue: false, steering: false, nativeSessions: true, rewind: false }
  readonly evidence: ConversationProtocolEvidence = { transport: 'antigravity-acp-jsonrpc', verified: 'fixture' }
  private connection: { transport: ConversationTransport; rpc: AgentRpcPeer; args: string } | null = null
  private sessionId = ''
  private rootPath = ''
  private access: Access = 'read-only'
  private approvalPolicy: NonNullable<ThreadConfiguration['approvalPolicy']> = 'on-request'
  private mode: ThreadConfiguration['mode'] = 'default'
  private nativeMode = ''
  private model = ''
  private effort = ''
  private models: ThreadModel[] = []
  private busy = false
  private disposed = false
  /** Set while `session/load` replays the saved history as updates, which the conversation already has. */
  private replaying = false
  /** A local id per `session/prompt`; ACP has no turn id, and a late answer must not end a newer turn. */
  private turn = ''
  private lastNativeSignalAt = 0
  private segment: { kind: 'message' | 'thought'; id: string; text: string } | null = null
  private readonly tools = new Map<string, ToolCall>()
  private readonly approvals = new Map<string, { rpcId: string | number; options: { id: string; kind: string }[] }>()
  private emit: (event: ThreadEvent) => void = () => {}
  private readonly reasoning = new ReasoningStream(event => this.emit(event))

  get closed(): boolean { return this.disposed }

  /** `mcpServers` are attached when the session opens: `agy acp` takes them in `session/new`, not on the command line. */
  constructor(private readonly createTransport: (args: string[], cwd: string) => ConversationTransport,
    private readonly options: { mcpServers?: (access: Access) => AntigravityMcpServer[]; readImage?: (path: string) => Promise<Buffer> } = {}) {}

  async start(context: { rootPath: string; nativeSessionId: string | null } & ThreadConfiguration, emit: (event: ThreadEvent) => void): Promise<void> {
    if (this.connection || this.disposed) throw new Error('Conversation adapter cannot be started twice')
    this.emit = emit
    this.rootPath = context.rootPath
    this.access = context.access ?? 'read-only'
    this.approvalPolicy = context.approvalPolicy ?? 'on-request'
    this.mode = context.mode ?? 'default'
    this.model = context.model ?? ''
    this.effort = context.reasoningEffort ?? ''
    try {
      await this.connect(context.nativeSessionId)
      emit({ type: 'session', nativeSessionId: this.sessionId })
      this.emitConfiguration()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  private emitConfiguration(): void {
    this.emit({ type: 'configuration', model: this.model || undefined, reasoningEffort: this.effort || undefined, access: this.access, networkAccess: false, approvalPolicy: this.approvalPolicy, confirmed: true })
  }

  /** Starts `agy acp` with the flags of the current access level, then opens or resumes the session. */
  private async connect(nativeSessionId: string | null): Promise<void> {
    const args = antigravityLaunchArgs({ access: this.access, approvalPolicy: this.approvalPolicy })
    const transport = this.createTransport(args, this.rootPath)
    const rpc = new AgentRpcPeer(line => transport.write(line), message => this.notification(message), message => this.hostRequest(message), 30_000, MAX_ACP_FRAME_BYTES)
    const connection = this.connection = { transport, rpc, args: args.join(' ') }
    transport.onData(chunk => {
      try { rpc.push(chunk) } catch {
        if (this.connection !== connection) return
        this.fail('Invalid agent protocol stream')
        void this.dispose()
      }
    })
    transport.onClose(() => {
      rpc.close()
      // A relaunch for new access flags closes the old process on purpose.
      if (this.connection !== connection) return
      if (!this.disposed && this.busy) this.fail('Agent connection closed during the turn')
      void this.dispose()
    })
    const handshake = record(await this.request(rpc, 'initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }))
    const agent = record(handshake.agentInfo)
    if (text(agent.version)) this.evidence.providerVersion = text(agent.version).slice(0, 120)
    if (handshake.protocolVersion !== undefined) this.evidence.protocolVersion = String(handshake.protocolVersion).slice(0, 80)
    this.evidence.verified = 'native'
    const mcpServers = this.options.mcpServers?.(this.access) ?? []
    let session: Record<string, unknown>
    if (!nativeSessionId) session = record(await this.request(rpc, 'session/new', { cwd: this.rootPath, mcpServers }))
    else {
      try { session = record(await this.request(rpc, 'session/resume', { sessionId: nativeSessionId, cwd: this.rootPath, mcpServers })) }
      catch (error) {
        if (!/method not found|not supported|unsupported|unknown method/i.test(errorText(error))) throw error
        // An older server only loads: it replays the history, which is dropped here.
        this.replaying = true
        try { session = record(await this.request(rpc, 'session/load', { sessionId: nativeSessionId, cwd: this.rootPath, mcpServers })) }
        finally { this.replaying = false }
      }
    }
    this.sessionId = text(session.sessionId) || nativeSessionId || ''
    if (!this.sessionId) throw new Error('Agent did not return a conversation identifier')
    const available = list(record(session.models).availableModels).map(value => ({ id: text(record(value).modelId), label: text(record(value).name) }))
    if (available.length) this.models = antigravityModels(available)
    this.nativeMode = text(record(session.modes).currentModeId)
    if (this.model) await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: this.model })
    // A model without reasoning levels refuses the option; the conversation then reports no effort.
    if (this.effort) await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'thought_level', value: this.effort }).catch(() => { this.effort = '' })
    await this.applyMode(rpc)
  }

  private async applyMode(rpc: AgentRpcPeer): Promise<void> {
    const wanted = antigravityMode({ access: this.access, approvalPolicy: this.approvalPolicy, mode: this.mode })
    if (wanted === this.nativeMode) return
    await this.request(rpc, 'session/set_mode', { sessionId: this.sessionId, modeId: wanted })
    this.nativeMode = wanted
  }

  /** A request whose refusal for a missing sign-in reads as an authentication failure, whatever words the server used. */
  private async request(rpc: AgentRpcPeer, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    try { return await rpc.request(method, params, timeoutMs) }
    catch (error) {
      const detail = errorText(error)
      if (/auth(?:entication|orization)? ?(?:is )?required|auth_required|not (?:logged|signed) in|log ?in (?:first|required)|unauthenticated/i.test(detail)) throw new ThreadAgentError(threadFailure({ message: detail, httpStatusCode: 401 }))
      throw error
    }
  }

  async send(input: string, skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Promise<void> {
    const rpc = this.connection?.rpc
    if (!rpc || !this.sessionId || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('A conversation turn is already running')
    if (!input.trim() || input.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    this.busy = true
    this.reset()
    const turn = this.turn = randomUUID()
    try {
      if (!skill && await this.slashCommand(rpc, input)) return
      const prompt = [{ type: 'text', text: input }, ...await Promise.all(attachments.map(async attachment => {
        if (!attachment.path) throw Error('Attachment is unavailable')
        return { type: 'image', mimeType: attachment.mimeType, data: (await (this.options.readImage ?? readFile)(attachment.path)).toString('base64') }
      }))]
      // Answered when the turn ends; everything in between arrives as `session/update`.
      void this.request(rpc, 'session/prompt', { sessionId: this.sessionId, prompt }, TURN_TIMEOUT_MS).then(result => this.finish(turn, record(result)), error => {
        if (this.turn !== turn) return
        this.fail(error instanceof ThreadAgentError ? error.failure : threadFailure({ message: errorText(error) }))
      })
    } catch (error) {
      const failure = error instanceof ThreadAgentError ? error.failure : threadFailure({ message: errorText(error) })
      this.fail(failure)
      throw new ThreadAgentError(failure)
    }
  }

  private reply(message: string): void {
    this.busy = false
    this.turn = ''
    this.emit({ type: 'message', id: randomUUID(), role: 'assistant', text: message })
    this.emit({ type: 'completed', status: 'completed' })
  }

  /** `/model` and `/status` answer from the session itself; nothing is sent to the model. */
  private async slashCommand(rpc: AgentRpcPeer, input: string): Promise<boolean> {
    const match = input.trim().match(/^\/(model|status)(?:\s+([\s\S]*))?$/)
    if (!match) return false
    if (match[1] === 'status') {
      this.reply(`**Model:** ${this.model || 'Native default'}\n\n**Reasoning effort:** ${this.effort || 'Native default'}\n\n**Directory:** ${this.rootPath}\n\n**Sandbox:** ${this.access}\n\n**Approvals:** ${this.approvalPolicy}\n\n**Mode:** ${this.nativeMode || 'default'}\n\n**Native session:** ${this.sessionId}`)
      return true
    }
    if (!match[2]?.trim()) {
      this.busy = false
      this.turn = ''
      this.emit({ type: 'model-picker', id: randomUUID(), selectedModel: this.model, selectedEffort: this.effort, models: this.models })
      this.emit({ type: 'completed', status: 'completed' })
      return true
    }
    const [name, effort, extra] = match[2].trim().split(/\s+/)
    const model = this.models.find(entry => entry.id === name)
    if (!model || extra) { this.reply('Model unavailable. Use `/model` to see the native model catalog.'); return true }
    if (effort && !model.efforts.includes(effort)) { this.reply(`Unsupported reasoning effort. Available: ${model.efforts.join(', ') || 'native default'}.`); return true }
    await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: model.id })
    const chosen = effort || model.defaultEffort || ''
    if (chosen) await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'thought_level', value: chosen })
    this.model = model.id
    this.effort = chosen
    this.emit({ type: 'configuration', model: this.model, reasoningEffort: this.effort || undefined })
    this.reply(`Model set to **${this.model}**${this.effort ? ` with **${this.effort}** reasoning effort` : ''}.`)
    return true
  }

  private finish(turn: string, result: Record<string, unknown>): void {
    if (this.turn !== turn || this.disposed) return
    const usage = record(result.usage)
    const cost = { inputTokens: amount(usage.inputTokens), outputTokens: amount(usage.outputTokens), cacheReadTokens: amount(usage.cachedReadTokens), cacheCreationTokens: amount(usage.cachedWriteTokens) }
    const reason = text(result.stopReason)
    if (reason !== 'end_turn' && reason !== 'cancelled') {
      // The words below are OXESpace's; the provider's own reason travels as the provider code.
      const failure = threadFailure({ message: reason === 'max_tokens' ? 'The model stopped at its token limit; the context window is full.'
        : reason === 'refusal' ? 'The model refused to continue this turn.' : reason === 'max_turn_requests' ? 'The turn reached its limit of model requests.' : 'The agent ended the turn without a known reason.' })
      this.fail({ ...failure, ...(/^[a-z_]{1,40}$/.test(reason) ? { providerCode: reason } : {}), usageUnavailable: true }, cost)
      return
    }
    // Antigravity reports a run of its own that broke as an ordinary answer, "⚠ Agent execution terminated due to
    // error.", and then ends the turn as finished (measured with a real account, 2026-11-12). A turn whose last
    // words are only that did not finish: it fails, and the sentence stays in the conversation as the agent's.
    if (reason === 'end_turn' && this.segment?.kind === 'message' && TERMINATED_BY_ERROR.test(this.segment.text.trim())) {
      this.fail({ ...threadFailure({ message: 'Antigravity stopped its own run with an error and gave no reason.' }), providerCode: 'agent_execution_terminated', usageUnavailable: true }, cost)
      return
    }
    this.settle()
    if (Object.values(cost).some(value => value !== undefined)) this.emit({ type: 'turn-cost', ...cost })
    this.emit({ type: 'completed', status: reason === 'cancelled' ? 'interrupted' : 'completed' })
  }

  /** Closes the open message and thought, and ends the turn's local state. */
  private settle(): void {
    this.closeSegment()
    this.reasoning.completeAll()
    this.busy = false
    this.turn = ''
    this.tools.clear()
    // Requests the turn left open get no answer any more; the provider drops them with the turn.
    this.approvals.clear()
  }

  private reset(): void {
    this.segment = null
    this.reasoning.completeAll()
    this.tools.clear()
  }

  private fail(error: string | ThreadFailure, cost?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number }): void {
    if (!this.busy || this.disposed) return
    const failure = typeof error === 'string' ? { ...threadFailure({ message: error }), usageUnavailable: true } : error
    this.settle()
    if (cost && Object.values(cost).some(value => value !== undefined)) this.emit({ type: 'turn-cost', ...cost })
    this.emit({ type: 'completed', status: 'failed', error: failure.message, errorCode: failure.code, failure })
  }

  async interrupt(): Promise<void> {
    const rpc = this.connection?.rpc
    if (!this.busy || !rpc) return
    // The protocol asks the client to cancel what it was asked before the turn answers `cancelled`.
    for (const [id, pending] of [...this.approvals]) {
      this.approvals.delete(id)
      rpc.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } })
      this.emit({ type: 'request-resolved', id, state: 'cancelled', resolution: 'interrupted', resolvedAt: Date.now() })
      this.emit({ type: 'approval-resolved', id })
    }
    rpc.notify('session/cancel', { sessionId: this.sessionId })
  }

  async configure(configuration: ThreadConfiguration): Promise<void> {
    const current = this.connection
    if (!current || this.busy || this.disposed) throw Error('Finish the active turn before applying configuration')
    this.access = configuration.access ?? this.access
    this.approvalPolicy = configuration.approvalPolicy ?? this.approvalPolicy
    this.mode = configuration.mode ?? this.mode
    if (configuration.model) this.model = configuration.model
    this.effort = configuration.reasoningEffort ?? ''
    if (antigravityLaunchArgs({ access: this.access, approvalPolicy: this.approvalPolicy }).join(' ') !== current.args) {
      // The sandbox is a launch flag: the process is replaced and the same session resumed in it.
      this.connection = null
      current.rpc.close()
      await current.transport.close()
      try { await this.connect(this.sessionId) } catch (error) { await this.dispose(); throw error }
    } else {
      if (configuration.model) await this.request(current.rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: this.model })
      if (this.effort) await this.request(current.rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'thought_level', value: this.effort })
      await this.applyMode(current.rpc)
    }
    this.emitConfiguration()
  }

  async approve(requestId: string, decision: 'accept' | 'decline'): Promise<void> {
    await this.respondRequest(requestId, { decision })
  }

  async respondRequest(requestId: string, response: ThreadRequestResponse): Promise<void> {
    const pending = this.approvals.get(requestId), rpc = this.connection?.rpc
    if (!pending || !rpc || this.disposed) throw new Error('Request is no longer pending')
    const decision = response.decision ?? 'decline'
    const option = (...kinds: string[]): string | undefined => kinds.map(kind => pending.options.find(entry => entry.kind === kind)?.id).find(Boolean)
    const optionId = decision === 'accept' ? option('allow_once') : decision === 'acceptForSession' ? option('allow_always') : decision === 'decline' ? option('reject_once', 'reject_always') : undefined
    // An approval is never widened: without the exact option the provider offered, the answer is refused.
    if (!optionId && (decision === 'accept' || decision === 'acceptForSession')) throw new Error('The agent did not offer that answer for this request')
    rpc.respond(pending.rpcId, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
    this.approvals.delete(requestId)
    this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome('approval', response), resolvedAt: Date.now() })
    this.emit({ type: 'approval-resolved', id: requestId })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.emit({ type: 'connection-closed', at: Date.now() })
    this.approvals.clear()
    this.reasoning.completeAll()
    this.tools.clear()
    const connection = this.connection
    connection?.rpc.close()
    await connection?.transport.close()
  }

  private notification(message: AgentRpcMessage): void {
    if (this.disposed || this.replaying || message.method !== 'session/update') return
    const params = record(message.params), update = record(params.update)
    if (params.sessionId !== this.sessionId) return
    const kind = text(update.sessionUpdate)
    if (kind === 'usage_update') {
      const used = amount(update.used), size = amount(update.size)
      if (used !== undefined && size) this.emit({ type: 'context-usage', report: { ...(this.model ? { model: this.model } : {}), usedTokens: used, windowTokens: size, percentage: Math.min(100, Math.round(used / size * 100)), categories: [], capturedAt: Date.now(), source: 'antigravity-usage' } })
      return
    }
    if (!this.busy) return
    if (Date.now() - this.lastNativeSignalAt >= 2_000) {
      this.lastNativeSignalAt = Date.now()
      this.emit({ type: 'native-signal', at: this.lastNativeSignalAt })
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const delta = text(record(update.content).text)
      if (!delta) return
      const wanted = kind === 'agent_message_chunk' ? 'message' as const : 'thought' as const
      if (this.segment?.kind !== wanted) {
        this.closeSegment()
        this.segment = { kind: wanted, id: `${wanted === 'message' ? 'agy-message' : 'reasoning'}:${randomUUID()}`, text: '' }
        if (wanted === 'thought') {
          this.reasoning.begin(this.segment.id)
          this.emit({ type: 'activity', id: this.segment.id, phase: 'reasoning', at: Date.now() })
        }
      }
      this.segment.text += delta
      if (wanted === 'message') this.emit({ type: 'delta', id: this.segment.id, text: delta })
      else this.reasoning.append(this.segment.id, delta)
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      this.closeSegment()
      const call = this.mergeTool(update)
      if (call) this.emit(this.toolEvent(call))
    } else if (kind === 'plan') {
      this.emit({ type: 'plan', id: `plan:${this.turn}`, turnId: this.turn, steps: list(update.entries).slice(0, 100).map(value => {
        const entry = record(value)
        return { label: text(entry.content).slice(0, 2000), status: entry.status === 'completed' ? 'completed' as const : entry.status === 'in_progress' ? 'inProgress' as const : 'pending' as const }
      }).filter(step => Boolean(step.label)) })
    }
  }

  /** A message is saved whole when something else starts; a thought is closed the same way. */
  private closeSegment(): void {
    const segment = this.segment
    this.segment = null
    if (!segment) return
    if (segment.kind === 'thought') this.reasoning.complete(segment.id)
    else if (segment.text.trim()) this.emit({ type: 'message', id: segment.id, role: 'assistant', text: segment.text })
  }

  /** `tool_call` opens a call and `tool_call_update` sends only what changed, so the call is kept and merged. */
  private mergeTool(update: Record<string, unknown>): ToolCall | null {
    const id = text(update.toolCallId)
    if (!id) return null
    if (!this.tools.has(id) && this.tools.size >= 500) return null
    const call = this.tools.get(id) ?? { id, title: '', kind: 'other', status: 'pending', paths: [], command: '', output: '', diffs: [], startedAt: Date.now() }
    if (text(update.title)) call.title = text(update.title).slice(0, 2000)
    if (text(update.kind)) call.kind = text(update.kind)
    if (text(update.status)) call.status = text(update.status)
    const input = record(update.rawInput)
    const command = commandText(input)
    if (command) call.command = command
    const paths = [...list(update.locations).map(value => text(record(value).path)), text(input.path), text(input.file_path), text(input.filePath)].filter(Boolean)
    if (paths.length) call.paths = [...new Set([...call.paths, ...paths])].slice(0, 100).map(path => path.slice(0, 1000))
    const parts: string[] = []
    for (const value of list(update.content)) {
      const item = record(value)
      if (item.type === 'content') parts.push(text(record(item.content).text))
      else if (item.type === 'diff' && text(item.path)) {
        const path = text(item.path).slice(0, 1000)
        if (!call.diffs.some(diff => diff.path === path) && call.diffs.length < 100) call.diffs.push({ path, added: item.oldText === null || item.oldText === undefined })
      }
    }
    const raw = update.rawOutput
    const output = parts.filter(Boolean).join('\n') || (typeof raw === 'string' ? raw : text(record(raw).output) || text(record(raw).stdout) || text(record(raw).text))
    if (output) call.output = output.slice(-65_536)
    this.tools.set(id, call)
    return call
  }

  private toolEvent(call: ToolCall): ThreadEvent {
    const state = call.status === 'completed' ? 'completed' as const : call.status === 'failed' ? 'failed' as const : 'running' as const
    const file = FILE_KINDS.has(call.kind)
    const paths = [...new Set([...call.diffs.map(diff => diff.path), ...call.paths])]
    const files: ThreadFileChange[] = file ? paths.slice(0, 100).map(path => ({ path, kind: call.kind === 'delete' ? 'delete' as const : call.kind === 'move' ? 'rename' as const : call.diffs.some(diff => diff.path === path && diff.added) ? 'add' as const : 'update' as const,
      source: 'tool-input' as const, authorship: 'indeterminate' as const, state })) : []
    const name = call.kind === 'execute' ? 'commandExecution' : file ? 'fileChange' : call.kind === 'read' ? 'Read' : call.kind === 'search' ? 'Grep' : call.title.slice(0, 80) || call.kind
    return { type: 'tool', id: call.id, name, state, detail: (call.kind === 'execute' ? call.command || call.title : file ? paths.join('\n') || call.title : call.title || paths.join('\n')).slice(0, 65_536),
      ...(call.output ? { output: call.output } : {}), turnId: this.turn, ...(files.length ? { files } : {}),
      ...(state === 'running' ? { startedAt: call.startedAt } : { startedAt: call.startedAt, completedAt: Date.now() }) }
  }

  private hostRequest(message: AgentRpcMessage): void {
    const rpc = this.connection?.rpc
    if (message.id === undefined || !rpc) return
    const params = record(message.params)
    if (message.method !== 'session/request_permission' || params.sessionId !== this.sessionId || !this.busy || this.replaying) {
      rpc.rejectRequest(message.id)
      return
    }
    const call = record(params.toolCall)
    const options = list(params.options).map(value => ({ id: text(record(value).optionId), kind: text(record(value).kind) })).filter(option => option.id && option.kind).slice(0, 20)
    const known = this.tools.get(text(call.toolCallId))
    const kind = text(call.kind) || known?.kind || 'other'
    if (this.access === 'read-only' && WRITE_KINDS.has(kind)) {
      // A read-only conversation never asks a person to approve a write: it is declined here.
      const reject = options.find(option => option.kind === 'reject_once') ?? options.find(option => option.kind === 'reject_always')
      rpc.respond(message.id, { outcome: reject ? { outcome: 'selected', optionId: reject.id } : { outcome: 'cancelled' } })
      return
    }
    this.closeSegment()
    const id = String(message.id)
    this.approvals.set(id, { rpcId: message.id, options })
    const request = this.toRequest(id, call, kind, options, known)
    this.emit({ type: 'request', id, request })
    this.emit({ type: 'approval', id, title: request.title, detail: request.detail ?? '' })
  }

  private toRequest(id: string, call: Record<string, unknown>, kind: string, options: { id: string; kind: string }[], known?: ToolCall): ThreadRequest {
    const input = record(call.rawInput)
    const command = kind === 'execute' ? (commandText(input) || known?.command || '').slice(0, 12_000) : ''
    const paths = [...new Set([...list(call.locations).map(value => text(record(value).path)), text(input.path), text(input.file_path), text(input.filePath), ...(known?.paths ?? [])].filter(Boolean))].slice(0, 100).map(path => path.slice(0, 1000))
    const file = FILE_KINDS.has(kind)
    const title = text(call.title).slice(0, 2000) || known?.title || ''
    const cwd = text(input.cwd) || text(input.workdir)
    return { id, nativeId: text(call.toolCallId) || id, nativeMethod: 'session/request_permission', kind: 'approval',
      toolName: kind === 'execute' ? 'command' : file ? 'fileChange' : (title.slice(0, 80) || kind),
      title: kind === 'execute' ? 'Approve command' : file ? 'Approve file changes' : 'Approve tool use',
      detail: command || (file ? paths.join('\n') : '') || title || 'The agent requests your permission.',
      ...(command ? { command } : {}), ...(file && paths.length ? { paths } : {}), ...(cwd ? { cwd: cwd.slice(0, 1000) } : {}),
      generation: 0, createdAt: Date.now(), state: 'pending', turnId: this.turn,
      availableDecisions: [...(options.some(option => option.kind === 'allow_once') ? ['accept' as const] : []), ...(options.some(option => option.kind === 'allow_always') ? ['acceptForSession' as const] : []), 'decline' as const] }
  }
}

function errorText(error: unknown): string {
  return [error instanceof Error ? error.message : String(error), error instanceof ThreadAgentError ? error.failure.detail ?? '' : ''].filter(Boolean).join(' ')
}

/** The shell line of an `execute` call: a string, or an argv list. */
function commandText(input: Record<string, unknown>): string {
  const value = input.command ?? input.cmd
  const head = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const args = Array.isArray(input.args) ? input.args : []
  return [...head, ...args].filter((part): part is string => typeof part === 'string').join(' ').slice(0, 12_000)
}
