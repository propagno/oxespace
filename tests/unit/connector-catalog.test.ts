import { describe, expect, it } from 'vitest'
import { catalogConfig, envTemplate, isDarkBrand, MCP_CATALOG, MCP_CATALOG_CATEGORIES, searchCatalog, type McpCatalogEntry } from '../../src/components/MCP/connectorCatalog'

const byId = (id: string): McpCatalogEntry => MCP_CATALOG.find(entry => entry.id === id)!
/** What the agent is pointed at: the URL of a remote server, the arguments of a local one. */
const targets = (entry: McpCatalogEntry): string[] => entry.transport === 'stdio' ? entry.args : [entry.url]

describe('connector catalog', () => {
  it('has unique ids, a runnable command or an https URL, and a known category for every entry', () => {
    const ids = MCP_CATALOG.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of MCP_CATALOG) {
      if (entry.transport === 'stdio') {
        expect(entry.command, entry.id).toMatch(/^(npx|uvx)$/)
        expect(entry.args.length, entry.id).toBeGreaterThan(0)
      } else {
        expect(entry.url, entry.id).toMatch(/^https:\/\//)
      }
      expect(MCP_CATALOG_CATEGORIES, entry.id).toContain(entry.category)
      expect(entry.brand.hex, entry.id).toMatch(/^[0-9A-Fa-f]{6}$/)
    }
  })

  it('hands remote servers to the agent as they are, with no mcp-remote bridge', () => {
    const remote = MCP_CATALOG.filter(entry => entry.transport !== 'stdio')
    expect(remote.length).toBeGreaterThan(3)
    for (const entry of MCP_CATALOG) expect(targets(entry), entry.id).not.toContain('mcp-remote')
    expect(catalogConfig(byId('linear'))).toEqual({ transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} })
    // Asana's current endpoint needs an app registered by hand; its SSE one still signs in on its own.
    expect(catalogConfig(byId('asana'))).toMatchObject({ transport: 'sse', url: 'https://mcp.asana.com/sse' })
  })

  it('puts a remote server token in its header, and a local server value in its environment', () => {
    expect(envTemplate(byId('github'))).toBe('GITHUB_PERSONAL_ACCESS_TOKEN=')
    expect(catalogConfig(byId('github'), { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' })).toEqual({
      transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_x' }
    })
    expect(catalogConfig(byId('mongodb'), { MDB_MCP_CONNECTION_STRING: 'mongodb://h' })).toMatchObject({
      transport: 'stdio', env: { MDB_MCP_READ_ONLY: 'true', MDB_MCP_CONNECTION_STRING: 'mongodb://h' }
    })
    expect(envTemplate(byId('time'))).toBe('')
  })

  it('searches name, description and category', () => {
    expect(searchCatalog('supabase').map(entry => entry.id)).toContain('supabase')
    expect(searchCatalog('browser').length).toBeGreaterThan(0)
    expect(searchCatalog('zzzz')).toEqual([])
    expect(searchCatalog('  ')).toHaveLength(MCP_CATALOG.length)
  })

  it('covers the daily-driver services with commands that exist on npm', () => {
    expect(byId('notion')).toMatchObject({ signIn: true, transport: 'http', url: 'https://mcp.notion.com/mcp' })
    expect(envTemplate(byId('notion-token'))).toBe('NOTION_TOKEN=')
    expect(byId('azure-devops')).toMatchObject({ command: 'npx', args: ['-y', '@azure-devops/mcp', '<your-organization>'] })
    expect(byId('azure-devops').configure).toMatch(/organization/)
    expect(envTemplate(byId('mongodb'))).toBe(['MDB_MCP_CONNECTION_STRING=', 'MDB_MCP_READ_ONLY=true'].join('\n'))
    // The connection string, password included, travels in the environment, never in the arguments.
    expect(byId('postgres')).toMatchObject({ args: ['-y', '@microsoft/postgres-mcp@latest', 'run'], requiredEnv: ['POSTGRES_MCP_CONNECTION_STRING'] })
    // None of them depends on uv, which is not installed by default.
    expect(byId('playwright').args).toEqual(['-y', '@playwright/mcp@latest'])
    for (const id of ['notion-token', 'azure-devops', 'mongodb', 'postgres', 'playwright']) expect(byId(id)).toMatchObject({ command: 'npx' })
  })

  it('offers no endpoint or package its provider retired (checked 2026-10-19)', () => {
    // SSE endpoints that now answer 404/410, and @modelcontextprotocol servers npm marks as no longer supported.
    const retired = ['@modelcontextprotocol/server-github', 'https://mcp.linear.app/sse', 'https://docs.mcp.cloudflare.com/sse', '@modelcontextprotocol/server-gitlab', '@modelcontextprotocol/server-postgres',
      '@modelcontextprotocol/server-slack', '@modelcontextprotocol/server-brave-search', '@modelcontextprotocol/server-google-maps', '@dropbox/mcp-server']
    for (const entry of MCP_CATALOG) for (const arg of targets(entry)) expect(retired, `${entry.id}: ${arg}`).not.toContain(arg)
    // GitHub's own server replaces the package npm marks as no longer supported.
    expect(targets(byId('github'))).not.toContain('@modelcontextprotocol/server-github')
    // Cloudflare's documentation server needs no account.
    expect(byId('cloudflare')).toMatchObject({ url: 'https://docs.mcp.cloudflare.com/mcp', signIn: false })
  })

  it('detects brand colours that need a light glyph on a dark tile', () => {
    expect(isDarkBrand('181717')).toBe(true)
    expect(isDarkBrand('F24E1E')).toBe(false)
  })
})
