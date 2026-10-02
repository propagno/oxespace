import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AgentConversationAdapter, ConversationProtocolEvidence, ThreadAgentInput, ThreadEvent, ThreadConfiguration, ThreadFileChange, ThreadAttachment, ThreadRequestResponse } from '../../../../shared/types/thread'
import type { ConversationTransport } from './codex-conversation'
import { JsonLinesDecoder } from './json-lines'
import { CLAUDE_THREAD_ARGS, claudeRuntimeCatalog } from './claude-command-catalog'
import { threadFailure } from './thread-failure'
import { requestOutcome } from '../../../../shared/threadRequestOutcome'

type PrintTransport = ConversationTransport & { endInput(): void }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Official persistent print+stream-json transport, explicit resume after disconnection. */
export class ClaudeConversationAdapter implements AgentConversationAdapter {
  readonly capabilities = { resume: true, approvals: true, attachments: true, modelSelection: true, questions: true, permissions: false, elicitation: false, queue: false, steering: false, nativeSessions: true }
  readonly evidence: ConversationProtocolEvidence = { transport: 'claude-print-stream-json', verified: 'fixture' }
  private context: ({ rootPath: string; nativeSessionId: string | null } & ThreadConfiguration) | null = null
  private approvals = new Map<string, { input: Record<string, unknown>; toolName: string }>()
  private emit: (event: ThreadEvent) => void = () => {}
  private transport: PrintTransport | null = null
  private disposed = false
  private busy = false
  private fileTools = new Map<string, ThreadFileChange[]>()
  private todoTools = new Map<string, Extract<ThreadEvent, { type: 'plan' }>['steps']>()

  constructor(private readonly createTransport: (args: string[], cwd: string) => PrintTransport) {}
  async start(context: { rootPath: string; nativeSessionId: string | null } & ThreadConfiguration, emit: (event: ThreadEvent) => void): Promise<void> {
    if (this.context || this.disposed) throw new Error('Conversation adapter cannot be started twice')
    this.context = { ...context }
    this.emit = emit
  }

