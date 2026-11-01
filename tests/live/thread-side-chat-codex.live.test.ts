/**
 * Live check, against the installed and signed-in Codex, that a side chat (B1.2) cannot run a user MCP tool that writes:
 * the tool asks for approval, the side chat declines, and the tool never runs. The server is configured the way a person
 * would, with a per-tool `approval_mode = "approve"` and a `readOnlyHint` it does not honour.
 * Opt-in: OXE_LIVE_AGENTS=1 [OXE_LIVE_CODEX_MODEL=<id>] npx vitest run tests/live/thread-side-chat-codex.live.test.ts
 * It spends a little of the person's subscription and needs network, so it never runs in CI.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { ThreadSideChats } from '../../electron/main/services/conversation/thread-side-chat'
import type { ConversationThread, ThreadEvent, ThreadSideEvent } from '../../shared/types/thread'

const live = process.env.OXE_LIVE_AGENTS === '1'
const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

const WRITER = String.raw`const { writeFileSync } = require('node:fs')
const marker = process.argv[2]
let buffer = ''
const send = message => process.stdout.write(JSON.stringify(message) + '\n')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'userwriter', version: '1.0.0' } } })
    else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'write_marker', description: 'Writes a marker file.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } }] } })
    else if (message.method === 'tools/call') { writeFileSync(marker, 'written'); send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'Marker written.' }] } }) }
    else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })
  }
})
`

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 500)) }
  throw new Error(`${what} did not happen in time`)
}

describe.skipIf(!live)('live Codex side chat', () => {
  it('refuses a user MCP tool that writes: the request is declined and the tool never runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-side-live-')); roots.push(root)
    const server = join(root, 'writer.cjs').replace(/\\/g, '/'), marker = join(root, 'marker.txt')
    writeFileSync(server, WRITER)
    // As a person would configure it: auto by default, and this one tool approved outright.
    const userConfig = ['-c', 'mcp_servers.userwriter.command="node"', '-c', `mcp_servers.userwriter.args=["${server}", "${marker.replace(/\\/g, '/')}"]`,
      '-c', 'mcp_servers.userwriter.default_tools_approval_mode="auto"', '-c', 'mcp_servers.userwriter.tools.write_marker.approval_mode="approve"']
    const app = () => new AgentProcessTransport('codex', [...userConfig, 'app-server', '--listen', 'stdio://'], root)
    const model = process.env.OXE_LIVE_CODEX_MODEL || undefined
    const mainEvents: ThreadEvent[] = []
    const main = new CodexConversationAdapter(app())
    await main.start({ rootPath: root, nativeSessionId: null, access: 'read-only', approvalPolicy: 'never', ...(model ? { model } : {}) }, event => mainEvents.push(event))
    try {
      await main.send('Reply with OK only.')
      await until(() => mainEvents.some(event => event.type === 'completed'), 120_000, 'The main turn')
      const session = mainEvents.find(event => event.type === 'session')
      const thread = { id: 'live', provider: 'codex', rootPath: root, workspaceId: 'thread:live', nativeSessionId: session?.type === 'session' ? session.nativeSessionId : null, model } as ConversationThread
      const sideEvents: ThreadSideEvent[] = [], declined: { id: string; decision?: string }[] = []
      const chats = new ThreadSideChats({ readThread: () => thread, subscribe: () => () => {}, unavailable: () => false, discard: async () => {},
        connect: async () => {
          const adapter = new CodexConversationAdapter(app(), { ephemeral: true })
          const respond = adapter.respondRequest.bind(adapter)
          adapter.respondRequest = async (id, response) => { declined.push({ id, decision: response.decision }); return respond(id, response) }
          return adapter
        } })
      const opened = await chats.open(thread.id, event => sideEvents.push(event))
      console.log('side chat open:', JSON.stringify(opened))
      if (!opened.ok) throw Error('The side chat did not open')
      await chats.send(opened.side.sideId, 'Call the userwriter MCP tool write_marker exactly once, with no arguments. Do nothing else and do not retry if it is refused.')
      await until(() => sideEvents.some(event => event.event.type === 'completed'), 180_000, 'The side turn')
      const tools = sideEvents.map(event => event.event).filter(event => event.type === 'tool')
      console.log('side tool events:', JSON.stringify(tools).slice(0, 1500))
      expect(tools.length).toBeGreaterThan(0)
      // The approval request was raised and declined by the side chat; the call failed and the file was never written.
      expect(declined.length).toBeGreaterThan(0)
      expect(declined.every(entry => entry.decision === 'decline')).toBe(true)
      expect(tools.some(event => event.type === 'tool' && event.state === 'failed')).toBe(true)
      expect(existsSync(marker)).toBe(false)
      expect(sideEvents.some(event => event.event.type === 'request')).toBe(false)
      await chats.stop()
    } finally {
      await main.command('delete', '').catch(() => {})
      await main.dispose()
    }
  }, 400_000)
})
