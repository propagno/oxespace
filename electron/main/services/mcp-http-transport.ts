import type { McpHttpConfig } from '../../../shared/types/mcp'

export type McpFetch = (input: string, init: RequestInit) => Promise<Response>

export const MCP_HTTP_PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DELETE_TIMEOUT_MS = 3_000
const MAX_SSE_BUFFER_BYTES = 5 * 1024 * 1024

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'fd00:ec2::254',
  '[fd00:ec2::254]'
])

/**
 * Validates an MCP HTTP/SSE URL against non-http(s) schemes, embedded credentials,
 * and cloud metadata SSRF targets.
 */
export function validateMcpHttpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new McpHttpTransportError('MCP server URL is required.')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new McpHttpTransportError('MCP server URL is invalid.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new McpHttpTransportError(`Unsupported MCP URL scheme "${parsed.protocol}". Only http and https are allowed.`)
  }
  if (parsed.username || parsed.password) {
    throw new McpHttpTransportError('MCP server URL must not contain embedded credentials.')
  }
  const host = parsed.hostname.toLowerCase()
  if (!host || BLOCKED_HOSTS.has(host) || /^169\.254\./.test(host)) {
    throw new McpHttpTransportError('MCP server URL targets a blocked address.')
  }
  return parsed
}

export class McpHttpTransportError extends Error {
  constructor(message: string, readonly code?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpHttpTransportError'
  }
}

export class McpHttpAuthError extends McpHttpTransportError {
  constructor(
    message: string,
    readonly status: number,
    readonly wwwAuthenticate: string | null = null,
    readonly hadAuthorization = false
  ) {
    super(message, status)
    this.name = 'McpHttpAuthError'
  }
}

export interface McpHttpInitializeResult {
  protocolVersion: string
  serverInfo?: { name?: string; version?: string }
  capabilities?: Record<string, unknown>
}

export interface McpHttpClient {
  readonly transport: 'http' | 'sse'
  readonly sessionId: string | null
  connect(timeoutMs?: number): Promise<McpHttpInitializeResult>
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params?: unknown): Promise<void>
  close(): Promise<void>
}

export interface McpHttpClientOptions {
  fetchImpl?: McpFetch
  /** Dynamic Authorization header provider (e.g. from OS keychain OAuth tokens). Never logged. */
  getAuthHeader?: () => Promise<string | null>
  clientInfo?: { name: string; version: string }
}

interface JsonRpcReply {
  id?: unknown
  result?: unknown
  error?: { message?: string; code?: number; data?: unknown }
}

/** Extracts `resource_metadata="..."` from an RFC 9728 WWW-Authenticate header if present. */
export function parseWwwAuthenticateResourceMetadata(header: string | null): string | null {
  if (!header) return null
  const match = /resource_metadata="([^"]+)"/i.exec(header)
  return match?.[1] ?? null
}

function hasAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some(name => name.toLowerCase() === 'authorization')
}

async function buildRequestHeaders(
  baseHeaders: Record<string, string> | undefined,
  getAuthHeader: (() => Promise<string | null>) | undefined,
  extra: Record<string, string>
): Promise<{ headers: Record<string, string>; hasAuth: boolean }> {
  const merged: Record<string, string> = { ...(baseHeaders ?? {}) }
  let hasAuth = hasAuthorizationHeader(merged)
  if (!hasAuth && getAuthHeader) {
    const authValue = await getAuthHeader()
    if (authValue) {
      merged.Authorization = authValue
      hasAuth = true
    }
  }
  return { headers: { ...merged, ...extra }, hasAuth }
}

function combineSignals(controller: AbortController, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new Error('timeout')), timeoutMs)
  const onParentAbort = () => timeoutController.abort(controller.signal.reason)
  if (controller.signal.aborted) {
    timeoutController.abort(controller.signal.reason)
  } else {
    controller.signal.addEventListener('abort', onParentAbort, { once: true })
  }
  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onParentAbort)
    }
  }
}

/**
 * Native MCP Streamable HTTP transport (spec 2025-06-18).
 * - Sends JSON-RPC 2.0 POST with `Accept: application/json, text/event-stream`
 * - Tracks `Mcp-Session-Id` header across calls
 * - Parses JSON and SSE response streams
 * - Sends `DELETE` with `Mcp-Session-Id` on close()
 */
