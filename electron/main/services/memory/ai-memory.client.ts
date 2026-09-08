/** AI Memory v2.1: stateless Streamable HTTP. No active-project fallbacks. */
export class AiMemoryClient {
  private nextId = 0
  constructor(readonly url: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Initial memory integration requires an explicit loopback HTTP URL')
    }
  }

  async request(path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.url.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(2500), redirect: 'error'
    })
    if (!response.ok) throw new Error(`AI Memory HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error('AI Memory response too large') }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : null
  }

  async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request('/mcp', { jsonrpc: '2.0', id: ++this.nextId, method: 'tools/call', params: { name, arguments: args } }) as {
      error?: { message: string }; result?: { isError?: boolean; content?: { type: string; text?: string }[] }
    }
    if (result.error || result.result?.isError) throw new Error('AI Memory operation rejected')
    const text = result.result?.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') ?? ''
    try { return JSON.parse(text) } catch { return text }
  }

  async initialize(): Promise<void> {
    const result = await this.request('/mcp', { jsonrpc: '2.0', id: ++this.nextId, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oxespace-memory', version: '1.0.0' }
    } }) as { error?: unknown }
    if (result.error) throw new Error('AI Memory MCP handshake rejected')
    await this.request('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })
  }
}
