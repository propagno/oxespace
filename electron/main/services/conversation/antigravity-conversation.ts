import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type {
  AgentConversationAdapter,
  ConversationProtocolEvidence,
  ThreadAgentInput,
  ThreadAttachment,
  ThreadConfiguration,
  ThreadEvent,
  ThreadFailure,
  ThreadFileChange,
  ThreadModel,
  ThreadPermissionRule,
  ThreadQueuedInput,
  ThreadRequest,
  ThreadRequestQuestion,
  ThreadRequestResponse
} from '../../../../shared/types/thread'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'
import { THREAD_PROMPT_MAX_CHARS } from '../../../../shared/threadLimits'
import type { ConversationTransport } from './codex-conversation'
import { AgentRpcPeer, type AgentRpcMessage } from './rpc-peer'
import { ReasoningStream } from './reasoning-stream'
import { ThreadAgentError, threadFailure } from './thread-failure'
import {
  ANTIGRAVITY_FILE_KINDS,
  deriveAntigravityPersistRules,
  detectAntigravityBackgroundHoldMs,
  evaluateAntigravityPermission,
  extractAntigravityQuestions,
  resolveAntigravityMode,
  type AntigravityAccess,
  type AntigravityModeConfiguration,
  type AntigravityPermissionOption,
  type AntigravityPermissionStore
} from './antigravity-acp-policy'

// A completed tool call carries its whole output in one frame; keep a finite ceiling.
const MAX_ACP_FRAME_BYTES = 32 * 1024 * 1024
// The whole of what Antigravity says when its own run broke, with or without the warning sign in front.
const TERMINATED_BY_ERROR = /^[^\p{L}]*Agent execution terminated due to error\.?$/iu
// A turn is one `session/prompt` request that answers only when the turn ends, which can take hours.
const TURN_TIMEOUT_MS = 12 * 60 * 60 * 1000
const REACTIVE_IDLE_SETTLE_MS = 1_500
const STEER_CANCEL_GRACE_MS = 1_500
const MAX_QUEUED_ITEMS = 100
const REACTIVE_END_UPDATES = new Set(['turn_completed', 'turn_end', 'agent_turn_end', 'turn_finished'])
const METADATA_UPDATES = new Set(['available_commands_update', 'config_option_update'])

/** An MCP server as ACP's `session/new` takes it: the environment is a list, not an object. */
export interface AntigravityMcpServer { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
export interface AntigravityAdapterOptions {
  mcpServers?: (access: AntigravityAccess) => AntigravityMcpServer[]
  readImage?: (path: string) => Promise<Buffer>
  permissions?: AntigravityPermissionStore
  reactiveIdleMs?: number
  steerCancelGraceMs?: number
}

interface ToolCall { id: string; title: string; kind: string; status: string; paths: string[]; command: string; output: string; diffs: { path: string; added: boolean }[]; startedAt: number }
interface PendingRequest {
  rpcId: string | number
  method: string
  kind: 'approval' | 'question'
  options: AntigravityPermissionOption[]
  request: ThreadRequest
  guarded: boolean
  questions?: ThreadRequestQuestion[]
}
interface QueuedPrompt { nativeId: string; text: string; attachments: ThreadAttachment[] }

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

/** The native session mode a conversation's configuration maps to, optionally matched against advertised ACP `availableModes`. */
export function antigravityMode(configuration: AntigravityModeConfiguration, availableModes?: readonly string[]): string {
  return resolveAntigravityMode(configuration, availableModes)
}

export { resolveAntigravityMode }

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
  readonly capabilities = {
    resume: true,
    approvals: true,
    attachments: true,
    modelSelection: true,
    questions: true,
    permissions: true,
    elicitation: false,
    queue: true,
    steering: true,
    nativeSessions: true
  }
  readonly evidence: ConversationProtocolEvidence = { transport: 'antigravity-acp-jsonrpc', verified: 'fixture' }
  private connection: { transport: ConversationTransport; rpc: AgentRpcPeer; args: string } | null = null
  private sessionId = ''
  private rootPath = ''
  private access: AntigravityAccess = 'read-only'
  private approvalPolicy: NonNullable<ThreadConfiguration['approvalPolicy']> = 'on-request'
  private mode: ThreadConfiguration['mode'] = 'default'
  private nativeMode = ''
  private availableModes: string[] = []
  private supportsNativeSteer = false
  private model = ''
  private effort = ''
  private models: ThreadModel[] = []
  private busy = false
  private reactiveTurn = false
  private steering = false
  private disposed = false
  /** Set while `session/load` replays the saved history as updates, which the conversation already has. */
  private replaying = false
  /** A local id per turn; ACP has no turn id, and a late answer must not end a newer turn. */
  private turn = ''
  private promptDone: Promise<void> | null = null
  private reactiveTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBackgroundUntil = 0
  private scheduledDuringTurn = false
  private lastNativeSignalAt = 0
  private segment: { kind: 'message' | 'thought'; id: string; text: string } | null = null
  private readonly tools = new Map<string, ToolCall>()
  private readonly approvals = new Map<string, PendingRequest>()
  private readonly queued: QueuedPrompt[] = []
  private readonly sessionRules: ThreadPermissionRule[] = []
  private readonly sessionTools = new Set<string>()
  private emit: (event: ThreadEvent) => void = () => {}
  private readonly reasoning = new ReasoningStream(event => this.emit(event))

