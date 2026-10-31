import { describe, expect, it } from 'vitest'
import { parseMcpJson } from '../src/components/MCP/parseMcpJson'

describe('parseMcpJson', () => {
  it('keeps reading local servers in all three shapes', () => {
    expect(parseMcpJson('{"command":"npx","args":["-y","x"]}')).toEqual([{ name: '', config: { transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: {} } }])
    expect(parseMcpJson('{"mcpServers":{"gh":{"command":"gh-mcp","env":{"TOKEN":"t"}}}}')[0]).toMatchObject({ name: 'gh', config: { command: 'gh-mcp', env: { TOKEN: 't' } } })
    expect(parseMcpJson('{"a":{"command":"a"},"b":{"command":"b"}}').map(entry => entry.name)).toEqual(['a', 'b'])
  })

  it('reads remote servers, with their headers and transport', () => {
    const entries = parseMcpJson('{"mcpServers":{"docs":{"url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer x"}},"live":{"type":"sse","url":"https://example.com/sse"},"s":{"type":"streamable-http","url":"http://localhost:3000/mcp"}}}')
    expect(entries.map(entry => [entry.name, entry.config])).toEqual([
      ['docs', { transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer x' } }],
      ['live', { transport: 'sse', url: 'https://example.com/sse', headers: {} }],
      ['s', { transport: 'http', url: 'http://localhost:3000/mcp', headers: {} }]
    ])
    expect(parseMcpJson('{"url":"https://x.dev/mcp"}')[0]).toMatchObject({ name: '', config: { transport: 'http' } })
  })

  it('mixes local and remote servers in one map', () => {
    expect(parseMcpJson('{"a":{"command":"a"},"b":{"url":"https://b.dev/mcp"}}').map(entry => entry.config.transport)).toEqual(['stdio', 'http'])
  })

  it('refuses what it cannot run or reach', () => {
    expect(() => parseMcpJson('{"url":"ftp://x/y"}')).toThrow(/http\(s\)/)
    expect(() => parseMcpJson('{"type":"websocket","url":"https://x.dev"}')).toThrow(/"http" or "sse"/)
    expect(() => parseMcpJson('{"url":"https://x.dev","headers":{"A":1}}')).toThrow(/headers\.A/)
    expect(() => parseMcpJson('{"type":"sse","command":"x"}')).toThrow(/stdio/)
    expect(() => parseMcpJson('{"mcpServers":{"x":{"foo":1}}}')).toThrow(/"command" \(local\) or "url"/)
    expect(() => parseMcpJson('')).toThrow(/empty/)
  })
})
