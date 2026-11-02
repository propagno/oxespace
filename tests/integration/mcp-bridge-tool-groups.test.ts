import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const BRIDGE = resolve(__dirname, '..', '..', 'resources', 'mcp-bridge', 'oxespace-mcp.cjs')
const TOOLS = ['oxespace_capabilities', 'oxespace_tools_enable', 'oxespace_code_search', 'oxespace_db_query', 'oxespace_containers_list', 'oxespace_open_web_preview']

/** The OXESpace endpoint the bridge forwards to: every tool exists, and capabilities answers like the app. */
async function server(): Promise<{ port: number; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = []
  const instance = http.createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const envelope = JSON.parse(body) as { id: number; method: string; params?: { name: string } }
      calls.push(envelope.params?.name ?? envelope.method)
      const result = envelope.method === 'tools/list'
        ? { tools: TOOLS.map(name => ({ name, description: name, inputSchema: { type: 'object' } })) }
        : { content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, status: 'ok', data: { tools: [] } }) }] }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, result }))
    })
  })
  const port = await new Promise<number>(done => instance.listen(0, '127.0.0.1', () => done((instance.address() as { port: number }).port)))
  return { port, calls, close: () => new Promise(done => instance.close(() => done())) }
}

const children: ChildProcessWithoutNullStreams[] = []
afterEach(() => { for (const child of children.splice(0)) child.kill() })

