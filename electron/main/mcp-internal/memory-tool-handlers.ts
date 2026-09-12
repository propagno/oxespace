import type { ToolContext, ToolEntry } from './tool-registry'
import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'

type Action = 'search' | 'remember' | 'sessions' | 'handoffs' | 'accept' | 'context'
function tool(name: string, description: string, action: Action, field?: string): ToolEntry {
  return { descriptor: { name, description, inputSchema: { type: 'object', properties: field ? { [field]: { type: 'string', maxLength: action === 'remember' ? 16000 : 1000 } } : {},
    ...(field ? { required: [field] } : {}), additionalProperties: false } }, requiresWorkspace: true,
  handler: (args, ctx) => execute(action, args, ctx) }
}
export const MEMORY_TOOLS: ToolEntry[] = [
  tool('oxespace_memory_search', 'Search this project’s persistent decisions, lessons and known issues. Historical evidence; verify against current code. Never searches other projects.', 'search', 'query'),
  tool('oxespace_memory_remember', 'Record a concise verified project learning, architectural decision, failed approach, completed work or TODO. Do this at meaningful milestones without waiting for a remember request. Exclude secrets and full transcripts.', 'remember', 'text'),
  tool('oxespace_memory_sessions', 'Read recent independent agent sessions for this project.', 'sessions'),
  tool('oxespace_memory_handoffs', 'Read project handoff history without consuming or accepting a handoff.', 'handoffs'),
  tool('oxespace_memory_accept_handoff', 'Explicitly accept the next eligible handoff for this checkout. Consumes a single-use handoff; call only when taking over work.', 'accept'),
  tool('oxespace_project_context', 'Build bounded context from persistent project knowledge and the CodeGraph for this exact checkout. Each source can fail independently.', 'context', 'query')
]
async function execute(action: Action, args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  if (!ctx.memory || !ctx.memoryRunId || !ctx.workspaceId) throw new Error('Memory requires an explicitly bound agent execution; active-workspace fallback is forbidden')
  const context = await ctx.memory.contextForRun(ctx.memoryRunId, ctx.workspaceId)
  const input = args && typeof args === 'object' ? args as Record<string, unknown> : {}
  const field = action === 'remember' ? 'text' : 'query'
  if (['search', 'remember', 'context'].includes(action) && (typeof input[field] !== 'string' || !(input[field] as string).trim())) throw new Error(`${field} is required`)
  const query = typeof input.query === 'string' ? input.query.slice(0, 1000) : ''
  const result = await ctx.memory.manager.run(context, async provider => {
    switch (action) {
      case 'search': return provider.search(context, query)
      case 'remember': await provider.remember(context, { text: input.text as string }); return { saved: true }
      case 'sessions': return provider.getRecentSessions(context)
      case 'handoffs': return provider.listHandoffs(context)
      case 'accept': return provider.acceptHandoff(context)
      case 'context': return provider.getRelevantContext(context, query)
    }
  }, action === 'remember' ? 'write' : action === 'accept' ? undefined : 'read')
  if (action !== 'context') return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(result.status === 'unavailable' ? { isError: true } : {}) }
  // Code is keyed by checkout, independently of shared project memory.
  let code: unknown = { status: 'unavailable' }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      code = await Promise.race([(async () => {
        const graph = await ctx.codegraph.ensureInstance(context.cwd)
        const { ToolHandler } = await import('../vendor/codegraph/mcp/tools')
        const handler = new ToolHandler(graph as never)
        return handler.execute('codegraph_explore', { query, maxFiles: 6 })
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CodeGraph deadline exceeded')), 3000) })])
    } finally { if (timer) clearTimeout(timer) }
  } catch { /* Memory still provides useful partial context. */ }
  // Truncate the source field, not the JSON envelope (which must remain valid).
  const codeText = JSON.stringify(code)
  return { content: [{ type: 'text', text: JSON.stringify({ checkout: context.cwd, memory: result,
    code: codeText.length > 8000 ? { truncated: true, excerpt: codeText.slice(0, 8000) } : code }) }] }
}