  get closed(): boolean { return this.disposed }

  /** True while a reactive wakeup turn runs or a scheduled timer / async subagent wakeup is still pending. */
  hasPendingBackground(now = Date.now()): boolean {
    if (this.disposed) return false
    return this.reactiveTurn || now < this.pendingBackgroundUntil
  }

  /** `mcpServers` are attached when the session opens: `agy acp` takes them in `session/new`, not on the command line. */
  constructor(
    private readonly createTransport: (args: string[], cwd: string) => ConversationTransport,
    private readonly options: AntigravityAdapterOptions = {}
  ) {}

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
    const agentCaps = record(handshake.agentCapabilities)
    this.supportsNativeSteer = agentCaps.steer === true || record(agentCaps.promptCapabilities).steer === true
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
    const modesInfo = record(session.modes)
    this.nativeMode = text(modesInfo.currentModeId)
    this.availableModes = list(modesInfo.availableModes).map(value => text(record(value).id)).filter(Boolean)
    if (this.model) await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: this.model })
    // A model without reasoning levels refuses the option; the conversation then reports no effort.
    if (this.effort) await this.request(rpc, 'session/set_config_option', { sessionId: this.sessionId, configId: 'thought_level', value: this.effort }).catch(() => { this.effort = '' })
    await this.applyMode(rpc)
  }

  private async applyMode(rpc: AgentRpcPeer): Promise<void> {
    const wanted = resolveAntigravityMode({ access: this.access, approvalPolicy: this.approvalPolicy, mode: this.mode }, this.availableModes)
    if (!wanted || wanted === this.nativeMode) return
    try {
      await this.request(rpc, 'session/set_mode', { sessionId: this.sessionId, modeId: wanted })
      this.nativeMode = wanted
    } catch (error) {
      if (this.availableModes.length > 0 || !/method not found|not supported|unsupported|unknown mode|invalid mode/i.test(errorText(error))) {
        throw error
      }
    }
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

  private async buildPrompt(input: string, attachments: ThreadAttachment[] = []): Promise<Record<string, unknown>[]> {
    return [{ type: 'text', text: input }, ...await Promise.all(attachments.map(async attachment => {
      if (!attachment.path) throw Error('Attachment is unavailable')
      return { type: 'image', mimeType: attachment.mimeType, data: (await (this.options.readImage ?? readFile)(attachment.path)).toString('base64') }
    }))]
  }

  private dispatchPrompt(rpc: AgentRpcPeer, turn: string, prompt: Record<string, unknown>[]): void {
    let resolveDone!: () => void
    const settled = new Promise<void>(resolve => { resolveDone = resolve })
    this.promptDone = settled
    // Answered when the turn ends; everything in between arrives as `session/update`.
    void this.request(rpc, 'session/prompt', { sessionId: this.sessionId, prompt }, TURN_TIMEOUT_MS).then(result => {
      resolveDone()
      if (this.promptDone === settled) this.promptDone = null
      this.finish(turn, record(result))
    }, error => {
      resolveDone()
      if (this.promptDone === settled) this.promptDone = null
      if (this.turn !== turn) return
      this.fail(error instanceof ThreadAgentError ? error.failure : threadFailure({ message: errorText(error) }))
    })
  }

  async send(input: string, skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Promise<void> {
    const rpc = this.connection?.rpc
    if (!rpc || !this.sessionId || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('A conversation turn is already running')
    if (!input.trim() || input.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    this.clearReactiveTimer()
    this.busy = true
    this.reactiveTurn = false
    this.scheduledDuringTurn = false
    this.reset()
    const turn = this.turn = randomUUID()
    try {
      if (!skill && await this.slashCommand(rpc, input)) return
      const prompt = await this.buildPrompt(input, attachments)
      this.dispatchPrompt(rpc, turn, prompt)
    } catch (error) {
      const failure = error instanceof ThreadAgentError ? error.failure : threadFailure({ message: errorText(error) })
      this.fail(failure)
      throw new ThreadAgentError(failure)
    }
  }

  async enqueue(item: ThreadQueuedInput, attachments: ThreadAttachment[] = []): Promise<string | undefined> {
    const rpc = this.connection?.rpc
    if (!rpc || !this.sessionId || this.disposed) throw new Error('Conversation is not connected')
    if (!item.text.trim() || item.text.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    if (this.queued.length >= MAX_QUEUED_ITEMS) throw new Error('Conversation queue is full')
    const nativeId = `agy-q:${randomUUID()}`
    this.queued.push({ nativeId, text: item.text, attachments: [...attachments] })
    return nativeId
  }

  async startQueued(nativeId?: string): Promise<void> {
    const rpc = this.connection?.rpc
    if (!rpc || !this.sessionId || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('Conversation is not ready to start queued input')
    const index = nativeId ? this.queued.findIndex(entry => entry.nativeId === nativeId) : 0
    if (index < 0 || index >= this.queued.length) throw new Error('Queued input is unavailable')
    const [entry] = this.queued.splice(index, 1)
    await this.send(entry.text, undefined, entry.attachments)
  }

  async updateQueued(nativeId: string, item: ThreadQueuedInput, attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.connection?.rpc || this.disposed) throw new Error('Conversation is not connected')
    if (!item.text.trim() || item.text.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    const entry = this.queued.find(candidate => candidate.nativeId === nativeId)
    if (!entry) return
    entry.text = item.text
    entry.attachments = [...attachments]
  }

  async deleteQueued(nativeId: string): Promise<void> {
    if (!this.connection?.rpc || this.disposed) throw new Error('Conversation is not connected')
    const index = this.queued.findIndex(candidate => candidate.nativeId === nativeId)
    if (index >= 0) this.queued.splice(index, 1)
  }

  async reorderQueued(nativeIds: string[]): Promise<void> {
    if (!this.connection?.rpc || this.disposed) throw new Error('Conversation is not connected')
    const byId = new Map(this.queued.map(entry => [entry.nativeId, entry]))
    const ordered: QueuedPrompt[] = []
    for (const id of nativeIds) {
      const entry = byId.get(id)
      if (!entry) continue
      ordered.push(entry)
      byId.delete(id)
    }
    ordered.push(...byId.values())
    this.queued.splice(0, this.queued.length, ...ordered)
  }

  /**
   * Steers an active Antigravity turn without losing session context. Uses native `session/steer` when
   * advertised; otherwise cleanly cancels the superseded prompt (without closing the active OXESpace turn)
   * and immediately dispatches the steered instruction on the same ACP session.
   */
  async steer(input: string, attachments: ThreadAttachment[] = []): Promise<void> {
    const rpc = this.connection?.rpc
    if (!rpc || !this.sessionId || this.disposed || !this.busy) throw new Error('There is no active turn to steer')
    if (!input.trim() || input.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    const prompt = await this.buildPrompt(input, attachments)
    if (this.supportsNativeSteer) {
      try {
        await this.request(rpc, 'session/steer', { sessionId: this.sessionId, prompt })
        return
      } catch (error) {
        if (!/method not found|not supported|unsupported|unknown method/i.test(errorText(error))) throw error
        this.supportsNativeSteer = false
      }
    }
    this.clearReactiveTimer()
    this.reactiveTurn = false
    this.closeSegment()
    this.cancelOpenApprovals(rpc)
    const previousDone = this.promptDone
    const nextTurn = this.turn = randomUUID()
    this.tools.clear()
    this.steering = true
    try {
      rpc.notify('session/cancel', { sessionId: this.sessionId })
      if (previousDone) {
        await Promise.race([
          previousDone,
          new Promise<void>(resolve => setTimeout(resolve, this.options.steerCancelGraceMs ?? STEER_CANCEL_GRACE_MS))
        ])
      }
    } finally {
      this.steering = false
    }
    if (this.disposed || !this.busy || this.turn !== nextTurn || this.connection?.rpc !== rpc) return
    this.dispatchPrompt(rpc, nextTurn, prompt)
    this.emit({ type: 'activity', id: `steer:${nextTurn}`, phase: 'responding', at: Date.now() })
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

  /** Opens a synthetic continuation turn when reactive updates arrive after `schedule` or async subagents. */
  private startReactiveTurn(): void {
    this.clearReactiveTimer()
    this.busy = true
    this.reactiveTurn = true
    this.scheduledDuringTurn = false
    this.reset()
    this.turn = randomUUID()
    this.emit({ type: 'continuation-started', id: this.turn, at: Date.now() })
  }

  private finishReactiveTurn(reason = 'end_turn'): void {
    if (!this.reactiveTurn || !this.busy || this.disposed) return
    const rescheduled = this.scheduledDuringTurn
    this.settle()
    if (!rescheduled) this.pendingBackgroundUntil = 0
    this.emit({ type: 'completed', status: reason === 'cancelled' ? 'interrupted' : 'completed' })
  }

  private clearReactiveTimer(): void {
    if (!this.reactiveTimer) return
    clearTimeout(this.reactiveTimer)
    this.reactiveTimer = null
  }

  private hasRunningTools(): boolean {
    for (const tool of this.tools.values()) {
      if (tool.status !== 'completed' && tool.status !== 'failed') return true
    }
    return false
  }

  private armReactiveSettleTimer(): void {
    this.clearReactiveTimer()
    if (!this.reactiveTurn || !this.busy || this.disposed) return
    if (this.approvals.size > 0 || this.hasRunningTools()) return
    const turn = this.turn
    this.reactiveTimer = setTimeout(() => {
      this.reactiveTimer = null
      if (this.turn !== turn || !this.reactiveTurn || !this.busy || this.disposed) return
      if (this.approvals.size > 0 || this.hasRunningTools()) return
      this.finishReactiveTurn('end_turn')
    }, this.options.reactiveIdleMs ?? REACTIVE_IDLE_SETTLE_MS)
    this.reactiveTimer.unref?.()
  }

  /** Closes the open message and thought, and ends the turn's local state. */
  private settle(): void {
    this.clearReactiveTimer()
    this.closeSegment()
    this.reasoning.completeAll()
    this.busy = false
    this.reactiveTurn = false
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

  private cancelOpenApprovals(rpc: AgentRpcPeer): void {
    for (const [id, pending] of [...this.approvals]) {
      this.approvals.delete(id)
      rpc.respond(pending.rpcId, pending.method === 'session/request_permission' ? { outcome: { outcome: 'cancelled' } } : { cancelled: true, answers: {} })
      this.emit({ type: 'request-resolved', id, state: 'cancelled', resolution: 'interrupted', resolvedAt: Date.now() })
      this.emit({ type: 'approval-resolved', id })
    }
  }

  async interrupt(): Promise<void> {
    const rpc = this.connection?.rpc
    this.pendingBackgroundUntil = 0
    this.scheduledDuringTurn = false
    if (!this.busy || !rpc) return
    this.clearReactiveTimer()
    // The protocol asks the client to cancel what it was asked before the turn answers `cancelled`.
    this.cancelOpenApprovals(rpc)
    rpc.notify('session/cancel', { sessionId: this.sessionId })
    if (this.reactiveTurn || this.steering || !this.promptDone) {
      this.steering = false
      this.settle()
      this.emit({ type: 'completed', status: 'interrupted' })
    }
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
    const option = (...kinds: string[]): string | undefined => kinds.map(kind => pending.options.find(entry => entry.kind === kind)?.id).find(Boolean)

    if (pending.kind === 'question') {
      const declineOrCancel = response.decision === 'decline' || response.decision === 'cancel'
      if (declineOrCancel) {
        if (pending.method === 'session/request_permission') {
          const rejectId = response.decision === 'decline' ? option('reject_once', 'reject_always') : undefined
          rpc.respond(pending.rpcId, { outcome: rejectId ? { outcome: 'selected', optionId: rejectId } : { outcome: 'cancelled' } })
        } else {
          rpc.respond(pending.rpcId, { cancelled: true, answers: {} })
        }
      } else {
        const questions = pending.questions ?? []
        const rawAnswers = response.answers ?? {}
        if (questions.length && questions.some(question => !rawAnswers[question.id]?.some(value => value.trim()))) {
          throw new Error('Answer every question before sending.')
        }
        const answers = Object.fromEntries(questions.map(question => [question.id, (rawAnswers[question.id] ?? []).map(value => value.trim()).filter(Boolean)]))
        const firstChoice = Object.values(answers).flat()[0]
        const matchedOption = firstChoice
          ? pending.options.find(entry => entry.id === firstChoice || entry.name?.trim().toLowerCase() === firstChoice.toLowerCase())?.id
          : undefined
        if (pending.method === 'session/request_permission') {
          const optionId = matchedOption ?? option('allow_once', 'allow_always')
          rpc.respond(pending.rpcId, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }, answers })
        } else {
          rpc.respond(pending.rpcId, { answers })
        }
      }
      this.approvals.delete(requestId)
      this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome('question', response), resolvedAt: Date.now() })
      this.emit({ type: 'approval-resolved', id: requestId })
      if (this.reactiveTurn) this.armReactiveSettleTimer()
      return
    }

    const decision = response.decision ?? 'decline'
    if (decision === 'acceptForSession' && pending.guarded) {
      throw new Error('A change to agent instructions, MCP settings or hooks is approved once, never for the session')
    }
    const optionId = decision === 'accept' ? option('allow_once')
      : decision === 'acceptForSession' ? option('allow_always')
        : decision === 'decline' ? option('reject_once', 'reject_always')
          : undefined
    // An approval is never widened: without the exact option the provider offered, the answer is refused.
    if (!optionId && (decision === 'accept' || decision === 'acceptForSession')) throw new Error('The agent did not offer that answer for this request')
    rpc.respond(pending.rpcId, { outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
    this.approvals.delete(requestId)
    if (decision === 'acceptForSession') this.persistAlwaysAllow(pending)
    this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome('approval', response), resolvedAt: Date.now() })
    this.emit({ type: 'approval-resolved', id: requestId })
    if (this.reactiveTurn) this.armReactiveSettleTimer()
  }

  private persistAlwaysAllow(pending: PendingRequest): void {
    if (pending.guarded) return
    const derived = deriveAntigravityPersistRules(this.rootPath, pending.request)
    for (const rule of derived) {
      let stored: ThreadPermissionRule | undefined
      try {
        stored = this.options.permissions?.add({ projectRoot: this.rootPath, kind: rule.kind, pattern: rule.pattern, decision: 'allow' })
      } catch {
        stored = undefined
      }
      if (!this.sessionRules.some(entry => entry.kind === rule.kind && entry.pattern === rule.pattern && entry.decision === 'allow')) {
        this.sessionRules.push(stored ?? { id: `session:${rule.kind}:${rule.pattern}`, projectRoot: this.rootPath, kind: rule.kind, pattern: rule.pattern, decision: 'allow', createdAt: Date.now() })
      }
    }
    if (!derived.length && !pending.request.command && !pending.request.paths?.length && pending.request.toolName) {
      this.sessionTools.add(pending.request.toolName)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.clearReactiveTimer()
    this.pendingBackgroundUntil = 0
    this.scheduledDuringTurn = false
    this.queued.length = 0
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
    if (kind === 'current_mode_update') {
      const modeId = text(update.currentModeId) || text(update.modeId)
      if (modeId) this.nativeMode = modeId
      return
    }
    if (METADATA_UPDATES.has(kind)) return
    if (REACTIVE_END_UPDATES.has(kind) || (this.reactiveTurn && text(update.stopReason))) {
      if (this.reactiveTurn) this.finishReactiveTurn(text(update.stopReason) || 'end_turn')
      return
    }
    const isChunk = kind === 'agent_message_chunk' || kind === 'agent_thought_chunk'
    const isTool = kind === 'tool_call' || kind === 'tool_call_update'
    const isPlan = kind === 'plan'
    if (!isChunk && !isTool && !isPlan) return

    if (!this.busy) {
      const hasContent = isChunk ? Boolean(text(record(update.content).text))
        : isTool ? Boolean(text(update.toolCallId))
          : list(update.entries).length > 0
      if (!hasContent) return
      this.startReactiveTurn()
    }

    if (Date.now() - this.lastNativeSignalAt >= 2_000) {
      this.lastNativeSignalAt = Date.now()
      this.emit({ type: 'native-signal', at: this.lastNativeSignalAt })
    }
    if (isChunk) {
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
    } else if (isTool) {
      this.closeSegment()
      const holdMs = detectAntigravityBackgroundHoldMs(update)
      if (holdMs > 0) {
        this.scheduledDuringTurn = true
        this.pendingBackgroundUntil = Math.max(this.pendingBackgroundUntil, Date.now() + holdMs)
      }
      const call = this.mergeTool(update)
      if (call) this.emit(this.toolEvent(call))
    } else if (isPlan) {
      this.emit({ type: 'plan', id: `plan:${this.turn}`, turnId: this.turn, steps: list(update.entries).slice(0, 100).map(value => {
        const entry = record(value)
        return { label: text(entry.content).slice(0, 2000), status: entry.status === 'completed' ? 'completed' as const : entry.status === 'in_progress' ? 'inProgress' as const : 'pending' as const }
      }).filter(step => Boolean(step.label)) })
    }
    if (this.reactiveTurn) this.armReactiveSettleTimer()
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
    const file = ANTIGRAVITY_FILE_KINDS.has(call.kind)
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
    const method = message.method ?? ''
    const supported = method === 'session/request_permission' || method === 'session/request_user_input' || method === 'session/ask_question'
    if (!supported || params.sessionId !== this.sessionId || this.disposed || this.replaying) {
      rpc.rejectRequest(message.id)
      return
    }
    if (!this.busy) this.startReactiveTurn()

    const call = record(params.toolCall)
    const options: AntigravityPermissionOption[] = list(params.options)
      .map(value => ({ id: text(record(value).optionId), kind: text(record(value).kind), ...(text(record(value).name) ? { name: text(record(value).name) } : {}) }))
      .filter(option => option.id && option.kind)
      .slice(0, 20)

    const questions = extractAntigravityQuestions(method, call, params)
    if (questions.length) {
      this.closeSegment()
      this.clearReactiveTimer()
      const id = String(message.id)
      const request: ThreadRequest = {
        id,
        nativeId: text(call.toolCallId) || id,
        nativeMethod: method,
        kind: 'question',
        title: text(call.title).slice(0, 200) || 'Antigravity needs your input',
        generation: 0,
        createdAt: Date.now(),
        state: 'pending',
        turnId: this.turn,
        questions
      }
      this.approvals.set(id, { rpcId: message.id, method, kind: 'question', options, request, guarded: false, questions })
      this.emit({ type: 'request', id, request })
      return
    }

    if (method !== 'session/request_permission') {
      rpc.rejectRequest(message.id)
      return
    }

    const known = this.tools.get(text(call.toolCallId))
    const kind = text(call.kind) || known?.kind || 'other'
    const id = String(message.id)
    const request = this.toRequest(id, call, kind, options, known)
    const verdict = evaluateAntigravityPermission({
      rootPath: this.rootPath,
      access: this.access,
      approvalPolicy: this.approvalPolicy,
      mode: this.mode ?? 'default',
      nativeMode: this.nativeMode,
      kind,
      request,
      options,
      permissions: this.options.permissions,
      sessionRules: this.sessionRules,
      sessionTools: this.sessionTools
    })
    if (verdict.action === 'reject') {
      rpc.respond(message.id, { outcome: verdict.optionId ? { outcome: 'selected', optionId: verdict.optionId } : { outcome: 'cancelled' } })
      if (this.reactiveTurn) this.armReactiveSettleTimer()
      return
    }
    if (verdict.action === 'approve') {
      rpc.respond(message.id, { outcome: { outcome: 'selected', optionId: verdict.optionId } })
      if (this.reactiveTurn) this.armReactiveSettleTimer()
      return
    }

    if (verdict.guarded && request.availableDecisions) {
      request.availableDecisions = request.availableDecisions.filter(decision => decision !== 'acceptForSession')
    }
    this.closeSegment()
    this.clearReactiveTimer()
    this.approvals.set(id, { rpcId: message.id, method, kind: 'approval', options, request, guarded: verdict.guarded })
    this.emit({ type: 'request', id, request })
    this.emit({ type: 'approval', id, title: request.title, detail: request.detail ?? '' })
  }

  private toRequest(id: string, call: Record<string, unknown>, kind: string, options: AntigravityPermissionOption[], known?: ToolCall): ThreadRequest {
    const input = record(call.rawInput)
    const command = kind === 'execute' ? (commandText(input) || known?.command || '').slice(0, 12_000) : ''
    const paths = [...new Set([...list(call.locations).map(value => text(record(value).path)), text(input.path), text(input.file_path), text(input.filePath), ...(known?.paths ?? [])].filter(Boolean))].slice(0, 100).map(path => path.slice(0, 1000))
    const file = ANTIGRAVITY_FILE_KINDS.has(kind)
    const title = text(call.title).slice(0, 2000) || known?.title || ''
    const cwd = text(input.cwd) || text(input.workdir)
    return {
      id,
      nativeId: text(call.toolCallId) || id,
      nativeMethod: 'session/request_permission',
      kind: 'approval',
      toolName: kind === 'execute' ? 'command' : file ? 'fileChange' : (title.slice(0, 80) || kind),
      title: kind === 'execute' ? 'Approve command' : file ? 'Approve file changes' : 'Approve tool use',
      detail: command || (file ? paths.join('\n') : '') || title || 'The agent requests your permission.',
      ...(command ? { command } : {}),
      ...(file && paths.length ? { paths } : {}),
      ...(cwd ? { cwd: cwd.slice(0, 1000) } : {}),
      generation: 0,
      createdAt: Date.now(),
      state: 'pending',
      turnId: this.turn,
      availableDecisions: [
        ...(options.some(option => option.kind === 'allow_once') ? ['accept' as const] : []),
        ...(options.some(option => option.kind === 'allow_always') ? ['acceptForSession' as const] : []),
        'decline' as const
      ]
    }
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
