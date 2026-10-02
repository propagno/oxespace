import type { AgentExecution } from '../services/execution-registry'
import type { ToolContext } from './tool-registry'

/** Browser access is bound to the live native execution, never to the active Code workspace. */
export function requirePreviewExecution(ctx: ToolContext): AgentExecution {
  const execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
  if (!execution) throw new Error('A live Code or Thread execution is required for browser control')
  if (execution.owner.kind === 'pane') {
    const workspace = ctx.workspaceServ.get(execution.workspaceId)
    if (!workspace?.panes.some(pane => pane.id === execution.owner.id)) throw new Error('The Code pane is no longer available')
  }
  return execution
}
