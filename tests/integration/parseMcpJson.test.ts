import { describe, expect, test } from 'vitest'
import { parseMcpJson } from '../../src/components/MCP/parseMcpJson'

// GitHub MCP server reference — the canonical npx invocation. All three
// shapes the user can paste must yield the same { command, args, env } trio.
const GITHUB_COMMAND = 'npx'
const GITHUB_ARGS = ['-y', '@modelcontextprotocol/server-github']
const GITHUB_ENV = { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_xxxxxxxxxxxx' }

describe('parseMcpJson — GitHub MCP', () => {
  test('parses the project-style { mcpServers: { github: {...} } } shape', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: {
          command: GITHUB_COMMAND,
          args: GITHUB_ARGS,
          env: GITHUB_ENV
        }
      }
    })
    const entries = parseMcpJson(json)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('github')
    expect(entries[0].config).toEqual({
      transport: 'stdio',
      command: GITHUB_COMMAND,
      args: GITHUB_ARGS,
      env: GITHUB_ENV
    })
  })

  test('parses the bare { github: {...} } shape', () => {
    const json = JSON.stringify({
      github: { command: GITHUB_COMMAND, args: GITHUB_ARGS, env: GITHUB_ENV }
    })
    const entries = parseMcpJson(json)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('github')
    expect(entries[0].config.command).toBe(GITHUB_COMMAND)
    expect(entries[0].config.args).toEqual(GITHUB_ARGS)
    expect(entries[0].config.env).toEqual(GITHUB_ENV)
  })

  test('parses the anonymous { command, args, env } shape', () => {
    const json = JSON.stringify({
      command: GITHUB_COMMAND,
      args: GITHUB_ARGS,
      env: GITHUB_ENV
    })
    const entries = parseMcpJson(json)
    expect(entries).toHaveLength(1)
    // Anonymous shape leaves name empty — the form must prompt the user.
    expect(entries[0].name).toBe('')
    expect(entries[0].config.command).toBe(GITHUB_COMMAND)
    expect(entries[0].config.args).toEqual(GITHUB_ARGS)
    expect(entries[0].config.env).toEqual(GITHUB_ENV)
  })

  test('omits env when not provided (single GitHub MCP without token shown)', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: { command: GITHUB_COMMAND, args: GITHUB_ARGS }
      }
    })
    const entries = parseMcpJson(json)
    expect(entries[0].config.env).toEqual({})
  })
})

describe('parseMcpJson — multiple servers', () => {
  test('parses several servers from one mcpServers block', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] }
      }
    })
    const entries = parseMcpJson(json)
    expect(entries.map((e) => e.name)).toEqual(['github', 'playwright'])
  })
})

describe('parseMcpJson — error surfaces', () => {
  test('rejects empty input', () => {
    expect(() => parseMcpJson('   ')).toThrow(/empty/i)
  })

  test('rejects malformed JSON', () => {
    expect(() => parseMcpJson('{not: json')).toThrow(/invalid json/i)
  })

  test('rejects top-level array', () => {
    expect(() => parseMcpJson('[]')).toThrow(/object at the top/i)
  })

  test('rejects entries without command', () => {
    expect(() => parseMcpJson(JSON.stringify({ github: { args: [] } }))).toThrow(/does not match any MCP/i)
  })

  test('rejects non-stdio transport', () => {
    const json = JSON.stringify({ command: 'foo', type: 'http' })
    expect(() => parseMcpJson(json)).toThrow(/only "stdio"/i)
  })

  test('rejects args that are not an array of strings', () => {
    const json = JSON.stringify({ github: { command: 'npx', args: 'oops' } })
    // Shape B fails because args isn't an array — looksLikeStdioEntry only
    // checks command, so we reach normalizeArgs and throw with a useful
    // message that names the field.
    expect(() => parseMcpJson(json)).toThrow(/"args" must be an array/i)
  })

  test('rejects env values that are not strings', () => {
    const json = JSON.stringify({
      github: { command: 'npx', env: { GITHUB_PERSONAL_ACCESS_TOKEN: 123 } }
    })
    expect(() => parseMcpJson(json)).toThrow(/"env\.GITHUB_PERSONAL_ACCESS_TOKEN" must be a string/i)
  })
})