export class McpStreamableHttpTransport implements McpHttpClient {
  readonly transport = 'http' as const
  private readonly url: string
  private readonly fetchImpl: McpFetch
  private readonly controller = new AbortController()
  private readonly clientInfo: { name: string; version: string }
  private _sessionId: string | null = null
  private requestSeq = 0
  private closed = false

  constructor(private readonly config: McpHttpConfig, private readonly options: McpHttpClientOptions = {}) {
    this.url = validateMcpHttpUrl(config.url).toString()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.clientInfo = options.clientInfo ?? { name: 'oxespace', version: '0.1.0' }
  }

  get sessionId(): string | null {
    return this._sessionId
  }

  async connect(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<McpHttpInitializeResult> {
    const init = await this.request<McpHttpInitializeResult>('initialize', {
      protocolVersion: MCP_HTTP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      clientInfo: this.clientInfo
    }, timeoutMs)
    if (!init || typeof init.protocolVersion !== 'string') {
      throw new McpHttpTransportError('Invalid initialize response from remote MCP server.')
    }
    await this.notify('notifications/initialized', {})
    return init
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed) throw new McpHttpTransportError('MCP HTTP transport is closed.')
    const id = ++this.requestSeq
    const { headers, hasAuth } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_HTTP_PROTOCOL_VERSION,
      ...(this._sessionId ? { 'Mcp-Session-Id': this._sessionId } : {})
    })
    const { signal, cleanup } = combineSignals(this.controller, timeoutMs)
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal
      })
      if (response.status === 401 || response.status === 403) {
        const wwwAuth = response.headers.get('www-authenticate')
        throw new McpHttpAuthError(
          hasAuth
            ? `The server refused the token (HTTP ${response.status}). Reconnect OAuth or check scopes.`
            : `Authentication required (HTTP ${response.status}).`,
          response.status,
          wwwAuth,
          hasAuth
        )
      }
      if (!response.ok) {
        throw new McpHttpTransportError(`MCP "${method}" failed with HTTP ${response.status}.`, response.status)
      }
      const nextSession = response.headers.get('mcp-session-id')
      if (nextSession) this._sessionId = nextSession
      const reply = await readStreamableReply(response, id)
      if (reply.error) {
        throw new McpHttpTransportError(reply.error.message ?? `MCP error (code ${reply.error.code ?? 'unknown'})`, reply.error.code)
      }
      return reply.result as T
    } catch (err) {
      if (err instanceof McpHttpTransportError) throw err
      if (signal.aborted) {
        throw new McpHttpTransportError(this.closed ? 'MCP HTTP transport closed.' : `MCP request "${method}" timed out.`)
      }
      throw new McpHttpTransportError(`Could not reach MCP server: ${err instanceof Error ? err.message : String(err)}`, undefined, { cause: err })
    } finally {
      cleanup()
    }
  }

  async notify(method: string, params: unknown = {}): Promise<void> {
    if (this.closed) return
    const { headers } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_HTTP_PROTOCOL_VERSION,
      ...(this._sessionId ? { 'Mcp-Session-Id': this._sessionId } : {})
    })
    const { signal, cleanup } = combineSignals(this.controller, DEFAULT_CONNECT_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal
      })
      const nextSession = response.headers.get('mcp-session-id')
      if (nextSession) this._sessionId = nextSession
      void response.body?.cancel().catch(() => undefined)
    } catch {
      // Best-effort for notifications
    } finally {
      cleanup()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const session = this._sessionId
    this._sessionId = null
    this.controller.abort(new Error('closed'))
    if (!session) return
    try {
      const { headers } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
        'Mcp-Session-Id': session,
        'MCP-Protocol-Version': MCP_HTTP_PROTOCOL_VERSION
      })
      const deleteController = new AbortController()
      const timer = setTimeout(() => deleteController.abort(), DELETE_TIMEOUT_MS)
      try {
        await this.fetchImpl(this.url, { method: 'DELETE', headers, signal: deleteController.signal })
      } finally {
        clearTimeout(timer)
      }
    } catch {
      // Session cleanup is best-effort
    }
  }
}

/**
 * Native Legacy SSE MCP transport (2024-11-05):
 * - Opens GET SSE stream (`Accept: text/event-stream`)
 * - Receives `event: endpoint` with the POST URL (validated against SSRF & scheme)
 * - Sends JSON-RPC calls via POST to the announced endpoint and resolves replies from `event: message`
 */
