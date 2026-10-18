import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'
import type { ToolEntry } from './tool-registry'

/**
 * The structural code tools (CodeGraph) for the caller's own project. Each one
 * forwards to the vendored CodeGraph handler with the project root resolved
 * from the verified execution; the vendor's `projectPath` argument is never
 * passed through, so an agent cannot read another checkout on disk.
 */
const symbol = { type: 'string', description: 'Function, method or class name' }
const limit = (fallback: number) => ({ type: 'number', description: `Maximum results (default ${fallback})` })

const TOOLS: Array<{ name: string; target: string; description: string; properties: Record<string, unknown>; required?: string[]; allowed: string[] }> = [
  { name: 'oxespace_code_search', target: 'codegraph_search', description: 'Find symbols by name in this project. Returns locations only; use oxespace_hybrid_explore for source.',
    properties: { query: { type: 'string', description: 'Symbol name or part of it' }, kind: { type: 'string', enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'] }, limit: limit(10) }, required: ['query'], allowed: ['query', 'kind', 'limit'] },
  { name: 'oxespace_code_callers', target: 'codegraph_callers', description: 'Functions that call a symbol in this project.',
    properties: { symbol, limit: limit(20) }, required: ['symbol'], allowed: ['symbol', 'limit'] },
  { name: 'oxespace_code_callees', target: 'codegraph_callees', description: 'Functions a symbol calls in this project.',
    properties: { symbol, limit: limit(20) }, required: ['symbol'], allowed: ['symbol', 'limit'] },
  { name: 'oxespace_code_impact', target: 'codegraph_impact', description: 'Symbols affected by changing a symbol. Use before a refactor.',
    properties: { symbol, depth: { type: 'number', description: 'Dependency levels to traverse (default 2)' } }, required: ['symbol'], allowed: ['symbol', 'depth'] },
  { name: 'oxespace_code_node', target: 'codegraph_node', description: 'One symbol in full: location, signature, callers/callees and, with includeCode, its body. Pass file/line to pick one overload.',
    properties: { symbol, includeCode: { type: 'boolean' }, file: { type: 'string' }, line: { type: 'number' } }, required: ['symbol'], allowed: ['symbol', 'includeCode', 'file', 'line'] },
  { name: 'oxespace_code_status', target: 'codegraph_status', description: 'Health of this project\'s code index (files, symbols, edges).',
    properties: {}, allowed: [] }
]

const MAX_TEXT = 60_000

export const CODE_GRAPH_TOOLS: ToolEntry[] = TOOLS.map(tool => ({
  descriptor: { name: tool.name, description: tool.description, inputSchema: { type: 'object', properties: tool.properties, ...(tool.required ? { required: tool.required } : {}), additionalProperties: false } },
  requiresWorkspace: true,
  handler: async (args, ctx): Promise<InternalMcpToolCallResult> => {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
    const unknown = Object.keys(input).filter(key => !tool.allowed.includes(key))
    if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(', ')}`)
    for (const key of tool.required ?? []) if (typeof input[key] !== 'string' || !String(input[key]).trim()) throw new Error(`${key} is required`)
    // Loaded on call: tool-handlers imports the registry, which lists these tools.
    const { requireProjectScope } = await import('./tool-handlers')
    const scope = await requireProjectScope(ctx)
    const graph = await ctx.codegraph.ensureInstance(scope.rootPath)
    const { ToolHandler } = await import('../vendor/codegraph/mcp/tools')
    const result = await new ToolHandler(graph as never).execute(tool.target, input)
    const content = (result.content ?? []).map(block => block.type === 'text' && block.text.length > MAX_TEXT ? { ...block, text: `${block.text.slice(0, MAX_TEXT)}\n…(truncated)` } : block)
    return { ...result, content } as InternalMcpToolCallResult
  }
}))
