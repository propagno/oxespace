import { describe, expect, it, vi } from 'vitest'
// Loaded through the registry, as the app does: the handlers and the registry import each other.
import { TOOL_REGISTRY } from '../../electron/main/mcp-internal/tool-registry'
import { openInMemoryDatabase } from '../../electron/main/db'
import {
  OPTIONAL_THREAD_TOOL_GROUPS, THREAD_MCP_TOOLS, THREAD_TOOL_GROUPS, threadMcpArguments, threadToolList, threadToolRoles, toolSearchEnvironment
} from '../../electron/main/services/conversation/thread-mcp'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

/** What a provider receives for each tool on every request. */
function definitionChars(names: readonly string[]): number {
  return JSON.stringify(TOOL_REGISTRY.map(entry => entry.descriptor).filter(descriptor => names.includes(descriptor.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length
}

function bridgeTools(args: string[]): string[] {
  const config = JSON.parse(args[args.indexOf('--mcp-config') + 1]) as { mcpServers: Record<string, { args: string[] }> }
  return JSON.parse(config.mcpServers['oxespace-delegation'].args[2]) as string[]
}

describe('Thread MCP token budget', () => {
  it('offers every registered Thread tool through exactly the groups', () => {
    const registered = new Set(TOOL_REGISTRY.map(entry => entry.descriptor.name))
    for (const name of THREAD_MCP_TOOLS) expect(registered.has(name), name).toBe(true)
    expect(new Set(Object.values(THREAD_TOOL_GROUPS).flat())).toEqual(new Set(THREAD_MCP_TOOLS))
  })

  it('sends a plain conversation at most a fifth of the tool definitions, and under 9,000 characters', () => {
    const core = definitionChars(threadToolList())
    const all = definitionChars(THREAD_MCP_TOOLS)
    expect(core).toBeLessThanOrEqual(9000)
    expect(core / all).toBeLessThanOrEqual(0.2)
  })

  it('adds the team and worker groups only for those roles, and optional groups only when the project asks', () => {
    expect(threadToolList()).toEqual([...THREAD_TOOL_GROUPS.core])
    expect(threadToolList({ team: true })).toEqual(expect.arrayContaining([...THREAD_TOOL_GROUPS.team]))
    expect(threadToolList({ team: true })).not.toContain('oxespace_delegation_update')
    expect(threadToolList({ worker: true })).toEqual(expect.arrayContaining([...THREAD_TOOL_GROUPS.worker]))
    expect(threadToolList({}, ['data', 'unknown'])).toEqual(expect.arrayContaining([...THREAD_TOOL_GROUPS.data]))
    expect(threadToolList({}, ['data'])).not.toContain('oxespace_delegate_task')
    const everything = threadToolList({ team: true, worker: true }, OPTIONAL_THREAD_TOOL_GROUPS)
    expect(new Set(everything)).toEqual(new Set(THREAD_MCP_TOOLS))
    expect(new Set(everything).size).toBe(everything.length)
  })

  it('gives the bridge the conversation tool list, and read-only only its lookups', () => {
    expect(bridgeTools(threadMcpArguments('claude', ['--print'], '/bridge.cjs', undefined, [], threadToolList()))).toEqual(threadToolList())
    const readOnly = threadMcpArguments('claude', ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], '/bridge.cjs', undefined, [], threadToolList())
    const lookups = bridgeTools(readOnly)
    expect(lookups).toContain('oxespace_hybrid_explore')
    expect(lookups).not.toContain('oxespace_team_inbox')
    expect(lookups).not.toContain('oxespace_memory_remember')
    const codex = threadMcpArguments('codex', ['app-server'], '/bridge.cjs', undefined, [], threadToolList())
    expect(codex.join(' ')).toContain('oxespace_hybrid_explore')
    expect(codex.join(' ')).not.toContain('oxespace_delegate_task')
  })

  it('finds a conversation’s roles in the database', () => {
    const db = openInMemoryDatabase()
    try {
      expect(threadToolRoles(db, 'plain')).toEqual({ team: false, worker: false })
      expect(threadToolRoles({ prepare: () => { throw Error('no such table') } }, 'plain')).toEqual({ team: false, worker: false })
      const answers = (match: string) => ({ prepare: (sql: string) => ({ get: () => sql.includes(match) ? { 1: 1 } : undefined }) })
      expect(threadToolRoles(answers('agent_team_execution_links'), 'member')).toEqual({ team: true, worker: false })
      expect(threadToolRoles(answers('destinationThreadId'), 'delegated')).toEqual({ team: false, worker: true })
      expect(threadToolRoles(answers('FROM work_tasks'), 'task')).toEqual({ team: false, worker: true })
      expect(threadToolRoles(answers('supervisor_thread_id'), 'supervisor')).toEqual({ team: false, worker: true })
    } finally { db.close() }
  })

  it('turns on Claude tool search unless the person set it', () => {
    expect(toolSearchEnvironment('claude', {})).toEqual({ ENABLE_TOOL_SEARCH: 'auto:5' })
    expect(toolSearchEnvironment('claude', { ENABLE_TOOL_SEARCH: 'false' })).toEqual({})
    expect(toolSearchEnvironment('codex', {})).toEqual({})
  })
})
