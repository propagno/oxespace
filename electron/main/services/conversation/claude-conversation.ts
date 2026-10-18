import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AgentConversationAdapter, ThreadMcpServerStatus, ConversationProtocolEvidence, ThreadAgentInput, ThreadEvent, ThreadConfiguration, ThreadFileChange, ThreadAttachment, ThreadRequestResponse, ThreadContextReport } from '../../../../shared/types/thread'
import type { ConversationTransport } from './codex-conversation'
import { JsonLinesDecoder } from './json-lines'
import { CLAUDE_THREAD_ARGS, claudeRuntimeCatalog } from './claude-command-catalog'
import { threadFailure } from './thread-failure'
import { normalizeClaudeContext } from './thread-context'
import { readClaudeResultCost, stepFromProcessTotal } from './thread-cost'
import { createApiRetryTracker } from './claude-api-retry'
import { describePermissionRequest } from './claude-permission-request'
import { toolResultText } from './tool-result-text'

/** How long a cooperative interrupt may take before the process is ended instead. */
const INTERRUPT_GRACE_MS = 2_000
import { requestOutcome } from '../../../../shared/threadRequestOutcome'
import { THREAD_PROMPT_MAX_CHARS } from '../../../../shared/threadLimits'

const DISPOSED = 'Agent connection disposed'

/** A single protocol line: a large file read or an inline image can exceed 1 MiB (Codex allows the same 32 MiB). */
const MAX_PROTOCOL_LINE_BYTES = 32 * 1024 * 1024

type PrintTransport = ConversationTransport & { endInput(): void }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Official persistent print+stream-json transport, explicit resume after disconnection. */
export class ClaudeConversationAdapter implements AgentConversationAdapter {
  readonly capabilities = { resume: true, approvals: true, attachments: true, modelSelection: true, questions: true, permissions: false, elicitation: false, queue: false, steering: false, nativeSessions: true, stopTasks: true }
  readonly evidence: ConversationProtocolEvidence = { transport: 'claude-print-stream-json', verified: 'fixture' }
  private context: ({ rootPath: string; nativeSessionId: string | null } & ThreadConfiguration) | null = null
  private approvals = new Map<string, { input: Record<string, unknown>; toolName: string; questions?: Map<string, string>; suggestions?: unknown[]; toolUseId?: string }>()
  private emit: (event: ThreadEvent) => void = () => {}
  private transport: PrintTransport | null = null
  private initialized: { resolve(): void; reject(error: Error): void } | null = null
  private completed = true
  private answerShown = false
  private authenticationFailed = false
  private diagnostic = ''
  private lastNativeSignalAt = 0
  private selectedModel: string | undefined
  private localPlanId = ''
  private tasks = new Map<string, Extract<ThreadEvent, { type: 'subagent' }>>()
  private readonly apiRetries = createApiRetryTracker(() => `claude-retry:${randomUUID()}`)
  /** A protocol interrupt is in flight: the turn's result is an interruption, not a failure. */
  private interruptRequested = false
  private interruptWaiter: (() => void) | null = null
  private readonly seenMessages = new Set<string>()
  private streamMessageId = ''
  private disposed = false
  /** `total_cost_usd` of the last `result` of the running process; `result` reports a process total. */
  private processCostUsd = 0
  private busy = false
  private pendingContext = new Map<string, { resolve: (report: ThreadContextReport | null) => void; timer: ReturnType<typeof setTimeout> }>()
  private pendingControl = new Map<string, { resolve: (error: string | null) => void; timer: ReturnType<typeof setTimeout> }>()
  private fileTools = new Map<string, ThreadFileChange[]>()
  private todoTools = new Map<string, Extract<ThreadEvent, { type: 'plan' }>['steps']>()
  private worktreeTools = new Map<string, 'EnterWorktree' | 'ExitWorktree'>()

