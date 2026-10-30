// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { AiMemoryClient, MemoryClientError } from '../../electron/main/services/memory/ai-memory.client'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'
import { MemoryManager } from '../../electron/main/services/memory/memory-manager'

const endpoint = 'http://127.0.0.1:12345'
function rpcClient(result: unknown) {
  return new AiMemoryClient(endpoint, 'secret-token', vi.fn(async (_url, options) => {
    const request = JSON.parse(String(options?.body))
    return Response.json({ jsonrpc: '2.0', id: request.id, result })
  }) as typeof fetch)
}

test('HTTP failures are typed without retaining remote content or credentials', async () => {
  const client = new AiMemoryClient(endpoint, 'secret-token', vi.fn(async () => new Response('secret-payload', { status: 401 })) as typeof fetch)
  const error = await client.request('/identity').catch(error => error)
  expect(error).toBeInstanceOf(MemoryClientError)
  expect(error).toMatchObject({ code: 'authentication', status: 401 })
  expect(String(error)).not.toMatch(/secret/)
})

test('batch reads partial acknowledgements even when the server returns 429', async () => {
  const client = new AiMemoryClient(endpoint, 'secret-token', vi.fn(async () => Response.json({ accepted: 0,
    accepted_indices: [1], results: [{ index: 1, outcome: 'stored' }] }, { status: 429 })) as typeof fetch)
  const item = { url: '/hook?event=stop', body: { session_id: 'native-1', cwd: '/synthetic' } }
  expect(await client.hookBatch([item, item])).toEqual({ status: 429,
    body: { accepted: 0, accepted_indices: [1], results: [{ index: 1, outcome: 'stored' }] } })
})

test.each([
  { jsonrpc: '2.0', id: 1, error: { message: 'private error' } },
  { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'private error' }] } }
])('HTTP 200 never masks an MCP rejection', async envelope => {
  const client = new AiMemoryClient(endpoint, '', vi.fn(async () => Response.json(envelope)) as typeof fetch)
  await expect(client.tool('memory_query', {})).rejects.toMatchObject({ code: 'rejected' })
})

test.each([null, [], { jsonrpc: '2.0', id: 99, result: {} }, { jsonrpc: '2.0', id: 1, result: {} }])('malformed tool reply fails closed', async envelope => {
  const client = new AiMemoryClient(endpoint, '', vi.fn(async () => Response.json(envelope)) as typeof fetch)
  await expect(client.tool('memory_query', {})).rejects.toMatchObject({ code: 'protocol' })
})

test('non-JSON response is an explicit unsupported protocol, not empty success', async () => {
  const client = new AiMemoryClient(endpoint, '', vi.fn(async () => new Response('data: private-stream')) as typeof fetch)
  await expect(client.initialize()).rejects.toMatchObject({ code: 'protocol' })
})

test('response limit cancels the body and releases the reader', async () => {
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)) }, cancel })
  const client = new AiMemoryClient(endpoint, '', vi.fn(async () => new Response(stream)) as typeof fetch)
  await expect(client.request('/identity')).rejects.toMatchObject({ code: 'response-too-large' })
  expect(cancel).toHaveBeenCalledOnce()
  expect(stream.locked).toBe(false)
})

test('caller cancellation reaches the transport and never exposes its reason', async () => {
  const controller = new AbortController()
  const transport = vi.fn(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    controller.abort('private reason')
  })) as typeof fetch
  await expect(new AiMemoryClient(endpoint, '', transport).request('/identity', undefined, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
})

test('manager deadline aborts provider IO rather than only abandoning the promise', async () => {
  let aborted = false
  const transport = vi.fn(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted = true; reject(Error('private network detail')) }, { once: true })
  })) as typeof fetch
  const provider = new AiMemoryProvider(new AiMemoryClient(endpoint, '', transport))
  const manager = new MemoryManager(() => provider, () => ({ enabled: true, automaticCapture: true, automaticContext: true }), 20)
  const context = { projectId: 'project', workspace: 'workspace', project: 'project', cwd: '/fixture' }
  expect((await manager.run(context, p => p.search(context, 'synthetic'))).status).toBe('unavailable')
  expect(aborted).toBe(true)
})

test('capabilities come from actual tool schemas; absent fields remain false', async () => {
  expect(await rpcClient({ tools: [] }).capabilities()).toEqual({ exactHandoff: false, createHandoff: false, sessionObservations: false, deletePage: false })
  expect(await rpcClient({ tools: [{ name: 'memory_handoff_accept', inputSchema: { properties: { handoff_id: { type: 'string' } } } },
    { name: 'memory_handoff_begin' }] }).capabilities()).toEqual({ exactHandoff: true, createHandoff: true, sessionObservations: false, deletePage: false })
  expect((await rpcClient({ tools: [{ name: 'memory_delete_page', inputSchema: { properties: { path: { type: 'string' } } } }] }).capabilities()).deletePage).toBe(true)
})

test('parses successful content and rejects malformed initialization', async () => {
  expect(await rpcClient({ content: [{ type: 'text', text: '{"hits":[]}' }] }).tool('memory_query', {})).toEqual({ hits: [] })
  await expect(rpcClient({}).initialize()).rejects.toMatchObject({ code: 'protocol' })
})

test('healthy API never implies successful capture, delivery or consolidation', async () => {
  const client = new AiMemoryClient(endpoint, '', vi.fn(async () => Response.json({ status: 'ok' })) as typeof fetch)
  expect(await new AiMemoryProvider(client).health()).toEqual({ status: 'ready',
    pipeline: { capture: 'unknown', delivery: 'unknown', consolidation: 'unknown' } })
})
