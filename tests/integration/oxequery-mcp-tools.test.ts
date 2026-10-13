import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OXEQUERY_TOOLS } from '../../electron/main/mcp-internal/oxequery-tools'
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'
import { AgentToolError } from '../../electron/main/services/oxequery/agent-gateway'

const names = OXEQUERY_TOOLS.map(entry => entry.descriptor.name)

describe('OxeQuery MCP tools', () => {
  it('are registered once, offered to Threads, and never to a read-only Thread', () => {
    for (const name of names) {
      expect(TOOL_REGISTRY.filter(entry => entry.descriptor.name === name)).toHaveLength(1)
      expect(THREAD_MCP_TOOLS).toContain(name)
      expect(THREAD_READ_ONLY_MCP_TOOLS).not.toContain(name)
    }
  })

  it('are not marked retry-safe in the bridge, because an approval may be pending', () => {
    const bridge = readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8')
    const block = /const READ_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(bridge)![1]
    for (const name of names) expect(block).not.toContain(name)
  })

  it('accept no policy flags from the model', () => {
    for (const entry of OXEQUERY_TOOLS) {
      const schema = entry.descriptor.inputSchema as { properties: Record<string, unknown>; additionalProperties: boolean }
      expect(schema.additionalProperties).toBe(false)
      expect(Object.keys(schema.properties)).not.toEqual(expect.arrayContaining(['confirmed']))
      expect(Object.keys(schema.properties)).not.toEqual(expect.arrayContaining(['readOnly']))
    }
  })

  it('need a live execution and report a refusal as a tool error with its code', async () => {
    const entry = OXEQUERY_TOOLS.find(item => item.descriptor.name === 'oxespace_db_query')!
    const gateway = { handle: async () => { throw new AgentToolError('Agent access is off.', 'access-off') } }
    const authentic = { authenticate: () => ({ id: 'e1', owner: { kind: 'thread', id: 't1' } }) }
    const ctx = { oxeQuery: () => gateway, executions: authentic, executionId: 'e1', executionToken: 't', workspaceId: 'w' } as unknown as ToolContext
    const result = await entry.handler({ connection: 'x', sql: 'SELECT 1' }, ctx)
    expect(result.isError).toBe(true)
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ ok: false, code: 'access-off' })
    await expect(entry.handler({}, { ...ctx, executions: { authenticate: () => { throw new Error('no') } } } as unknown as ToolContext)).rejects.toThrow()
    await expect(entry.handler({}, { ...ctx, oxeQuery: () => undefined } as unknown as ToolContext)).rejects.toThrow(/unavailable/)
  })

  it('does not leak an unexpected error message to the model', async () => {
    const entry = OXEQUERY_TOOLS.find(item => item.descriptor.name === 'oxespace_db_describe')!
    const gateway = { handle: async () => { throw new Error('connect ECONNREFUSED postgres://u:SECRET@10.0.0.5') } }
    const ctx = { oxeQuery: () => gateway, executions: { authenticate: () => ({ id: 'e1', owner: { kind: 'thread', id: 't1' } }) }, executionId: 'e1', executionToken: 't', workspaceId: 'w' } as unknown as ToolContext
    const result = await entry.handler({ connection: 'x' }, ctx)
    expect(JSON.stringify(result)).not.toMatch(/SECRET|10\.0\.0\.5/)
  })
})
