import { expect, it } from 'vitest'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { JsonLinesDecoder } from '../../electron/main/services/conversation/json-lines'

it.skipIf(process.env.OXESPACE_CLAUDE_HANDSHAKE !== '1')('installed Claude accepts the stdio approval protocol without sending a user prompt', async () => {
  const transport = new AgentProcessTransport('claude', ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], process.cwd())
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Claude handshake timed out')), 20000)
      const decoder = new JsonLinesDecoder(value => {
        const event = value as { type?: string; response?: { request_id?: string; subtype?: string } }
        if (event.type === 'control_response' && event.response?.request_id === 'initialize') {
          try { expect(event.response.subtype).toBe('success'); resolve() } catch (error) { reject(error) }
        }
      })
      transport.onData(chunk => { try { decoder.push(chunk) } catch (error) { reject(error) } })
      transport.onClose(() => reject(Error('Claude closed before handshake')))
      transport.write(JSON.stringify({ type: 'control_request', request_id: 'initialize', request: { subtype: 'initialize', hooks: {} } }) + '\n')
    })
  } finally { clearTimeout(timer); await transport.close() }
}, 25000)
