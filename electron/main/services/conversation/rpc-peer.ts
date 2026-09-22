import { JsonLinesDecoder } from './json-lines'
import { ThreadAgentError, threadFailure } from './thread-failure'

export interface AgentRpcMessage {
  id?: string | number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Correlates a single adapter connection. It never approves server requests. */
export class AgentRpcPeer {
  private sequence = 0
  private closed = false
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private readonly decoder: JsonLinesDecoder

  constructor(
    private readonly write: (line: string) => void,
    private readonly notification: (message: AgentRpcMessage) => void,
    private readonly serverRequest: (message: AgentRpcMessage) => void,
    private readonly timeoutMs = 30_000
  ) {
    this.decoder = new JsonLinesDecoder(value => this.receive(value as AgentRpcMessage))
  }

  push(chunk: Uint8Array): void {
    try { this.decoder.push(chunk) } catch (error) {
      this.close(error instanceof Error ? error.message : 'Agent protocol failure')
      throw error
    }
  }

  request(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Agent connection is closed'))
    if (this.pending.size >= 64) return Promise.reject(new Error('Too many pending agent requests'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Agent request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('Could not write to agent connection'))
      }
    })
  }

  notify(method: string, params?: unknown): void { this.send({ method, params }) }
  respond(id: string | number, result: unknown): void { this.send({ id, result }) }
  rejectRequest(id: string | number): void {
    this.send({ id, error: { code: -32601, message: 'Host request is not supported' } })
  }

  close(reason = 'Agent connection closed'): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private send(message: AgentRpcMessage): void {
    if (this.closed) throw new Error('Agent connection is closed')
    this.write(JSON.stringify(message) + '\n')
  }

  private receive(message: AgentRpcMessage): void {
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        if (typeof message.id !== 'number' && typeof message.id !== 'string') throw new Error('Invalid agent request identifier')
        this.serverRequest(message)
      } else this.notification(message)
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return // stale response after timeout, never another turn's response
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      const data = message.error.data && typeof message.error.data === 'object' ? message.error.data as Record<string, unknown> : {}
      pending.reject(new ThreadAgentError(threadFailure({ message: message.error.message, codexErrorInfo: data.codexErrorInfo, httpStatusCode: data.httpStatusCode }), 'Agent rejected the request'))
    }
    else if ('result' in message) pending.resolve(message.result)
    else pending.reject(new Error('Invalid agent response'))
  }
}
