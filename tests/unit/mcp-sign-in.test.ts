import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.fn()
vi.mock('electron', () => ({ shell: { openExternal: (...args: unknown[]) => openExternal(...args) } }))

/**
 * Stand-in for an OAuth bridge such as mcp-remote: announces its sign-in URL on
 * stderr, stays silent for a while (a person is signing in) and only then answers
 * the MCP handshake.
 */
const SIGN_IN_SECONDS = 17
const bridgeSource = `
process.stderr.write('Please authorize this client by visiting:\\n')
process.stderr.write('https://auth.example.test/authorize?client_id=abc\\n')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
    const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
    if (message.method === 'initialize') setTimeout(() => reply({ protocolVersion: '2024-11-05', serverInfo: { name: 'fake' }, capabilities: {} }), ${SIGN_IN_SECONDS} * 1000)
    if (message.method === 'tools/list') reply({ tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] })
  }
})
`

describe('OAuth bridge start', () => {
  afterEach(() => openExternal.mockReset())

  it('waits for the sign-in, never opens the page by itself, and keeps one start per server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe-mcp-signin-'))
    // The file name ends in "mcp-remote", which is what marks a server as an OAuth bridge.
    const script = join(dir, 'mcp-remote')
    writeFileSync(script, bridgeSource)
    const row = { id: 'srv', workspace_id: null, name: 'notion', transport: 'stdio', enabled: 1, trusted: 1, created_at: 1, updated_at: 1,
      config_json: JSON.stringify({ transport: 'stdio', command: process.execPath, args: [script], env: {} }) }
    const db = { prepare: () => ({ get: () => row, all: () => [], run: () => undefined }) }
    const events: Array<{ status: string; message: string | null }> = []
    const { McpManager } = await import('../../electron/main/services/mcp.service')
    const manager = new McpManager(db as never, { emitHealth: event => events.push(event) })
    try {
      const first = manager.start('srv')
      const second = manager.start('srv') // a second click must join the first, not restart it
      const [tools, joined] = await Promise.all([first, second])
      expect(joined.map(tool => tool.name)).toEqual(['search'])
      expect(tools.map(tool => tool.name)).toEqual(['search'])
      expect(events.some(event => event.status === 'starting' && /sign in/i.test(event.message ?? ''))).toBe(true)
      // mcp-remote never said "Browser opened automatically", and still nothing opened: the page waits for a click.
      expect(openExternal).not.toHaveBeenCalled()
      openExternal.mockResolvedValue(undefined)
      expect(manager.openSignIn('srv')).toBe(true)
      expect(openExternal).toHaveBeenCalledWith('https://auth.example.test/authorize?client_id=abc')
      expect(openExternal).toHaveBeenCalledTimes(1)
    } finally { manager.stopAll() }
  }, 45_000)
})
