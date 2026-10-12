import { spawn } from 'node:child_process'
import http from 'node:http'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const BRIDGE_PATH = resolve(__dirname, '..', '..', 'resources', 'mcp-bridge', 'oxespace-mcp.cjs')
const TOKEN = 'b'.repeat(64)
const WSID = 'ws-test'

interface StubServer {
  port: number
  receivedTokens: string[]
  receivedWorkspaces: string[]
  receivedMethods: string[]
  receivedExecutions: string[]
  receivedExecutionTokens: string[]
  stop(): Promise<void>
}

async function startStub(options: { failures?: number } = {}): Promise<StubServer> {
  const receivedTokens: string[] = []
  const receivedWorkspaces: string[] = []
  const receivedMethods: string[] = []
  const receivedExecutions: string[] = []
  const receivedExecutionTokens: string[] = []
  let failures = options.failures ?? 0
  const server = http.createServer((req, res) => {
    receivedTokens.push(String(req.headers.authorization ?? ''))
    receivedWorkspaces.push(String(req.headers['x-oxe-workspace-id'] ?? ''))
    receivedExecutions.push(String(req.headers['x-oxe-execution-id'] ?? ''))
    receivedExecutionTokens.push(String(req.headers['x-oxe-execution-token'] ?? ''))
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      const envelope = body ? (JSON.parse(body) as { method: string; id: number }) : { method: '', id: 0 }
      receivedMethods.push(envelope.method)
      if (failures > 0) {
        failures--
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('temporarily unavailable')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (envelope.method === 'tools/list') {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, result: { tools: [{ name: 'oxespace_ping', description: 'p', inputSchema: { type: 'object', properties: {} } }] } }))
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: envelope.id, result: { content: [{ type: 'text', text: 'pong' }] } }))
      }
    })
  })
  const port: number = await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolveListen(addr.port)
    })
  })
  return {
    port,
    receivedTokens,
    receivedWorkspaces,
    receivedMethods,
    receivedExecutions,
    receivedExecutionTokens,
    stop: () => new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

interface BridgeProcess {
  stop(): void
  send(line: string): void
  output: string[]
  waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>
}

function startBridge(env: Record<string, string>, args: string[] = []): BridgeProcess {
  const child = spawn(process.execPath, [BRIDGE_PATH, ...args], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const output: string[] = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) output.push(line)
    }
  })
  return {
    stop() { child.kill() },
    send(line: string) { child.stdin.write(line + '\n') },
    output,
    waitFor(predicate, timeoutMs = 3000) {
      return new Promise<string>((resolveLine, reject) => {
        const start = Date.now()
        const check = (): void => {
          const found = output.find(predicate)
          if (found) { resolveLine(found); return }
          if (Date.now() - start > timeoutMs) { reject(new Error('timeout waiting for bridge output')); return }
          setTimeout(check, 25)
        }
        check()
      })
    }
  }
}