  constructor(private readonly createTransport: (args: string[], cwd: string) => PrintTransport) {}
  async start(context: { rootPath: string; nativeSessionId: string | null } & ThreadConfiguration, emit: (event: ThreadEvent) => void): Promise<void> {
    if (this.context || this.disposed) throw new Error('Conversation adapter cannot be started twice')
    this.context = { ...context }
    this.emit = emit
  }

  async send(text: string, _skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.context || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('A conversation turn is already running')
    if (!text.trim() || text.length > THREAD_PROMPT_MAX_CHARS) throw new Error('Invalid conversation input')
    this.busy = true
    this.fileTools.clear()
    this.todoTools.clear()
    if (text.trim() === '/model') {
      const discovery = this.createTransport([...CLAUDE_THREAD_ARGS, '--no-session-persistence'], this.context.rootPath)
      try {
        const catalog = await claudeRuntimeCatalog(discovery)
        this.emit({ type: 'model-picker', id: randomUUID(), models: catalog.models, selectedModel: this.context.model })
        this.emit({ type: 'completed', status: 'completed' })
      } finally { this.busy = false; await discovery.close() }
      return
    }
    const sessionId = this.context.nativeSessionId ?? randomUUID()
    const localPlanId = randomUUID()
    const writable = this.context.access === 'workspace-write' || this.context.access === 'full-access'
    const permissionMode = this.context.mode === 'plan' ? 'plan' : this.context.access === 'full-access' ? 'bypassPermissions'
      : this.context.mode === 'acceptEdits' && this.context.access === 'workspace-write' ? 'acceptEdits' : 'default'
    const settings = !writable
      ? '{"disableAllHooks":true,"disableSkillShellExecution":true}'
      : this.context.hooksEnabled ? undefined : '{"disableAllHooks":true}'
    // Read-only is a restricted tool surface, not a claim of OS sandboxing.
    // Exclude shell, skills, agents and external MCPs that could mutate state.
    const runtimeArgs = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', permissionMode, '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--tools', writable ? 'default' : 'Read,Glob,Grep,AskUserQuestion', ...(!writable ? ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'] : []), ...(settings ? ['--settings', settings] : [])]
    const args = [...runtimeArgs,
      ...(this.context.model ? ['--model', this.context.model] : []),
      ...(this.context.reasoningEffort ? ['--effort', this.context.reasoningEffort] : []),
      ...(this.context.nativeSessionId ? ['--resume', sessionId] : ['--session-id', sessionId])]
    this.completed = false
    this.answerShown = false
    this.authenticationFailed = false
    this.diagnostic = ''
    this.streamMessageId = ''
    this.localPlanId = localPlanId
    this.selectedModel = text.trim().match(/^\/model\s+([a-z0-9][a-z0-9._:/\[\]-]*)$/i)?.[1]
    try {
      const fresh = !this.transport
      if (fresh) this.processCostUsd = 0
      const transport = this.transport ??= this.createTransport(args, this.context.rootPath)
      if (fresh) {
      const decoder = new JsonLinesDecoder(value => this.receive(value, transport), MAX_PROTOCOL_LINE_BYTES)
      transport.onData(chunk => {
        if (this.disposed || this.transport !== transport) return
        if (Date.now() - this.lastNativeSignalAt >= 2_000) {
          this.lastNativeSignalAt = Date.now()
          this.emit({ type: 'native-signal', at: this.lastNativeSignalAt })
        }
        try { decoder.push(chunk) } catch { this.diagnostic = 'Invalid agent protocol stream'; this.finish('failed'); void transport.close() }
      })
      transport.onClose(() => {
        if (this.transport !== transport) return
        this.initialized?.reject(Error('Agent connection closed during initialization'))
        if (!this.completed && !this.disposed) {
          try { decoder.finish() } catch { /* incomplete stream */ }
          if (!this.completed) { this.diagnostic ||= 'Agent connection closed before the turn completed'; this.finish('failed') }
        }
        if (this.transport === transport) this.transport = null
        this.markTasksUnknown()
        if (!this.disposed) this.emit({ type: 'connection-closed', at: Date.now() })
      })
      }
      if (fresh) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { this.initialized?.reject(Error('Agent initialization timed out')); void transport.close() }, 30_000)
        this.initialized = {
          resolve: () => { clearTimeout(timer); this.initialized = null; resolve() },
          reject: error => { clearTimeout(timer); this.initialized = null; reject(error) }
        }
        try { transport.write(JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize', hooks: {} } }) + '\n') }
        catch (error) { this.initialized.reject(error instanceof Error ? error : Error('Agent initialization failed')) }
      })
      if (this.disposed || this.transport !== transport) throw Error('Agent connection ended before input could be sent')
      const content: unknown = attachments.length ? [{ type: 'text', text }, ...(await Promise.all(attachments.map(async attachment => {
        if (!attachment.path) throw Error('Attachment is unavailable')
        return { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: (await readFile(attachment.path)).toString('base64') } }
      })))] : text
      transport.write(JSON.stringify({ type: 'user', session_id: this.context.nativeSessionId ?? sessionId, parent_tool_use_id: null, message: { role: 'user', content } }) + '\n')
    } catch (error) {
      this.diagnostic = error instanceof Error ? error.message : this.diagnostic
      this.finish('failed')
      throw error
    }
  }

  /** Idle-only: a control request during a turn would race the stream, so it reports nothing instead. */
  contextUsage(): Promise<ThreadContextReport | null> {
    const transport = this.transport
    if (!transport || this.disposed || this.busy || this.initialized) return Promise.resolve(null)
    const requestId = `context:${randomUUID()}`
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pendingContext.delete(requestId); resolve(null) }, 5_000)
      this.pendingContext.set(requestId, { resolve, timer })
      try { transport.write(JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'get_context_usage' } }) + '\n') }
      catch { clearTimeout(timer); this.pendingContext.delete(requestId); resolve(null) }
    })
  }

  /**
   * Stops one background task with the CLI's own `stop_task` control request and
   * waits for its answer. The task's terminal state still arrives through the
   * normal task events; this only reports whether the CLI accepted the request.
   */
  stopTask(taskId: string): Promise<void> {
    const transport = this.transport
    if (!transport || this.disposed) return Promise.reject(Error('The provider session is not connected'))
    if (!/^[\w.:-]{1,200}$/.test(taskId)) return Promise.reject(Error('Invalid task identifier'))
    const requestId = `stop-task:${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingControl.delete(requestId); reject(Error('The provider did not confirm the stop request')) }, 5_000)
      // A task the CLI no longer knows is not running: the request is refused, and keeping it listed
      // as running would leave the conversation waiting for something that cannot end.
      this.pendingControl.set(requestId, { timer, resolve: error => {
        if (error === DISPOSED) { reject(Error(error)); return }
        if (error) this.markTaskUnknown(taskId)
        resolve()
      } })
      try { transport.write(JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'stop_task', task_id: taskId } }) + '\n') }
      catch (error) { clearTimeout(timer); this.pendingControl.delete(requestId); reject(error instanceof Error ? error : Error(String(error))) }
    })
  }

  private settleControl(requestId: string, error: string | null): boolean {
    const pending = this.pendingControl.get(requestId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.pendingControl.delete(requestId)
    pending.resolve(error)
    return true
  }

  private settleContext(requestId: string, report: ThreadContextReport | null): boolean {
    const pending = this.pendingContext.get(requestId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.pendingContext.delete(requestId)
    pending.resolve(report)
    return true
  }

  private finish(requested: 'completed' | 'failed' | 'interrupted'): void {
      if (this.completed || this.disposed) return
      // The CLI reports a cooperative interrupt as an errored result; the person asked for it.
      const status = this.interruptRequested ? 'interrupted' : requested
      this.interruptRequested = false
      this.completed = true
      this.apiRetries.reset()
      this.interruptWaiter?.()
      this.busy = false
      this.approvals.clear()
      if (status === 'completed' && this.selectedModel) {
        this.context!.model = this.selectedModel
        this.emit({ type: 'configuration', model: this.selectedModel })
      }
      const failure = status === 'failed' ? threadFailure({ message: this.diagnostic, ...(this.authenticationFailed ? { codexErrorInfo: 'authentication_failed' } : {}) }) : undefined
      this.emit({ type: 'completed', status, ...(failure ? { error: failure.message, errorCode: failure.code, failure } : {}) })
    }

  private receive(value: unknown, transport: PrintTransport): void {
        const event = record(value)
        if (event.type === 'control_response' && record(event.response).request_id === 'initialize') {
          const response = record(event.response)
          if (response.subtype === 'error') this.initialized?.reject(Error(typeof response.error === 'string' ? response.error : 'Agent initialization failed'))
          else this.initialized?.resolve()
          return
        }
        if (event.type === 'control_response') {
          const response = record(event.response)
          if (typeof response.request_id === 'string' && this.settleContext(response.request_id, response.subtype === 'success' ? normalizeClaudeContext(response.response) : null)) return
          if (typeof response.request_id === 'string' && this.settleControl(response.request_id, response.subtype === 'success' ? null : typeof response.error === 'string' ? response.error.slice(0, 500) : 'The provider refused the request')) return
        }
        if (typeof event.uuid === 'string') {
          if (this.seenMessages.has(event.uuid)) return
          this.seenMessages.add(event.uuid)
          if (this.seenMessages.size > 4096) this.seenMessages.delete(this.seenMessages.values().next().value!)
        }
        // A provider retry is not a failure; it is one line revised per attempt.
        const retry = this.apiRetries.observe(event)
        if (retry) {
          this.emit({ type: 'activity', id: retry.id, phase: 'connecting', at: Date.now(), summary: retry.summary })
          return
        }
        if (event.type === 'system' && ['task_started', 'task_progress', 'task_notification', 'task_updated'].includes(String(event.subtype)) && typeof event.task_id === 'string') {
          const patch = event.subtype === 'task_updated' ? record(event.patch) : {}
          const nativeStatus = patch.status ?? event.status
          const id = `claude-task:${this.context!.nativeSessionId}:${event.task_id}`
          const previous = this.tasks.get(id)
          const terminal = event.subtype === 'task_notification' || ['completed', 'failed', 'stopped', 'killed'].includes(String(nativeStatus))
          // A delayed progress event must not resurrect a finished task.
          if (!terminal && previous && previous.state !== 'running') return
          const status = nativeStatus === 'completed' ? 'completed' : nativeStatus === 'failed' ? 'failed' : ['stopped', 'killed'].includes(String(nativeStatus)) ? 'interrupted' : 'unknown'
          const state = terminal ? status : 'running'
          const description = typeof event.description === 'string' ? event.description.slice(0, 2000) : previous?.prompt
          const message = typeof event.summary === 'string' ? event.summary.slice(0, 12000) : previous?.agents[0]?.message
          const task: Extract<ThreadEvent, { type: 'subagent' }> = { type: 'subagent', id, action: typeof event.task_type === 'string' && /bash|shell/i.test(event.task_type) ? 'Background command' : previous?.action ?? 'Background agent', state,
            receiverThreadIds: [event.task_id], agents: [{ threadId: event.task_id, status: state, ...(message ? { message } : {}) }], prompt: description,
            startedAt: previous?.startedAt ?? Date.now(), ...(terminal ? { completedAt: Date.now() } : {}) }
          this.tasks.set(id, task)
          if (this.tasks.size > 512) {
            const settled = [...this.tasks].find(([key, value]) => key !== id && value.state !== 'running')
            if (settled) this.tasks.delete(settled[0])
          }
          this.emit(task)
          return
        }
        // Child output is owned by its task, not the parent conversation turn.
        if (typeof event.parent_tool_use_id === 'string' && ['assistant', 'stream_event', 'result'].includes(String(event.type))) return
        if (event.type === 'control_cancel_request' && typeof event.request_id === 'string') {
          if (this.approvals.delete(event.request_id)) this.emit({ type: 'request-resolved', id: event.request_id, state: 'cancelled', resolution: 'unknown', resolvedAt: Date.now() })
          return
        }
        if (this.completed && (event.type === 'assistant' || event.type === 'stream_event')) {
          // Native task notifications can trigger a provider-owned follow-up.
          this.completed = false
          this.busy = true
          this.answerShown = false
          this.authenticationFailed = false
          this.diagnostic = ''
          this.selectedModel = undefined
          this.localPlanId = randomUUID()
          this.emit({ type: 'continuation-started', id: this.localPlanId, at: Date.now() })
        }
        if (event.type === 'control_request' && typeof event.request_id === 'string') {
          const request = record(event.request)
          if (request.subtype === 'can_use_tool') {
            const input = record(request.input), toolName = String(request.tool_name || 'tool')
            const permission = describePermissionRequest(request, toolName, input)
            this.approvals.set(event.request_id, { input, toolName, suggestions: permission.suggestions, toolUseId: permission.toolUseId })
            if (toolName === 'AskUserQuestion') {
              const nativeQuestions = new Map<string, string>()
              const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 20).map(value => {
                const question = record(value)
                const id = typeof question.id === 'string' ? question.id : randomUUID()
                if (typeof question.question === 'string') nativeQuestions.set(id, question.question)
                return { id, header: typeof question.header === 'string' ? question.header.slice(0, 80) : undefined,
                  question: typeof question.question === 'string' ? question.question.slice(0, 2000) : '', multiple: question.multiSelect === true,
                  options: (Array.isArray(question.options) ? question.options : []).slice(0, 20).map(value => ({ value: String(record(value).label || ''), label: String(record(value).label || '').slice(0, 200), description: String(record(value).description || '').slice(0, 500) })) }
              }).filter(question => question.question)
              this.approvals.set(event.request_id, { input, toolName, questions: nativeQuestions })
              this.emit({ type: 'request', id: event.request_id, request: { id: event.request_id, nativeId: event.request_id, nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', generation: 0, createdAt: Date.now(), state: 'pending', questions } })
            } else {
              // The command and target files let OXESpace's permission rules answer the prompt.
              const command = toolName === 'Bash' && typeof input.command === 'string' ? input.command.slice(0, 12000) : undefined
              const paths = [input.file_path, input.notebook_path].filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096)
              this.emit({ type: 'request', id: event.request_id, request: { id: event.request_id, nativeId: event.request_id, nativeMethod: `can_use_tool:${toolName}`, kind: 'approval', title: permission.title, detail: permission.detail, generation: 0, createdAt: Date.now(), state: 'pending', availableDecisions: permission.decisions, toolName, ...(command ? { command } : {}), ...(paths.length ? { paths } : {}) } })
              this.emit({ type: 'approval', id: event.request_id, title: permission.title, detail: permission.detail })
            }
          } else transport.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported host request' } }) + '\n')
        } else if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
          const providerVersion = typeof event.claude_code_version === 'string' ? event.claude_code_version : typeof event.version === 'string' ? event.version : ''
          if (providerVersion) this.evidence.providerVersion = providerVersion.slice(0, 120)
          this.evidence.protocolVersion = 'stream-json'
          this.evidence.verified = 'native'
          this.context!.nativeSessionId = event.session_id
          this.emit({ type: 'session', nativeSessionId: event.session_id, ...(Array.isArray(event.mcp_servers) ? { mcpServers: mcpServerStatuses(event.mcp_servers) } : {}) })
          if (typeof event.cwd === 'string') this.emit({ type: 'location', cwd: event.cwd })
        } else if (event.type === 'stream_event') {
          const streamed = record(event.event)
          if (streamed.type === 'message_start') this.streamMessageId = typeof record(streamed.message).id === 'string' ? String(record(streamed.message).id) : randomUUID()
          if (streamed.type === 'content_block_delta' && record(streamed.delta).type === 'text_delta' && typeof record(streamed.delta).text === 'string') {
            if (!this.streamMessageId) this.streamMessageId = randomUUID()
            this.emit({ type: 'delta', id: this.streamMessageId, text: String(record(streamed.delta).text) })
            this.emit({ type: 'activity', id: `claude:${this.localPlanId}:text`, phase: 'responding', at: Date.now() })
          }
          if (streamed.type === 'content_block_start') {
            const block = record(streamed.content_block)
            if (block.type === 'thinking' || block.type === 'text') this.emit({ type: 'activity', id: `claude:${this.localPlanId}:${block.type}`, phase: block.type === 'thinking' ? 'reasoning' : 'responding', at: Date.now() })
          }
        } else if (event.type === 'assistant') {
          const content = record(event.message).content
          if (!Array.isArray(content)) return
          const answer = content.filter(block => record(block).type === 'text').map(block => record(block).text).filter(value => typeof value === 'string').join('\n')
          if (event.error === 'authentication_failed' || /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(answer)) {
            this.authenticationFailed = true
            this.diagnostic = answer
            return
          }
          if (answer) { this.answerShown = true; this.emit({ type: 'message', id: typeof record(event.message).id === 'string' ? record(event.message).id as string : randomUUID(), role: 'assistant', text: answer }) }
          for (const block of content.map(record)) {
            if (block.type === 'tool_use' && typeof block.id === 'string') {
              const input = record(block.input), path = typeof input.file_path === 'string' ? input.file_path : ''
              if (block.name === 'TodoWrite' && Array.isArray(input.todos)) this.todoTools.set(block.id, input.todos.slice(0, 100).map(value => {
                const todo = record(value)
                return { label: typeof todo.content === 'string' ? todo.content.slice(0, 2000) : '', status: todo.status === 'completed' ? 'completed' as const : todo.status === 'in_progress' ? 'inProgress' as const : 'pending' as const }
              }).filter(todo => Boolean(todo.label)))
              if (block.name === 'EnterWorktree' || block.name === 'ExitWorktree') this.worktreeTools.set(block.id, block.name)
              const files: ThreadFileChange[] = path && ['Edit', 'Write', 'MultiEdit'].includes(String(block.name)) ? [{ path, kind: 'update', source: 'tool-input', authorship: 'indeterminate', state: 'running', patch: JSON.stringify(input, null, 2) }] : []
              if (files.length) this.fileTools.set(block.id, files)
              this.emit({ type: 'tool', id: block.id, name: typeof block.name === 'string' ? block.name : 'Tool', state: 'running', detail: JSON.stringify(block.input ?? {}, null, 2).slice(0, 12000), startedAt: Date.now(), ...(files.length ? { files } : {}) })
            }
          }
        } else if (event.type === 'user') {
          const content = record(event.message).content
          if (Array.isArray(content)) for (const block of content.map(record)) {
            if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
              const files = this.fileTools.get(block.tool_use_id)?.map(file => ({ ...file, state: block.is_error ? 'failed' as const : 'completed' as const }))
              this.emit({ type: 'tool', id: block.tool_use_id, name: 'Tool result', state: block.is_error ? 'failed' : 'completed', detail: '', output: toolResultText(block.content), completedAt: Date.now(), ...(files ? { files } : {}) })
              this.fileTools.delete(block.tool_use_id)
              // Claude's own worktree tools move the session; the orchestrator checks the reported directory.
              const worktreeTool = this.worktreeTools.get(block.tool_use_id)
              this.worktreeTools.delete(block.tool_use_id)
              if (worktreeTool && !block.is_error) {
                const cwd = worktreeTool === 'ExitWorktree' ? this.context!.rootPath : enteredWorktreePath(toolResultText(block.content))
                if (cwd) this.emit({ type: 'location', cwd })
              }
              const steps = this.todoTools.get(block.tool_use_id)
              if (steps && !block.is_error) this.emit({ type: 'plan', id: `plan:${this.localPlanId}`, steps })
              this.todoTools.delete(block.tool_use_id)
            }
          }
        } else if (event.type === 'result') {
          this.diagnostic = [typeof event.result === 'string' && (event.is_error || this.authenticationFailed) ? event.result : '', ...(Array.isArray(event.errors) ? event.errors.filter(value => typeof value === 'string').slice(0, 10) : [])].filter(Boolean).join('\n').slice(0, 12000) || this.diagnostic
          if (typeof event.result === 'string' && /^Failed to authenticate:|^OAuth token (?:has expired|revoked)|^Not logged in/i.test(event.result)) this.authenticationFailed = true
          if (typeof event.session_id === 'string' && event.session_id !== this.context!.nativeSessionId) {
            this.context!.nativeSessionId = event.session_id
            this.emit({ type: 'session', nativeSessionId: event.session_id })
          }
          if (!this.answerShown && !this.authenticationFailed && !event.is_error && typeof event.result === 'string' && event.result) {
            this.emit({ type: 'message', id: randomUUID(), role: 'assistant', text: event.result.slice(0, 65536) })
          }
          const turnCost = readClaudeResultCost(event)
          if (turnCost) {
            if (turnCost.usd !== undefined) {
              const step = stepFromProcessTotal(this.processCostUsd, turnCost.usd)
              this.processCostUsd = step.total
              turnCost.usd = step.turnUsd
            }
            this.emit({ type: 'turn-cost', ...turnCost })
          }
          this.finish(this.authenticationFailed || event.is_error === true || event.subtype !== 'success' ? 'failed' : 'completed')
        }
  }

  /**
   * Asks the CLI to stop the turn itself. Unlike killing the process this keeps
   * the session, its background tasks and the native turn intact. Resolves true
   * only when the turn actually ended; any doubt falls back to the kill path.
   */
  private requestProtocolInterrupt(transport: ConversationTransport): Promise<boolean> {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.interruptWaiter = null; resolve(false) }, INTERRUPT_GRACE_MS)
      this.interruptWaiter = () => { clearTimeout(timer); this.interruptWaiter = null; resolve(true) }
      this.interruptRequested = true
      try { transport.write(JSON.stringify({ type: 'control_request', request_id: `interrupt:${randomUUID()}`, request: { subtype: 'interrupt', cancel_queued: true } }) + '\n') }
      catch { clearTimeout(timer); this.interruptWaiter = null; resolve(false) }
    })
  }

  async interrupt(): Promise<void> {
    if (!this.transport) return
    const transport = this.transport
    if (this.busy && !this.completed && !this.disposed) {
      if (await this.requestProtocolInterrupt(transport)) return
      this.interruptRequested = false
    }
    this.initialized?.reject(Error('Agent initialization cancelled'))
    // Windows process-tree termination can truncate the native turn. Preserve
    // the native ID and explicitly label local state interrupted, never success.
    this.busy = false
    this.transport = null
    this.approvals.clear()
    this.completed = true
    this.markTasksUnknown()
    this.emit({ type: 'completed', status: 'interrupted' })
    await transport.close()
  }
  async configure(configuration: ThreadConfiguration): Promise<void> {
    if (!this.context || this.busy || this.disposed) throw Error('Finish the active turn before applying configuration')
    if ([...this.tasks.values()].some(task => task.state === 'running')) throw Error('Finish or stop background work before changing this session configuration.')
    const transport = this.transport
    this.transport = null
    await transport?.close()
    this.context = { ...this.context, ...configuration }
    this.emit({ type: 'configuration', model: this.context.model, reasoningEffort: this.context.reasoningEffort, access: this.context.access ?? 'read-only', networkAccess: this.context.networkAccess ?? false, approvalPolicy: this.context.approvalPolicy ?? 'on-request', hooksEnabled: this.context.hooksEnabled ?? false, confirmed: true })
  }
  async approve(requestId: string, decision: 'accept' | 'decline'): Promise<void> {
    await this.respondRequest(requestId, { decision })
  }
  async respondRequest(requestId: string, response: ThreadRequestResponse): Promise<void> {
    const pending = this.approvals.get(requestId)
    if (!pending || !this.transport) throw Error('Request is no longer pending')
    const answers = Object.entries(response.answers ?? {}).map(([id, values]) => {
      const question = pending.questions?.get(id)
      if (!question) throw Error('Unknown question. Reopen the active request.')
      // AskUserQuestion takes one string per question: the chosen labels, or the person's own text, joined like the CLI does.
      return [question, values.map(value => value.trim()).filter(Boolean).join(', ')]
    })
    if (pending.questions && response.answers && [...pending.questions.keys()].some(id => !response.answers![id]?.some(value => value.trim()))) throw Error('Answer every question before sending.')
    const updatedInput = pending.toolName === 'AskUserQuestion' ? { ...pending.input, answers: Object.fromEntries(answers) } : pending.input
    const accept = response.decision ? ['accept', 'acceptForSession'].includes(response.decision) : Boolean(response.answers)
    this.transport.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: accept ? { behavior: 'allow', updatedInput, ...(response.decision === 'acceptForSession' && pending.suggestions?.length ? { updatedPermissions: pending.suggestions } : {}), ...(pending.toolUseId ? { toolUseID: pending.toolUseId } : {}) } : { behavior: 'deny', message: response.reason?.slice(0, 1000) || (response.decision === 'cancel' ? 'Cancelled by the user' : 'Declined by the user') } } }) + '\n')
    this.approvals.delete(requestId)
    this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome(pending.toolName === 'AskUserQuestion' ? 'question' : 'approval', response), resolvedAt: Date.now() })
    this.emit({ type: 'approval-resolved', id: requestId })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.initialized?.reject(Error('Agent connection disposed'))
    for (const requestId of [...this.pendingContext.keys()]) this.settleContext(requestId, null)
    for (const requestId of [...this.pendingControl.keys()]) this.settleControl(requestId, DISPOSED)
    this.busy = false
    this.approvals.clear()
    await this.transport?.close()
    this.transport = null
  }

  private markTaskUnknown(taskId: string): void {
    for (const [id, task] of this.tasks) if (task.state === 'running' && task.receiverThreadIds.includes(taskId)) {
      const unknown = { ...task, state: 'unknown' as const, completedAt: Date.now(), agents: task.agents.map(agent => ({ ...agent, status: 'unknown' as const })) }
      this.tasks.set(id, unknown)
      this.emit(unknown)
    }
  }

  private markTasksUnknown(): void {
    for (const [id, task] of this.tasks) if (task.state === 'running') {
      const unknown = { ...task, state: 'unknown' as const, agents: task.agents.map(agent => ({ ...agent, status: 'unknown' as const })) }
      this.tasks.set(id, unknown)
      this.emit(unknown)
    }
  }
}

const MCP_STATUSES = new Set(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])
/** `system/init` lists each configured MCP server with its startup status. */
export function mcpServerStatuses(value: unknown[]): ThreadMcpServerStatus[] {
  return value.slice(0, 100).flatMap(item => {
    const entry = record(item)
    const name = typeof entry.name === 'string' ? entry.name.slice(0, 120) : ''
    const status = typeof entry.status === 'string' && MCP_STATUSES.has(entry.status) ? entry.status as ThreadMcpServerStatus['status'] : 'unknown'
    return name ? [{ name, status }] : []
  })
}

/**
 * The directory named in an EnterWorktree result. Claude Code 2.1 writes "Created worktree at <path> on branch
 * <name>. …"; that path is read whole, spaces included (a profile such as C:\Users\Jane Doe). Other wording
 * falls back to the first absolute path. The orchestrator keeps the result only if it is an existing checkout.
 */
export function enteredWorktreePath(text: string): string | null {
  const stated = /worktree at (.+?) on branch /i.exec(text)
  if (stated) return stated[1].trim()
  const match = /([A-Za-z]:[\\/][^\s"'`<>|]+|(?<![\w.])\/[^\s"'`<>|]+)/.exec(text)
  return match ? match[1].replace(/[.,;:)\]]+$/, '') : null
}
