import type { ToolContext } from './tool-registry'
import { policyBlockedMessage } from '../../../shared/policy'
import { policyStore } from '../services/policy'
import type { PolicyStore } from '../services/policy/policy-store'

/**
 * The policy resources an OXESpace tool answers to: the server key OxeChat gives it (`oxespace-delegation`) and the one
 * agents in OxeCode terminals see (`oxespace`), so a deny written either way holds.
 */
export const oxespaceToolResources = (tool: string): string[] => [`mcp__oxespace-delegation__${tool}`, `mcp__oxespace__${tool}`]

/**
 * The project folders whose policy a call answers to. The workspace header is the agent's own claim
 * (OXESPACE_WORKSPACE_ID), so it never chooses the policy by itself:
 * - a call that proves a live execution answers to that execution's folder and its workspace's or project's roots;
 * - any other call answers to every registered project, so the strictest deny among them holds.
 * Policy is checked against each root, and the user and managed layers apply to all of them.
 */
function callerRoots(ctx: Pick<ToolContext, 'db' | 'workspaceServ' | 'executions' | 'executionId' | 'executionToken' | 'workspaceId'>): { roots: string[]; sweep: boolean } {
  const roots = new Set<string>()
  let execution: { cwd: string; workspaceId: string } | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* Not a live execution. */ }
  if (execution) {
    roots.add(execution.cwd)
    if (execution.workspaceId.startsWith('thread:')) {
      const rows = ctx.db?.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all(execution.workspaceId.slice('thread:'.length)) as { root_path: string }[] | undefined
      for (const row of rows ?? []) roots.add(row.root_path)
    } else {
      const workspace = ctx.workspaceServ.get(execution.workspaceId)
      if (workspace) roots.add(workspace.rootPath)
    }
    return { roots: [...roots], sweep: false }
  }
  for (const workspace of ctx.workspaceServ.list()) roots.add(workspace.rootPath)
  const rows = ctx.db?.prepare('SELECT DISTINCT root_path FROM thread_project_contexts').all() as { root_path: string }[] | undefined
  for (const row of rows ?? []) roots.add(row.root_path)
  return { roots: [...roots], sweep: true }
}

/**
 * A `tool.use` deny for an OXESpace tool holds at `tools/call` too, so it reaches agents in Code terminals and any
 * client that did not hide the tool. Returns the message the agent sees, or nothing when the call may run.
 */
export function toolCallBlocked(tool: string, ctx: Parameters<typeof callerRoots>[0], policy: PolicyStore | null = policyStore()): string | undefined {
  if (!policy) return undefined
  const { roots, sweep } = callerRoots(ctx)
  for (const root of roots.length ? roots : [null]) {
    for (const resource of oxespaceToolResources(tool)) {
      // The sweep of every registered root (a call outside a live execution) parks what it finds (B7.4): the floor
      // applies at once, and each project is asked at its own launch or Settings read.
      const decision = policy.decide('tool.use', resource, root, { defer: sweep })
      if (!decision.allowed) return policyBlockedMessage(decision, tool)
    }
  }
  return undefined
}