export class McpLegacySseTransport implements McpHttpClient {
  readonly transport = 'sse' as const
  readonly sessionId: string | null = null
  private readonly baseUrl: URL
  private readonly fetchImpl: McpFetch
  private readonly controller = new AbortController()
  private readonly clientInfo: { name: string; version: string }
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>()
  private postEndpoint: string | null = null
  private requestSeq = 0
  private closed = false
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null

  constructor(private readonly config: McpHttpConfig, private readonly options: McpHttpClientOptions = {}) {
    this.baseUrl = validateMcpHttpUrl(config.url)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.clientInfo = options.clientInfo ?? { name: 'oxespace', version: '0.1.0' }
  }

  async connect(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS): Promise<McpHttpInitializeResult> {
    const { headers, hasAuth } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
      Accept: 'text/event-stream'
    })
    const { signal, cleanup } = combineSignals(this.controller, timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl.toString(), {
        method: 'GET',
        headers,
        signal
      })
    } catch (err) {
      cleanup()
      if (signal.aborted) throw new McpHttpTransportError('Timed out opening SSE stream.')
      throw new McpHttpTransportError(`Could not reach SSE MCP server: ${err instanceof Error ? err.message : String(err)}`, undefined, { cause: err })
    }
    cleanup()
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => undefined)
      throw new McpHttpAuthError(
        hasAuth
          ? `The server refused the token (HTTP ${response.status}). Reconnect OAuth or check scopes.`
          : `Authentication required (HTTP ${response.status}).`,
        response.status,
        response.headers.get('www-authenticate'),
        hasAuth
      )
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new McpHttpTransportError(`SSE stream failed with HTTP ${response.status}.`, response.status)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new McpHttpTransportError('Empty SSE stream from MCP server.')
    this.streamReader = reader

    // Wait for `event: endpoint` while pumping the SSE stream in the background.
    const endpointPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new McpHttpTransportError('SSE server did not announce an endpoint in time.')), timeoutMs)
      this.pumpSseStream(reader, endpoint => {
        clearTimeout(timer)
        resolve(endpoint)
      }, err => {
        clearTimeout(timer)
        reject(err)
      })
    })
    const endpoint = await endpointPromise
    this.postEndpoint = endpoint

    const init = await this.request<McpHttpInitializeResult>('initialize', {
      protocolVersion: MCP_HTTP_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      clientInfo: this.clientInfo
    }, timeoutMs)
    if (!init || typeof init.protocolVersion !== 'string') {
      throw new McpHttpTransportError('Invalid initialize response from SSE MCP server.')
    }
    await this.notify('notifications/initialized', {})
    return init
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.closed || !this.postEndpoint) throw new McpHttpTransportError('SSE MCP transport is not connected.')
    const id = ++this.requestSeq
    const { headers, hasAuth } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    })

    const waitForReply = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new McpHttpTransportError(`MCP request "${method}" timed out.`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    })

    const { signal, cleanup } = combineSignals(this.controller, timeoutMs)
    try {
      const response = await this.fetchImpl(this.postEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal
      })
      if (response.status === 401 || response.status === 403) {
        this.rejectPending(id, new McpHttpAuthError(
          hasAuth ? `The server refused the token (HTTP ${response.status}).` : `Authentication required (HTTP ${response.status}).`,
          response.status,
          response.headers.get('www-authenticate'),
          hasAuth
        ))
        return await waitForReply
      }
      if (!response.ok) {
        this.rejectPending(id, new McpHttpTransportError(`MCP "${method}" failed with HTTP ${response.status}.`, response.status))
        return await waitForReply
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const direct = await response.json().catch(() => null) as JsonRpcReply | null
        if (direct && direct.id === id) {
          this.resolveReply(direct)
        }
      } else {
        void response.body?.cancel().catch(() => undefined)
      }
    } catch (err) {
      this.rejectPending(id, err instanceof McpHttpTransportError ? err : new McpHttpTransportError(`Could not POST to SSE endpoint: ${err instanceof Error ? err.message : String(err)}`))
    } finally {
      cleanup()
    }

    return await waitForReply
  }

  async notify(method: string, params: unknown = {}): Promise<void> {
    if (this.closed || !this.postEndpoint) return
    const { headers } = await buildRequestHeaders(this.config.headers, this.options.getAuthHeader, {
      'Content-Type': 'application/json'
    })
    const { signal, cleanup } = combineSignals(this.controller, DEFAULT_CONNECT_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(this.postEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal
      })
      void response.body?.cancel().catch(() => undefined)
    } catch {
      // Best-effort for notifications
    } finally {
      cleanup()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.controller.abort(new Error('closed'))
    const reader = this.streamReader
    this.streamReader = null
    if (reader) void reader.cancel().catch(() => undefined)
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new McpHttpTransportError('MCP SSE transport closed.'))
      this.pending.delete(id)
    }
  }

  private rejectPending(id: number, error: Error): void {
    const entry = this.pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(id)
    entry.reject(error)
  }

  private resolveReply(message: JsonRpcReply): void {
    if (typeof message.id !== 'number') return
    const entry = this.pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(message.id)
    if (message.error) {
      entry.reject(new McpHttpTransportError(message.error.message ?? `MCP error (code ${message.error.code ?? 'unknown'})`, message.error.code))
    } else {
      entry.resolve(message.result)
    }
  }

  private pumpSseStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onEndpoint: (url: string) => void,
    onEndpointError: (err: Error) => void
  ): void {
    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let dataLines: string[] = []
    let resolvedEndpoint = false

    const dispatchEvent = (): void => {
      if (dataLines.length === 0) {
        eventName = 'message'
        return
      }
      const payload = dataLines.join('\n')
      const kind = eventName
      eventName = 'message'
      dataLines = []

      if (kind === 'endpoint' && !resolvedEndpoint) {
        try {
          const resolved = new URL(payload.trim(), this.baseUrl)
          const validated = validateMcpHttpUrl(resolved.toString())
          // Enforce same-origin to prevent an untrusted SSE endpoint event from pivoting requests.
          if (validated.origin !== this.baseUrl.origin) {
            throw new McpHttpTransportError('SSE endpoint origin does not match server origin.')
          }
          resolvedEndpoint = true
          onEndpoint(validated.toString())
        } catch (err) {
          resolvedEndpoint = true
          onEndpointError(err instanceof Error ? err : new McpHttpTransportError(String(err)))
        }
        return
      }

      if (kind === 'message') {
        try {
          const parsed = JSON.parse(payload) as JsonRpcReply
          this.resolveReply(parsed)
        } catch {
          // Ignore non-JSON keepalive / comment events
        }
      }
    }

    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline: number
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).replace(/\r$/, '')
            buffer = buffer.slice(newline + 1)
            if (line.startsWith(':')) continue
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim() || 'message'
              continue
            }
            if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart())
              continue
            }
            if (line === '') dispatchEvent()
          }
          if (buffer.length > MAX_SSE_BUFFER_BYTES) {
            buffer = ''
            dataLines = []
          }
        }
        dispatchEvent()
        if (!resolvedEndpoint) {
          onEndpointError(new McpHttpTransportError('SSE stream ended before announcing an endpoint.'))
        }
      } catch (err) {
        if (!resolvedEndpoint) {
          onEndpointError(err instanceof Error ? err : new McpHttpTransportError(String(err)))
        }
      } finally {
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer)
          entry.reject(new McpHttpTransportError('MCP SSE stream closed.'))
          this.pending.delete(id)
        }
      }
    })()
  }
}

