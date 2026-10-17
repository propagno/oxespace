// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverMcpServers, readDiscoveredServers } from '../electron/main/services/mcp-import.service'
import { removeTempDir } from './helpers/removeTempDir'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root) })

function home() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-mcp-import-')); roots.push(root)
  mkdirSync(join(root, '.cursor'), { recursive: true })
  mkdirSync(join(root, '.codeium', 'windsurf'), { recursive: true })
  mkdirSync(join(root, 'AppData', 'Roaming', 'Claude'), { recursive: true })
  writeFileSync(join(root, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_secret' } },
    docs: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer very-secret' } },
    broken: { transport: 'weird' },
    bad_env: { command: 'x', env: { A: 1 } }
  } }))
  writeFileSync(join(root, '.codeium', 'windsurf', 'mcp_config.json'), '{ not json')
  writeFileSync(join(root, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { fs: { command: 'node', args: ['fs.js'] } } }))
  return root
}

describe('MCP discovery', () => {
  it('lists what other tools have, keeps one bad entry from hiding the rest, and never returns secret values', () => {
    const root = home()
    const sources = discoverMcpServers(new Set(['docs']), { home: root, appData: join(root, 'AppData', 'Roaming'), platform: 'win32' })
    expect(sources.map(source => source.id)).toEqual(['claude-desktop', 'cursor'])
    const cursor = sources.find(source => source.id === 'cursor')!
    expect(cursor.servers.map(server => server.name)).toEqual(['github', 'docs'])
    expect(cursor.servers[0]).toEqual({ name: 'github', transport: 'stdio', target: 'npx -y @modelcontextprotocol/server-github', secretNames: ['GITHUB_TOKEN'], exists: false })
    expect(cursor.servers[1]).toMatchObject({ transport: 'http', target: 'https://mcp.example.com/mcp', secretNames: ['Authorization'], exists: true })
    expect(JSON.stringify(sources)).not.toMatch(/ghp_secret|very-secret/)
  })

  it('returns nothing for missing or oversized files', () => {
    const empty = mkdtempSync(join(tmpdir(), 'oxe-mcp-import-empty-')); roots.push(empty)
    expect(discoverMcpServers(new Set(), { home: empty, platform: 'linux' })).toEqual([])
    mkdirSync(join(empty, '.cursor'), { recursive: true })
    writeFileSync(join(empty, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { big: { command: 'x', args: ['a'.repeat(600 * 1024)] } } }))
    expect(discoverMcpServers(new Set(), { home: empty, platform: 'linux' })).toEqual([])
  })

  it('reads the chosen servers again, with their real configuration, only from a known source', () => {
    const root = home()
    const read = readDiscoveredServers('cursor', ['github'], { home: root })
    expect(read).toEqual([{ name: 'github', config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'ghp_secret' } } }])
    expect(() => readDiscoveredServers('../etc/passwd', ['x'], { home: root })).toThrow(/Unknown source/)
  })
})
