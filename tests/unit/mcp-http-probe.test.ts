import { describe, expect, it } from 'vitest'
import { probeHttpServer } from '../../electron/main/services/mcp-http-probe'

type Call = { method: string; headers: Record<string, string>; body: { method?: string } | null }

/** A fake remote server: `answer` replies to each JSON-RPC method by name. */
function server(answer: (method: string, call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    const call = { method: String(init.method), headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null }
    calls.push(call)
    return answer(call.body?.method ?? init.method ?? '', call)
  }
  return { calls, fetchImpl }
}

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } })

describe('testing a remote MCP server', () => {
  it('runs the handshake, keeps the session and lists the tools', async () => {
    const { calls, fetchImpl } = server((method) => {
      if (method === 'initialize') return json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }, { 'mcp-session-id': 's-1' })
      if (method === 'notifications/initialized' || method === 'DELETE') return new Response(null, { status: 202 })
      // Streamable HTTP may answer a request as an event stream.
      return new Response(`event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search","description":"Find","inputSchema":{}}]}}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const result = await probeHttpServer({ transport: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer t' } }, fetchImpl)
    expect(result).toEqual({ status: 'healthy', tools: [{ name: 'search', description: 'Find', inputSchema: {} }] })
    expect(calls[2].headers['Mcp-Session-Id']).toBe('s-1')
    expect(calls[2].headers.Authorization).toBe('Bearer t')
  })

  it('reports a server that wants a sign-in as such, not as broken', async () => {
    const { fetchImpl } = server(() => new Response('', { status: 401 }))
    await expect(probeHttpServer({ transport: 'http', url: 'https://x.test/mcp', headers: {} }, fetchImpl)).resolves.toEqual({ status: 'needs-auth' })
    // With a token of its own, a refusal means the token is wrong.
    await expect(probeHttpServer({ transport: 'http', url: 'https://x.test/mcp', headers: { Authorization: 'Bearer bad' } }, fetchImpl)).rejects.toThrow('refused the token')
  })

  it('only opens the stream of a legacy SSE server', async () => {
    const { calls, fetchImpl } = server(() => new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    await expect(probeHttpServer({ transport: 'sse', url: 'https://x.test/sse', headers: {} }, fetchImpl)).resolves.toEqual({ status: 'reachable' })
    expect(calls.map(call => call.method)).toEqual(['GET'])
  })

  it('says what failed', async () => {
    await expect(probeHttpServer({ transport: 'http', url: 'https://x.test/mcp', headers: {} }, server(() => new Response('', { status: 404 })).fetchImpl)).rejects.toThrow('HTTP 404')
    await expect(probeHttpServer({ transport: 'http', url: 'https://x.test/mcp', headers: {} }, async () => { throw new TypeError('fetch failed') })).rejects.toThrow('Could not reach the server: fetch failed')
  })
})
