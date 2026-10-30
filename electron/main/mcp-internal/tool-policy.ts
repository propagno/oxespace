import type { ToolContext } from './tool-registry'
import { policyBlockedMessage } from '../../../shared/policy'
import { policyStore } from '../services/policy'
import type { PolicyStore } from '../services/policy/policy-store'

/** The policy resource of an OXESpace tool, whatever key the caller's CLI gave the server (`oxespace` in a Code terminal). */
export const oxespaceToolResource = (tool: string): string => `mcp__oxespace-delegation__${tool}`

/**
 * The project folders a call comes from: the execution's own folder when it proves one, the workspace it names, and,
 * without either, the active workspace the tools would act on. Policy is checked against each, so a block in any holds.
 */
function callerRoots(ctx: Pick<ToolContext, 'db' | 'workspaceServ' | 'executions' | 'executionId' | 'executionToken' | 'workspaceId'>): string[] {
  const roots = new Set<string>()
  try {
    const execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
    if (execution) roots.add(execution.cwd)
  } catch { /* A generic MCP caller has no execution. */ }
  if (ctx.workspaceId?.startsWith('thread:')) {
    const rows = ctx.db?.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all(ctx.workspaceId.slice('thread:'.length)) as { root_path: string }[] | undefined
    for (const row of rows ?? []) roots.add(row.root_path)
  } else if (ctx.workspaceId) {
    const workspace = ctx.workspaceServ.get(ctx.workspaceId)
    if (workspace) roots.add(workspace.rootPath)
  }
  if (!roots.size) {
    const active = ctx.workspaceServ.list().find(workspace => workspace.isActive === true)
    if (active) roots.add(active.rootPath)
  }
  return [...roots]
}

/**
 * B7.3: a `tool.use` deny for an OXESpace tool holds at `tools/call` too, so it reaches agents in Code terminals and any
 * client that did not hide the tool. Returns the message the agent sees, or nothing when the call may run.
 */
export function toolCallBlocked(tool: string, ctx: Parameters<typeof callerRoots>[0], policy: PolicyStore | null = policyStore()): string | undefined {
  if (!policy) return undefined
  const resource = oxespaceToolResource(tool)
  const roots = callerRoots(ctx)
  for (const root of roots.length ? roots : [null]) {
    const decision = policy.decide('tool.use', resource, root)
    if (!decision.allowed) return policyBlockedMessage(decision, tool)
  }
  return undefined
}