  async send(text: string, _skill?: ThreadAgentInput['skill'], attachments: ThreadAttachment[] = []): Promise<void> {
    if (!this.context || this.disposed) throw new Error('Conversation is not connected')
    if (this.busy) throw new Error('A conversation turn is already running')
    if (!text.trim() || Buffer.byteLength(text) > 64 * 1024) throw new Error('Invalid conversation input')
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
    const permissionMode = this.context.mode === 'plan' ? 'plan' : this.context.access === 'full-access' ? 'bypassPermissions' : 'default'
    const settings = !writable
      ? '{"disableAllHooks":true,"disableSkillShellExecution":true}'
      : this.context.hooksEnabled ? undefined : '{"disableAllHooks":true}'
    const runtimeArgs = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', permissionMode, '--permission-prompts', 'host', '--tools', 'default', ...(settings ? ['--settings', settings] : [])]
    const args = [...runtimeArgs,
      ...(this.context.model ? ['--model', this.context.model] : []),
      ...(this.context.reasoningEffort ? ['--effort', this.context.reasoningEffort] : []),
      ...(this.context.nativeSessionId ? ['--resume', sessionId] : ['--session-id', sessionId])]
    let completed = false
    let answerShown = false
    let authenticationFailed = false
    let diagnostic = ''
    let lastNativeSignalAt = 0
    const selectedModel = text.trim().match(/^\/model\s+([a-z0-9][a-z0-9._:/\[\]-]*)$/i)?.[1]
    const finish = (status: 'completed' | 'failed' | 'interrupted') => {
      if (completed || this.disposed) return
      completed = true
      this.busy = false
      this.approvals.clear()
      if (status === 'completed' && selectedModel) {
        this.context!.model = selectedModel
        this.emit({ type: 'configuration', model: selectedModel })
      }
      const failure = status === 'failed' ? threadFailure({ message: diagnostic, ...(authenticationFailed ? { codexErrorInfo: 'authentication_failed' } : {}) }) : undefined
      this.emit({ type: 'completed', status, ...(failure ? { error: failure.message, errorCode: failure.code, failure } : {}) })
    }
    try {
      const fresh = !this.transport
      const transport = this.transport ??= this.createTransport(args, this.context.rootPath)
      const decoder = new JsonLinesDecoder(value => {
        const event = record(value)
        if (event.type === 'control_request' && typeof event.request_id === 'string') {
          const request = record(event.request)
          if (request.subtype === 'can_use_tool') {
            const input = record(request.input), toolName = String(request.tool_name || 'tool')
            this.approvals.set(event.request_id, { input, toolName })
            if (toolName === 'AskUserQuestion') {
              const questions = (Array.isArray(input.questions) ? input.questions : []).slice(0, 20).map(value => {
                const question = record(value)
                return { id: typeof question.id === 'string' ? question.id : randomUUID(), header: typeof question.header === 'string' ? question.header.slice(0, 80) : undefined,
                  question: typeof question.question === 'string' ? question.question.slice(0, 2000) : '', multiple: question.multiSelect === true,
                  options: (Array.isArray(question.options) ? question.options : []).slice(0, 20).map(value => ({ label: String(record(value).label || '').slice(0, 200), description: String(record(value).description || '').slice(0, 500) })) }
              }).filter(question => question.question)
              this.emit({ type: 'request', id: event.request_id, request: { id: event.request_id, nativeId: event.request_id, nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', generation: 0, createdAt: Date.now(), state: 'pending', questions } })
            } else {
              this.emit({ type: 'request', id: event.request_id, request: { id: event.request_id, nativeId: event.request_id, nativeMethod: `can_use_tool:${toolName}`, kind: 'approval', title: `Approve ${toolName}`, detail: JSON.stringify(input, null, 2).slice(0, 12000), generation: 0, createdAt: Date.now(), state: 'pending', availableDecisions: ['accept', 'decline'] } })
              this.emit({ type: 'approval', id: event.request_id, title: `Approve ${toolName}`, detail: JSON.stringify(input, null, 2).slice(0, 12000) })
            }
          } else transport.write(JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: event.request_id, error: 'Unsupported host request' } }) + '\n')
        } else if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
          const providerVersion = typeof event.claude_code_version === 'string' ? event.claude_code_version : typeof event.version === 'string' ? event.version : ''
          if (providerVersion) this.evidence.providerVersion = providerVersion.slice(0, 120)
          this.evidence.protocolVersion = 'stream-json'
          this.evidence.verified = 'native'
          this.context!.nativeSessionId = event.session_id
          this.emit({ type: 'session', nativeSessionId: event.session_id })
        } else if (event.type === 'stream_event') {
          const streamed = record(event.event)
          if (streamed.type === 'content_block_start') {
            const block = record(streamed.content_block)
            if (block.type === 'thinking' || block.type === 'text') this.emit({ type: 'activity', id: `claude:${localPlanId}:${block.type}`, phase: block.type === 'thinking' ? 'reasoning' : 'responding', at: Date.now() })
          }
        } else if (event.type === 'assistant') {
          const content = record(event.message).content
          if (!Array.isArray(content)) return
          const answer = content.filter(block => record(block).type === 'text').map(block => record(block).text).filter(value => typeof value === 'string').join('\n')
          if (event.error === 'authentication_failed' || /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(answer)) {
            authenticationFailed = true
            diagnostic = answer
            return
          }
          if (answer) { answerShown = true; this.emit({ type: 'message', id: typeof record(event.message).id === 'string' ? record(event.message).id as string : randomUUID(), role: 'assistant', text: answer }) }
          for (const block of content.map(record)) {
            if (block.type === 'tool_use' && typeof block.id === 'string') {
              const input = record(block.input), path = typeof input.file_path === 'string' ? input.file_path : ''
              if (block.name === 'TodoWrite' && Array.isArray(input.todos)) this.todoTools.set(block.id, input.todos.slice(0, 100).map(value => {
                const todo = record(value)
                return { label: typeof todo.content === 'string' ? todo.content.slice(0, 2000) : '', status: todo.status === 'completed' ? 'completed' as const : todo.status === 'in_progress' ? 'inProgress' as const : 'pending' as const }
              }).filter(todo => Boolean(todo.label)))
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
              this.emit({ type: 'tool', id: block.tool_use_id, name: 'Tool result', state: block.is_error ? 'failed' : 'completed', detail: '', output: typeof block.content === 'string' ? block.content.slice(0, 65536) : '', completedAt: Date.now(), ...(files ? { files } : {}) })
              this.fileTools.delete(block.tool_use_id)
              const steps = this.todoTools.get(block.tool_use_id)
              if (steps && !block.is_error) this.emit({ type: 'plan', id: `plan:${localPlanId}`, steps })
              this.todoTools.delete(block.tool_use_id)
            }
          }
        } else if (event.type === 'result') {
          diagnostic = [typeof event.result === 'string' && (event.is_error || authenticationFailed) ? event.result : '', ...(Array.isArray(event.errors) ? event.errors.filter(value => typeof value === 'string').slice(0, 10) : [])].filter(Boolean).join('\n').slice(0, 12000) || diagnostic
          if (typeof event.result === 'string' && /^Failed to authenticate:|^OAuth token (?:has expired|revoked)|^Not logged in/i.test(event.result)) authenticationFailed = true
          if (typeof event.session_id === 'string' && event.session_id !== this.context!.nativeSessionId) {
            this.context!.nativeSessionId = event.session_id
            this.emit({ type: 'session', nativeSessionId: event.session_id })
          }
          if (!answerShown && !authenticationFailed && !event.is_error && typeof event.result === 'string' && event.result) {
            this.emit({ type: 'message', id: randomUUID(), role: 'assistant', text: event.result.slice(0, 65536) })
          }
          finish(authenticationFailed || event.is_error === true || event.subtype !== 'success' ? 'failed' : 'completed')
        }
      })
      transport.onData(chunk => {
        if (completed || this.disposed || this.transport !== transport) return
        if (Date.now() - lastNativeSignalAt >= 2_000) {
          lastNativeSignalAt = Date.now()
          this.emit({ type: 'native-signal', at: lastNativeSignalAt })
        }
        try { decoder.push(chunk) } catch { diagnostic = 'Invalid agent protocol stream'; finish('failed'); void transport.close() }
      })
      transport.onClose(() => {
        if (this.transport !== transport) return
        if (!completed && !this.disposed) {
          try { decoder.finish() } catch { /* incomplete stream */ }
          if (!completed) { diagnostic ||= 'Agent connection closed before the turn completed'; finish('failed') }
        }
        if (this.transport === transport) this.transport = null
      })
      if (fresh) transport.write(JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize', hooks: {} } }) + '\n')
      const content: unknown = attachments.length ? [{ type: 'text', text }, ...(await Promise.all(attachments.map(async attachment => {
        if (!attachment.path) throw Error('Attachment is unavailable')
        return { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: (await readFile(attachment.path)).toString('base64') } }
      })))] : text
      transport.write(JSON.stringify({ type: 'user', session_id: this.context.nativeSessionId ?? sessionId, parent_tool_use_id: null, message: { role: 'user', content } }) + '\n')
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : diagnostic
      finish('failed')
      throw error
    }
  }

  async interrupt(): Promise<void> {
    if (!this.busy || !this.transport) return
    const transport = this.transport
    // Windows process-tree termination can truncate the native turn. Preserve
    // the native ID and explicitly label local state interrupted, never success.
    this.busy = false
    this.transport = null
    this.approvals.clear()
    this.emit({ type: 'completed', status: 'interrupted' })
    await transport.close()
  }
  async configure(configuration: ThreadConfiguration): Promise<void> {
    if (!this.context || this.busy || this.disposed) throw Error('Finish the active turn before applying configuration')
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
    const updatedInput = pending.toolName === 'AskUserQuestion' ? { ...pending.input, answers: Object.fromEntries(Object.entries(response.answers ?? {}).map(([id, values]) => [id, values.length > 1 ? values : values[0] ?? ''])) } : pending.input
    const accept = response.decision ? ['accept', 'acceptForSession'].includes(response.decision) : Boolean(response.answers)
    this.transport.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: accept ? { behavior: 'allow', updatedInput } : { behavior: 'deny', message: response.decision === 'cancel' ? 'Cancelled by the user' : 'Declined by the user' } } }) + '\n')
    this.approvals.delete(requestId)
    this.emit({ type: 'request-resolved', id: requestId, ...requestOutcome(pending.toolName === 'AskUserQuestion' ? 'question' : 'approval', response), resolvedAt: Date.now() })
    this.emit({ type: 'approval-resolved', id: requestId })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.busy = false
    this.approvals.clear()
    await this.transport?.close()
    this.transport = null
  }
}