export function createMcpHttpClient(config: McpHttpConfig, options: McpHttpClientOptions = {}): McpHttpClient {
  return config.transport === 'sse'
    ? new McpLegacySseTransport(config, options)
    : new McpStreamableHttpTransport(config, options)
}

/** Reads either an `application/json` response or a `text/event-stream` response matching request `id`. */
async function readStreamableReply(response: Response, id: number): Promise<JsonRpcReply> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const parsed = await response.json() as JsonRpcReply | JsonRpcReply[]
    if (Array.isArray(parsed)) {
      const matched = parsed.find(entry => entry && entry.id === id)
      if (!matched) throw new McpHttpTransportError('JSON-RPC batch response did not include matching id.')
      return matched
    }
    return parsed
  }
  const reader = response.body?.getReader()
  if (!reader) throw new McpHttpTransportError('Empty event stream.')
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart())
          continue
        }
        if (line !== '' || data.length === 0) continue
        const payload = data.join('\n')
        data = []
        let message: JsonRpcReply | null = null
        try { message = JSON.parse(payload) as JsonRpcReply } catch { /* ignore non-JSON event */ }
        if (message && message.id === id) return message
      }
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new McpHttpTransportError('MCP event stream exceeded buffer limit.')
      }
    }
    if (data.length > 0) {
      try {
        const message = JSON.parse(data.join('\n')) as JsonRpcReply
        if (message && message.id === id) return message
      } catch { /* ignore */ }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  throw new McpHttpTransportError('The event stream ended without a matching response.')
}
