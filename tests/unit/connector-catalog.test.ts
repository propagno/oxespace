import { describe, expect, it } from 'vitest'
import { envTemplate, isDarkBrand, MCP_CATALOG, MCP_CATALOG_CATEGORIES, searchCatalog } from '../../src/components/MCP/connectorCatalog'

describe('connector catalog', () => {
  it('has unique ids, a runnable command and a known category for every entry', () => {
    const ids = MCP_CATALOG.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of MCP_CATALOG) {
      expect(entry.command, entry.id).toMatch(/^(npx|uvx)$/)
      expect(entry.args.length, entry.id).toBeGreaterThan(0)
      expect(MCP_CATALOG_CATEGORIES, entry.id).toContain(entry.category)
      expect(entry.brand.hex, entry.id).toMatch(/^[0-9A-Fa-f]{6}$/)
    }
  })

  it('bridges remote servers through mcp-remote with a browser sign-in', () => {
    const remote = MCP_CATALOG.filter(entry => entry.signIn)
    expect(remote.length).toBeGreaterThan(3)
    for (const entry of remote) expect(entry.args).toEqual(['-y', 'mcp-remote', expect.stringMatching(/^https?:\/\//)])
  })

  it('lists required secrets as empty KEY= lines', () => {
    const github = MCP_CATALOG.find(entry => entry.id === 'github')!
    expect(envTemplate(github)).toBe('GITHUB_PERSONAL_ACCESS_TOKEN=')
    expect(envTemplate(MCP_CATALOG.find(entry => entry.id === 'time')!)).toBe('')
  })

  it('searches name, description and category', () => {
    expect(searchCatalog('supabase').map(entry => entry.id)).toContain('supabase')
    expect(searchCatalog('browser').length).toBeGreaterThan(0)
    expect(searchCatalog('zzzz')).toEqual([])
    expect(searchCatalog('  ')).toHaveLength(MCP_CATALOG.length)
  })

  it('covers the daily-driver services with commands that exist on npm', () => {
    const byId = (id: string) => MCP_CATALOG.find(entry => entry.id === id)!
    expect(byId('notion')).toMatchObject({ signIn: true, args: ['-y', 'mcp-remote', 'https://mcp.notion.com/mcp'] })
    expect(envTemplate(byId('notion-token'))).toBe('NOTION_TOKEN=')
    expect(byId('azure-devops')).toMatchObject({ command: 'npx', args: ['-y', '@azure-devops/mcp', '<your-organization>'] })
    expect(byId('azure-devops').configure).toMatch(/organization/)
    expect(envTemplate(byId('mongodb'))).toBe(['MDB_MCP_CONNECTION_STRING=', 'MDB_MCP_READ_ONLY=true'].join('\n'))
    expect(byId('postgres').args[1]).toBe('@modelcontextprotocol/server-postgres')
    // None of them depends on uv, which is not installed by default.
    expect(byId('playwright').args).toEqual(['-y', '@playwright/mcp@latest'])
    for (const id of ['notion', 'notion-token', 'azure-devops', 'mongodb', 'postgres', 'playwright']) expect(byId(id).command).toBe('npx')
  })

  it('detects brand colours that need a light glyph on a dark tile', () => {
    expect(isDarkBrand('181717')).toBe(true)
    expect(isDarkBrand('F24E1E')).toBe(false)
  })
})
