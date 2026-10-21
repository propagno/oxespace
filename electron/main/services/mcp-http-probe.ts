import type { McpHttpConfig, McpToolDescriptor } from '../../../shared/types/mcp'

/**
 * What a remote server answered when OXESpace tested it. A server that wants a
 * sign-in is not broken: the agent signs in on first use (Claude Code opens the
 * browser), so `needs-auth` is reported as its own outcome.
 */
export type McpHttpProbeResult =
  | { status: 'healthy'; tools: McpToolDescriptor[] }
  | { status: 'reachable' }
  | { status: 'needs-auth' }

type Fetch = (input: string, init: RequestInit) => Promise<Response>

const PROTOCOL_VERSION = '2025-06-18'
const PROBE_TIMEOUT_MS = 15_000

export class McpHttpError extends Error {}

/**
 * Tests a remote server once and lets it go: Streamable HTTP gets the full
 * handshake and the tool list; legacy SSE only has its stream opened, because
 * its replies arrive on that stream and a reachability check is what the panel
 * needs. Header values are sent as stored and never logged.
 */
export async function probeHttpServer(config: McpHttpConfig, fetchImpl: Fetch = fetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<McpHttpProbeResult> {
  const signal = AbortSignal.timeout(timeoutMs)
  const signedIn = Object.keys(config.headers ?? {}).some(name => name.toLowerCase() === 'authorization')
  const refused = (response: Response): McpHttpProbeResult => {
    if (signedIn) throw new McpHttpError(`The server refused the token (HTTP ${response.status}). Check the token and its scopes.`)
    return { status: 'needs-auth' }
  }
  try {
    if (config.transport === 'sse') {
      const response = await fetchImpl(config.url, { method: 'GET', headers: { ...config.headers, Accept: 'text/event-stream' }, signal })
      if (response.status === 401 || response.status === 403) return refused(response)
      if (!response.ok) throw new McpHttpError(`The server answered HTTP ${response.status}.`)
      void response.body?.cancel().catch(() => undefined)
      return { status: 'reachable' }
    }
    let session: string | null = null
    let seq = 0
    const post = async (body: Record<string, unknown>): Promise<Response> => fetchImpl(config.url, {
      method: 'POST',
      headers: { ...config.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL_VERSION, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
      signal
    })
    const call = async <T>(method: string, params: unknown): Promise<T | Response> => {
      const id = ++seq
      const response = await post({ id, method, params })
      if (response.status === 401 || response.status === 403) return response
      if (!response.ok) throw new McpHttpError(`"${method}" failed with HTTP ${response.status}.`)
      session = response.headers.get('mcp-session-id') ?? session
      const reply = await readReply(response, id)
      if (reply.error) throw new McpHttpError(reply.error.message ?? `MCP error (code ${reply.error.code ?? 'unknown'})`)
      return reply.result as T
    }
    const init = await call<{ protocolVersion?: unknown }>('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'oxespace', version: '0.1.0' } })
    if (init instanceof Response) return refused(init)
    if (typeof init?.protocolVersion !== 'string') throw new McpHttpError('Invalid initialize response.')
    await post({ method: 'notifications/initialized' })
    const listed = await call<{ tools?: McpToolDescriptor[] }>('tools/list', {})
    if (listed instanceof Response) return refused(listed)
    if (session) void fetchImpl(config.url, { method: 'DELETE', headers: { ...config.headers, 'Mcp-Session-Id': session }, signal }).catch(() => undefined)
    return { status: 'healthy', tools: Array.isArray(listed?.tools) ? listed.tools : [] }
  } catch (err) {
    if (err instanceof McpHttpError) throw err
    if (signal.aborted) throw new McpHttpError('The server did not answer in time.')
    throw new McpHttpError(`Could not reach the server: ${err instanceof Error ? err.message : String(err)}`)
  }
}

interface Reply { id?: unknown; result?: unknown; error?: { message?: string; code?: number } }

/** A JSON body, or the event of an SSE stream that answers request `id`. */
async function readReply(response: Response, id: number): Promise<Reply> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream')) return await response.json() as Reply
  const reader = response.body?.getReader()
  if (!reader) throw new McpHttpError('Empty event stream.')
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
        if (line.startsWith('data:')) { data.push(line.slice(5).trimStart()); continue }
        if (line !== '' || !data.length) continue
        let message: Reply | null = null
        try { message = JSON.parse(data.join('\n')) as Reply } catch { /* not JSON-RPC */ }
        data = []
        if (message && message.id === id) return message
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  throw new McpHttpError('The event stream ended without an answer.')
}