describe('Internal MCP bridge', () => {
  let stub: StubServer
  let bridge: BridgeProcess | null = null

  beforeEach(async () => {
    stub = await startStub()
  })

  afterEach(async () => {
    if (bridge) bridge.stop()
    await stub.stop()
  })

  test('Thread filters the tool catalog and refuses excluded automation before sending HTTP', async () => {
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID }, ['--allowed-tools', '["oxespace_ping"]'])
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/list' }))
    expect(JSON.parse(await bridge.waitFor(l => l.includes('"id":11'))).result.tools).toHaveLength(1)
    const requests = stub.receivedMethods.length
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'oxespace_run_script' } }))
    expect(JSON.parse(await bridge.waitFor(l => l.includes('"id":12'))).error.message).toContain('not available in Thread')
    expect(stub.receivedMethods).toHaveLength(requests)
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'oxespace_ping' } }))
    expect(JSON.parse(await bridge.waitFor(l => l.includes('"id":13'))).result.content[0].text).toBe('pong')
  })

  test('Thread cannot discover tools outside its explicit allowlist', async () => {
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID }, ['--allowed-tools', '["oxespace_memory_search"]'])
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tools/list' }))
    expect(JSON.parse(await bridge.waitFor(l => l.includes('"id":14'))).result.tools).toEqual([])
  })

  test('responds to initialize with protocolVersion + serverInfo', async () => {
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    const line = await bridge.waitFor((l) => l.includes('"id":1'))
    const parsed = JSON.parse(line) as { result: { protocolVersion: string; serverInfo: { name: string } } }
    expect(parsed.result.protocolVersion).toBe('2025-06-18')
    expect(parsed.result.serverInfo.name).toBe('oxespace')
  })

  test('forwards tools/list to the local RPC with the bearer token + workspace header', async () => {
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    const line = await bridge.waitFor((l) => l.includes('"id":2'))
    const parsed = JSON.parse(line) as { result: { tools: Array<{ name: string }> } }
    expect(parsed.result.tools[0].name).toBe('oxespace_ping')
    expect(stub.receivedMethods).toContain('tools/list')
    expect(stub.receivedTokens.some((h) => h === `Bearer ${TOKEN}`)).toBe(true)
    expect(stub.receivedWorkspaces.some((h) => h === WSID)).toBe(true)
  })

  test('forwards tools/call and returns the MCP content envelope', async () => {
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID, OXESPACE_EXECUTION_ID: 'execution-a', OXESPACE_EXECUTION_TOKEN: 'execution-secret' })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oxespace_ping', arguments: {} } }))
    const line = await bridge.waitFor((l) => l.includes('"id":3'))
    const parsed = JSON.parse(line) as { result: { content: Array<{ type: string; text: string }> } }
    expect(parsed.result.content[0].text).toBe('pong')
    expect(stub.receivedExecutions).toContain('execution-a')
    expect(stub.receivedExecutionTokens).toContain('execution-secret')
  })

  test('retries transient infrastructure failures for read-only tools', async () => {
    await stub.stop()
    stub = await startStub({ failures: 2 })
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'oxespace_quality_check', arguments: { files: ['src/a.ts'] } } }))
    const parsed = JSON.parse(await bridge.waitFor(line => line.includes('"id":4'), 5000)) as { result: { content: Array<{ text: string }> } }
    expect(parsed.result.content[0].text).toBe('pong')
    expect(stub.receivedMethods).toEqual(['tools/call', 'tools/call', 'tools/call'])
  })

  test('never retries a mutating tool after an ambiguous transport failure', async () => {
    await stub.stop()
    stub = await startStub({ failures: 1 })
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'oxespace_run_script', arguments: { scriptId: 'build' } } }))
    const parsed = JSON.parse(await bridge.waitFor(line => line.includes('"id":5'))) as { error: { data: { category: string; retryable: boolean } } }
    expect(parsed.error.data).toMatchObject({ category: 'infrastructure', retryable: false, delivery: 'unknown', attempts: 1 })
    expect(stub.receivedMethods).toEqual(['tools/call'])
  })

  test('ends an unanswered preview call at the absolute deadline without retrying it', async () => {
    await stub.stop()
    const waiting = http.createServer((_request, _response) => { /* Keep the connection open without responding. */ })
    const port = await new Promise<number>(resolveListen => waiting.listen(0, '127.0.0.1', () => resolveListen((waiting.address() as { port: number }).port)))
    try {
      bridge = startBridge({ OXESPACE_MCP_PORT: String(port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
      bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'oxespace_open_web_preview', arguments: { url: 'http://127.0.0.1:4178' } } }))
      const parsed = JSON.parse(await bridge.waitFor(line => line.includes('"id":6'), 13000)) as { error: { data: { delivery: string; retryable: boolean; requestId: string } } }
      expect(parsed.error.data).toMatchObject({ delivery: 'unknown', retryable: false })
      expect(parsed.error.data.requestId).toMatch(/^[\da-f-]{36}$/)
    } finally {
      bridge?.stop()
      await new Promise<void>(resolveClose => waiting.close(() => resolveClose()))
    }
  }, 16000)
})
