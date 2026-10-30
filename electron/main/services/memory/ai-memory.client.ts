import type { MemoryCapabilities, MemoryErrorCode } from '../../../../shared/types/memory'
import type { MemoryDelivery } from './memory-outbox'

/** Never retain remote errors, credentials or request payloads in diagnostics. */
export class MemoryClientError extends Error {
  /** `detail` is what the server said, kept short; it explains a rejection in logs and test output. */
  constructor(readonly code: MemoryErrorCode, readonly status?: number, readonly detail?: string) {
    super(`AI Memory ${code}${status === undefined ? '' : ` (HTTP ${status})`}${detail ? `: ${detail}` : ''}`)
    this.name = 'MemoryClientError'
  }
}
function errorDetail(value: unknown): string | undefined {
  const error = object(value)
  const text = Array.isArray(value) ? value.map(item => object(item)?.text).filter(text => typeof text === 'string').join(' ')
    : typeof error?.message === 'string' ? `${error.message}${error.code !== undefined ? ` (${String(error.code)})` : ''}` : ''
  return text ? text.replace(/\s+/g, ' ').slice(0, 300) : undefined
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Stateless Streamable HTTP. No active-project fallbacks. */
export class AiMemoryClient {
  private nextId = 0
  constructor(readonly url: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch, private readonly signal?: AbortSignal) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Initial memory integration requires an explicit loopback HTTP URL')
    }
  }

  withSignal(signal: AbortSignal): AiMemoryClient { return new AiMemoryClient(this.url, this.token, this.fetcher, signal) }

  /** Batch errors may still acknowledge a prefix or individual indices. */
  async hookBatch(items: MemoryDelivery[], signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
    if (items.length < 1 || items.length > 64) throw new MemoryClientError('protocol')
    const deadline = AbortSignal.timeout(5000)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
      const response = await this.fetcher(`${this.url.replace(/\/$/, '')}/hook/batch`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(items), signal: combined, redirect: 'error'
      })
      const length = Number(response.headers.get('content-length') || 0)
      if (length > 1024 * 1024) { await response.body?.cancel(); throw new MemoryClientError('response-too-large') }
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) throw new MemoryClientError('response-too-large')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: unknown = null
      if (raw) { try { body = JSON.parse(raw) } catch { throw new MemoryClientError('protocol') } }
      return { status: response.status, body }
    } catch (error) {
      if (error instanceof MemoryClientError) throw error
      if (signal?.aborted) throw new MemoryClientError('cancelled')
      if (deadline.aborted) throw new MemoryClientError('timeout')
      throw new MemoryClientError('transport')
    }
  }

  async request(path: string, body?: unknown, signal: AbortSignal | undefined = this.signal): Promise<unknown> {
    const deadline = AbortSignal.timeout(2500)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      combined.throwIfAborted()
      const response = await this.fetcher(`${this.url.replace(/\/$/, '')}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined, redirect: 'error'
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new MemoryClientError([401, 403].includes(response.status) ? 'authentication' : 'http', response.status)
      }
      reader = response.body?.getReader()
      if (!reader) return null
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        combined.throwIfAborted()
        if (done) break
        size += value.byteLength
        if (size > 1024 * 1024) throw new MemoryClientError('response-too-large')
        chunks.push(value)
      }
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return null
      try { return JSON.parse(text) } catch { throw new MemoryClientError('protocol') }
    } catch (error) {
      if (error instanceof MemoryClientError) throw error
      if (signal?.aborted) throw new MemoryClientError('cancelled')
      if (deadline.aborted) throw new MemoryClientError('timeout')
      throw new MemoryClientError('transport')
    } finally {
      if (reader) {
        try { await reader.cancel() } catch { /* aborted or already closed */ }
        reader.releaseLock()
      }
    }
  }

  private async rpc(method: string, params: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const id = ++this.nextId
    const envelope = object(await this.request('/mcp', { jsonrpc: '2.0', id, method, params }, signal))
    if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== id) throw new MemoryClientError('protocol')
    if (envelope.error !== undefined) throw new MemoryClientError('rejected', undefined, errorDetail(envelope.error))
    const result = object(envelope.result)
    if (!result) throw new MemoryClientError('protocol')
    return result
  }

  async tool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const result = await this.rpc('tools/call', { name, arguments: args }, signal)
    if (result.isError === true) throw new MemoryClientError('rejected', undefined, errorDetail(result.content))
    if (!Array.isArray(result.content)) throw new MemoryClientError('protocol')
    const text = result.content.map(object).filter(c => c?.type === 'text').map(c => {
      if (typeof c?.text !== 'string') throw new MemoryClientError('protocol')
      return c.text
    }).join('\n')
    try { return JSON.parse(text) } catch { return text }
  }

  async capabilities(signal?: AbortSignal): Promise<MemoryCapabilities> {
    const result = await this.rpc('tools/list', {}, signal)
    if (!Array.isArray(result.tools)) throw new MemoryClientError('protocol')
    const tools = result.tools.map(object)
    if (tools.some(tool => !tool || typeof tool.name !== 'string')) throw new MemoryClientError('protocol')
    const accept = tools.find(tool => tool?.name === 'memory_handoff_accept')
    const properties = object(object(accept?.inputSchema)?.properties)
    return { exactHandoff: properties?.handoff_id !== undefined,
      createHandoff: tools.some(tool => tool?.name === 'memory_handoff_begin'),
      sessionObservations: tools.some(tool => tool?.name === 'memory_read_session_observations'),
      deletePage: object(object(tools.find(tool => tool?.name === 'memory_delete_page')?.inputSchema)?.properties)?.path !== undefined }
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const result = await this.rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oxespace-memory', version: '1.0.0' }
    }, signal)
    if (typeof result.protocolVersion !== 'string' || !object(result.capabilities)) throw new MemoryClientError('protocol')
    await this.request('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, signal)
  }
}
