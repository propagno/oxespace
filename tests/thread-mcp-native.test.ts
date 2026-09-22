import http from 'node:http'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { AgentProcessTransport } from '../electron/main/services/conversation/process-transport'
import { AgentRpcPeer } from '../electron/main/services/conversation/rpc-peer'
import { threadMcpArguments } from '../electron/main/services/conversation/thread-mcp'

it.skipIf(process.env.OXESPACE_THREAD_SMOKE !== '1')('installed Codex discovers the Thread MCP tool catalog without inference or provider API keys', async () => {
  const scopes: string[] = []
  const server = http.createServer((req, res) => {
    scopes.push(String(req.headers['x-oxe-workspace-id']))
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      const call = JSON.parse(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { tools: [
        { name: 'oxespace_memory_search', description: 'Search this project', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
        { name: 'oxespace_run_script', description: 'Run an authorized workspace script', inputSchema: { type: 'object', properties: {} } },
        { name: 'oxespace_unknown_unsafe_tool', description: 'Must not cross the Thread allowlist', inputSchema: { type: 'object', properties: {} } }
      ] } }))
    })
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address() as { port: number }
  const args = ['-c', 'mcp_servers={}', ...threadMcpArguments('codex', ['app-server', '--listen', 'stdio://'], resolve('resources/mcp-bridge/oxespace-mcp.cjs'))]
  const transport = new AgentProcessTransport('codex', args, process.cwd(), { OXESPACE_MCP_PORT: String(address.port), OXESPACE_MCP_TOKEN: 'fixture-token', OXESPACE_WORKSPACE_ID: 'thread-native-project' })
  const notices: string[] = []
  let diagnostics = ''
  transport.onDiagnostic(chunk => { diagnostics += chunk.toString() })
  const peer = new AgentRpcPeer(line => transport.write(line), message => { if (message.method) notices.push(message.method) }, message => { if (message.id !== undefined) peer.rejectRequest(message.id) }, 35000)
  transport.onData(chunk => peer.push(chunk)); transport.onClose(() => peer.close())
  try {
    await peer.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' } }); peer.notify('initialized')
    const started = await peer.request('thread/start', { cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'on-request' }) as { thread: { id: string } }
    await expect.poll(async () => JSON.stringify(await peer.request('mcpServerStatus/list', { limit: 100, threadId: started.thread.id })), { timeout: 40000 }).toContain('oxespace_memory_search')
    const status = await peer.request('mcpServerStatus/list', { limit: 100, threadId: started.thread.id }) as { data: { name: string; tools: Record<string, unknown> }[] }
    expect(Object.keys(status.data.find(entry => entry.name === 'oxespace-delegation')!.tools).sort()).toEqual(['oxespace_memory_search', 'oxespace_run_script'])
    expect(JSON.stringify(status)).not.toContain('oxespace_unknown_unsafe_tool')
    expect(scopes).toContain('thread-native-project')
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Native MCP failed'}; bridge requests=${scopes.length}; missing bridge env=${diagnostics.includes('missing OXESPACE_MCP')}; notices=${notices.join(',')}`)
  } finally {
    peer.close(); await transport.close()
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
}, 55000)
