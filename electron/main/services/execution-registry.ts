import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export interface AgentExecution { id: string; paneId: string; workspaceId: string; cwd: string; token: string }
/** Process-lifetime credentials; unrelated to provider conversation IDs or memory availability. */
export class ExecutionRegistry {
  private executions = new Map<string, AgentExecution>()
  register(input: { paneId: string; workspaceId: string; cwd: string }): Record<string, string> {
    this.end(input.paneId)
    const execution = { ...input, id: randomUUID(), token: randomBytes(32).toString('hex') }
    this.executions.set(execution.id, execution)
    return { OXESPACE_EXECUTION_ID: execution.id, OXESPACE_EXECUTION_TOKEN: execution.token, OXESPACE_WORKSPACE_ID: input.workspaceId }
  }
  authenticate(id?: string, token?: string, workspaceId?: string | null): AgentExecution {
    const execution = id ? this.executions.get(id) : undefined
    const supplied = Buffer.from(token ?? '')
    if (!execution || execution.workspaceId !== workspaceId || supplied.length !== Buffer.byteLength(execution.token) || !timingSafeEqual(supplied, Buffer.from(execution.token))) {
      throw new Error('Delegation requires a live OXESpace terminal. Open a new terminal after enabling automation.')
    }
    return execution
  }
  forPane(paneId: string): AgentExecution | undefined { return [...this.executions.values()].find(e => e.paneId === paneId) }
  end(paneId: string): void { for (const [id, e] of this.executions) if (e.paneId === paneId) this.executions.delete(id) }
}
