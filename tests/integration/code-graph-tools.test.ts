import { describe, expect, it, vi } from 'vitest'
// Loaded through the registry, as the app does: the handlers and the registry import each other.
import { TOOL_REGISTRY } from '../../electron/main/mcp-internal/tool-registry'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const execute = vi.fn(async (name: string, args: Record<string, unknown>) => ({ content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }] }))
vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = execute } }))

function threadContext(root: string) {
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'thread', id: 'reader' }, workspaceId: 'thread:project', cwd: root })
  const ensureInstance = vi.fn(async (path: string) => ({ path }))
  const ctx = {
    executions, executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, workspaceId: 'thread:project',
    workspaceServ: { list: () => [] }, codegraph: { ensureInstance }
  }
  return { ctx: ctx as never, ensureInstance }
}
const CODE_GRAPH_TOOLS = TOOL_REGISTRY.filter(entry => entry.descriptor.name.startsWith('oxespace_code_'))
const tool = (name: string) => CODE_GRAPH_TOOLS.find(entry => entry.descriptor.name === name)!

describe('CodeGraph tools for Threads', () => {
  it('query the conversation project and forward only the allowed arguments', async () => {
    const { ctx, ensureInstance } = threadContext(process.cwd())
    const result = await tool('oxespace_code_callers').handler({ symbol: 'send', limit: 5 }, ctx)
    expect(ensureInstance).toHaveBeenCalledWith(process.cwd())
    expect(execute).toHaveBeenLastCalledWith('codegraph_callers', { symbol: 'send', limit: 5 })
    expect(result.content[0]).toMatchObject({ text: 'codegraph_callers:{"symbol":"send","limit":5}' })
  })

  it('never let an agent point the graph at another checkout', async () => {
    const { ctx } = threadContext(process.cwd())
    await expect(tool('oxespace_code_search').handler({ query: 'x', projectPath: 'C:/other' }, ctx)).rejects.toThrow(/Unknown argument: projectPath/)
    await expect(tool('oxespace_code_impact').handler({}, ctx)).rejects.toThrow(/symbol is required/)
  })

  it('refuse an unverified Thread execution', async () => {
    const { ctx } = threadContext(process.cwd())
    await expect(tool('oxespace_code_status').handler({}, { ...(ctx as object), executionToken: 'wrong' } as never)).rejects.toThrow(/could not be verified/)
  })

  it('are offered to every Thread, including read-only ones', () => {
    for (const entry of CODE_GRAPH_TOOLS) {
      expect(THREAD_MCP_TOOLS).toContain(entry.descriptor.name)
      expect(THREAD_READ_ONLY_MCP_TOOLS).toContain(entry.descriptor.name)
    }
    expect(new Set(THREAD_MCP_TOOLS).size).toBe(THREAD_MCP_TOOLS.length)
  })
})