/** Runs the bridge the way a conversation does and talks to it over stdio. */
function bridge(port: number, allowed: string[], enableable?: Record<string, string[]>, extra: { args?: string[]; env?: Record<string, string>; nested?: boolean } = {}) {
  const argv = [BRIDGE, '--allowed-tools', JSON.stringify(allowed), ...(enableable ? ['--enableable-groups', JSON.stringify(enableable)] : []), ...(extra.args ?? [])]
  // nested: started by another process, as a claude the agent runs itself would start it (a different parent).
  const child = spawn(process.execPath, extra.nested
    ? ['-e', `const c=require('child_process').spawn(process.execPath,${JSON.stringify(argv)},{stdio:'inherit'});c.on('exit',code=>process.exit(code??0))`]
    : argv, {
    env: { ...process.env, OXESPACE_PANE_BRIDGE: '', OXESPACE_MCP_PORT: String(port), OXESPACE_MCP_TOKEN: 't'.repeat(64), OXESPACE_WORKSPACE_ID: 'ws', ...extra.env }
  })
  children.push(child)
  const lines: Record<string, unknown>[] = []
  let buffer = ''
  child.stdout.on('data', chunk => {
    buffer += chunk
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) { lines.push(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1) }
  })
  let next = 1
  const request = async (method: string, params?: unknown): Promise<Record<string, unknown>> => {
    const id = next++
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    for (let waited = 0; waited < 5000; waited += 10) {
      const reply = lines.find(line => line.id === id)
      if (reply) return reply
      await new Promise(done => setTimeout(done, 10))
    }
    throw new Error(`No reply to ${method}`)
  }
  const listed = async () => ((await request('tools/list')).result as { tools: { name: string }[] }).tools.map(tool => tool.name)
  const call = async (name: string, args: unknown) => {
    const result = (await request('tools/call', { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean }
    return { ...JSON.parse(result.content[0].text) as Record<string, unknown>, isError: result.isError === true }
  }
  return { request, listed, call, notifications: () => lines.filter(line => line.method === 'notifications/tools/list_changed') }
}

describe('turning a tool group on in a session (B7.2)', () => {
  it('adds the group\'s tools, tells the client the list changed once, and answers locally', async () => {
    const endpoint = await server()
    try {
      const session = bridge(endpoint.port, ['oxespace_capabilities', 'oxespace_tools_enable', 'oxespace_code_search'], { data: ['oxespace_db_query', 'oxespace_containers_list'] })
      const init = await session.request('initialize', {})
      expect((init.result as { capabilities: unknown }).capabilities).toEqual({ tools: { listChanged: true } })
      expect(await session.listed()).toEqual(['oxespace_capabilities', 'oxespace_tools_enable', 'oxespace_code_search'])
      expect((await session.request('tools/call', { name: 'oxespace_db_query', arguments: {} })).error).toMatchObject({ code: -32602 })

      expect(await session.call('oxespace_tools_enable', { group: 'data' })).toMatchObject({ status: 'ok', group: 'data', tools: ['oxespace_db_query', 'oxespace_containers_list'], isError: false })
      expect(session.notifications()).toHaveLength(1)
      expect(await session.listed()).toEqual(['oxespace_capabilities', 'oxespace_tools_enable', 'oxespace_code_search', 'oxespace_db_query', 'oxespace_containers_list'])
      await session.call('oxespace_tools_enable', { group: 'data' })
      expect(session.notifications()).toHaveLength(1)
      // The enable call never reached the app; the newly offered tool does.
      expect(endpoint.calls).not.toContain('oxespace_tools_enable')
      await session.call('oxespace_db_query', {})
      expect(endpoint.calls).toContain('oxespace_db_query')
    } finally { await endpoint.close() }
  })

  it('refuses role groups, groups the project turned off or already offered, and malformed input', async () => {
    const endpoint = await server()
    try {
      const session = bridge(endpoint.port, ['oxespace_tools_enable', 'oxespace_open_web_preview'], { data: ['oxespace_db_query'] })
      expect(await session.call('oxespace_tools_enable', { group: 'team' })).toMatchObject({ status: 'error', code: 'ROLE_GROUP', isError: true })
      expect(await session.call('oxespace_tools_enable', { group: 'app' })).toMatchObject({ status: 'error', code: 'GROUP_UNAVAILABLE', isError: true })
      expect(await session.call('oxespace_tools_enable', { group: 'docs' })).toMatchObject({ code: 'GROUP_UNAVAILABLE' })
      expect(await session.call('oxespace_tools_enable', { group: '__proto__' })).toMatchObject({ code: 'GROUP_UNAVAILABLE' })
      for (const args of [{}, { group: 1 }, { group: 'data', extra: true }, null, 'data']) expect(await session.call('oxespace_tools_enable', args), JSON.stringify(args)).toMatchObject({ code: 'INVALID_ARGUMENTS' })
      expect(session.notifications()).toHaveLength(0)
      expect(await session.listed()).toEqual(['oxespace_tools_enable', 'oxespace_open_web_preview'])
    } finally { await endpoint.close() }
  })

  it('tells oxespace_capabilities which groups this session turned on and which it still can', async () => {
    const endpoint = await server()
    try {
      const session = bridge(endpoint.port, ['oxespace_capabilities', 'oxespace_tools_enable'], { data: ['oxespace_db_query'], docs: ['oxespace_open_web_preview'] })
      await session.call('oxespace_tools_enable', { group: 'docs' })
      const capabilities = await session.call('oxespace_capabilities', {})
      expect((capabilities.data as Record<string, unknown>).sessionToolGroups).toEqual({ enabled: ['docs'], available: ['data'], enableWith: 'oxespace_tools_enable' })
    } finally { await endpoint.close() }
  })

  it('keeps today\'s behaviour when the session has nothing to turn on', async () => {
    const endpoint = await server()
    try {
      const session = bridge(endpoint.port, ['oxespace_capabilities'])
      expect(((await session.request('initialize', {})).result as { capabilities: unknown }).capabilities).toEqual({ tools: {} })
      const capabilities = await session.call('oxespace_capabilities', {})
      expect(capabilities.data).toEqual({ tools: [] })
    } finally { await endpoint.close() }
  })

  it('tells the agent when its tools beat grep, once in initialize, and only where those tools are listed (S5)', async () => {
    const endpoint = await server()
    try {
      const instructions = async (session: ReturnType<typeof bridge>) => ((await session.request('initialize', {})).result as { instructions?: string }).instructions
      const text = await instructions(bridge(endpoint.port, [...TOOLS, 'oxespace_hybrid_explore']))
      expect(text).toContain('oxespace_hybrid_explore')
      expect(text!.length).toBeLessThanOrEqual(600)
      // A plan without the code tools, or a bridge that lists nothing, says nothing about them.
      expect(await instructions(bridge(endpoint.port, TOOLS))).toBeUndefined()
      expect(await instructions(bridge(endpoint.port, [...TOOLS, 'oxespace_hybrid_explore'], undefined, { args: ['--project-entry'], env: { OXESPACE_PANE_BRIDGE: randomUUID() } }))).toBeUndefined()
    } finally { await endpoint.close() }
  })

  it('names only the tools OXESpace really lists when a group turns on, and the rest as unavailable', async () => {
    const endpoint = await server()
    try {
      // oxespace_memory_sessions is in the group but OXESpace does not list it (memory off).
      const session = bridge(endpoint.port, ['oxespace_capabilities', 'oxespace_tools_enable'], { orchestration: ['oxespace_containers_list', 'oxespace_memory_sessions'] })
      await session.listed()
      const reply = await session.call('oxespace_tools_enable', { group: 'orchestration' })
      expect(reply).toMatchObject({ status: 'ok', tools: ['oxespace_containers_list'], unavailable: ['oxespace_memory_sessions'] })
      expect(await session.listed()).toEqual(['oxespace_capabilities', 'oxespace_tools_enable', 'oxespace_containers_list'])
    } finally { await endpoint.close() }
  })

  it('answers a client started without the app\'s port and token instead of leaving it waiting', async () => {
    const child = spawn(process.execPath, [BRIDGE], { env: { ...process.env, OXESPACE_MCP_PORT: '', OXESPACE_MCP_TOKEN: '', OXESPACE_PANE_BRIDGE: '' } })
    children.push(child)
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    const reply = async (id: number) => {
      await expect.poll(() => out.split('\n').some(line => line.includes(`"id":${id}`)), { timeout: 5000, interval: 10 }).toBe(true)
      return JSON.parse(out.split('\n').find(line => line.includes(`"id":${id}`))!) as Record<string, { tools?: unknown[]; message?: string; protocolVersion?: string }>
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
    expect((await reply(1)).result.protocolVersion).toBeTruthy()
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    expect((await reply(2)).result.tools).toEqual([])
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oxespace_capabilities', arguments: {} } })}\n`)
    expect((await reply(3)).error.message).toContain('OXESpace terminal')
  })

  it('as the .mcp.json entry in a pane with its own bridge, lists nothing and forwards nothing: one OXESpace server', async () => {
    const endpoint = await server()
    try {
      const token = randomUUID()
      const aside = bridge(endpoint.port, TOOLS, undefined, { args: ['--project-entry'], env: { OXESPACE_PANE_BRIDGE: token } })
      expect(await aside.listed()).toEqual([])
      const refused = await aside.request('tools/call', { name: 'oxespace_code_search', arguments: {} })
      expect(refused.error).toMatchObject({ code: -32602 })
      expect(String((refused.error as { message: string }).message)).toContain('oxespace-delegation')
      expect(endpoint.calls).toEqual([])
      // The same agent restarting its server: still aside.
      expect(await bridge(endpoint.port, TOOLS, undefined, { args: ['--project-entry'], env: { OXESPACE_PANE_BRIDGE: token } }).listed()).toEqual([])
      // A claude the agent starts itself inherits the token but is another parent: its entry serves, so it keeps its tools.
      expect(await bridge(endpoint.port, TOOLS, undefined, { args: ['--project-entry'], env: { OXESPACE_PANE_BRIDGE: token }, nested: true }).listed()).toEqual(TOOLS)
      // The same entry anywhere else (Copilot, a claude typed into a shell), or with a malformed token, lists as usual.
      expect(await bridge(endpoint.port, TOOLS, undefined, { args: ['--project-entry'] }).listed()).toEqual(TOOLS)
      expect(await bridge(endpoint.port, TOOLS, undefined, { args: ['--project-entry'], env: { OXESPACE_PANE_BRIDGE: '1' } }).listed()).toEqual(TOOLS)
      // And the pane's own bridge, which has no project mark, is unaffected by the variable.
      expect(await bridge(endpoint.port, TOOLS, undefined, { env: { OXESPACE_PANE_BRIDGE: randomUUID() } }).listed()).toEqual(TOOLS)
    } finally { await endpoint.close() }
  })
})
