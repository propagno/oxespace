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
  stop(): Promise<void>
}

async function startStub(): Promise<StubServer> {
  const receivedTokens: string[] = []
  const receivedWorkspaces: string[] = []
  const receivedMethods: string[] = []
  const server = http.createServer((req, res) => {
    receivedTokens.push(String(req.headers.authorization ?? ''))
    receivedWorkspaces.push(String(req.headers['x-oxe-workspace-id'] ?? ''))
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', () => {
      const envelope = body ? (JSON.parse(body) as { method: string; id: number }) : { method: '', id: 0 }
      receivedMethods.push(envelope.method)
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
    stop: () => new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

interface BridgeProcess {
  stop(): void
  send(line: string): void
  output: string[]
  waitFor(predicate: (line: string) => boolean, timeoutMs?: number): Promise<string>
}

function startBridge(env: Record<string, string>): BridgeProcess {
  const child = spawn(process.execPath, [BRIDGE_PATH], {
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
    bridge = startBridge({ OXESPACE_MCP_PORT: String(stub.port), OXESPACE_MCP_TOKEN: TOKEN, OXESPACE_WORKSPACE_ID: WSID })
    bridge.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'oxespace_ping', arguments: {} } }))
    const line = await bridge.waitFor((l) => l.includes('"id":3'))
    const parsed = JSON.parse(line) as { result: { content: Array<{ type: string; text: string }> } }
    expect(parsed.result.content[0].text).toBe('pong')
  })
})
