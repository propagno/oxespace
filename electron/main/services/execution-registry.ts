import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'

export type ExecutionOwner = { kind: 'pane' | 'thread'; id: string }
export interface AgentExecution {
  id: string
  /** Compatibility identity for pane-oriented tools. Threads use `thread:<id>`. */
  paneId: string
  owner: ExecutionOwner
  workspaceId: string
  cwd: string
  canonicalRoot: string
  generation: number
  token: string
}
/** Process-lifetime credentials; unrelated to provider conversation IDs or memory availability. */
export class ExecutionRegistry {
  private executions = new Map<string, AgentExecution>()
  private generations = new Map<string, number>()
  register(input: { paneId: string; workspaceId: string; cwd: string } | { owner: ExecutionOwner; workspaceId: string; cwd: string }): Record<string, string> {
    const owner = 'owner' in input ? input.owner : { kind: 'pane' as const, id: input.paneId }
    this.endOwner(owner)
    const ownerKey = this.key(owner)
    const generation = (this.generations.get(ownerKey) ?? 0) + 1
    this.generations.set(ownerKey, generation)
    const paneId = owner.kind === 'pane' ? owner.id : `thread:${owner.id}`
    const execution: AgentExecution = { ...input, paneId, owner, canonicalRoot: resolve(input.cwd), generation,
      id: randomUUID(), token: randomBytes(32).toString('hex') }
    this.executions.set(execution.id, execution)
    return { OXESPACE_EXECUTION_ID: execution.id, OXESPACE_EXECUTION_TOKEN: execution.token,
      OXESPACE_EXECUTION_GENERATION: String(generation), OXESPACE_WORKSPACE_ID: input.workspaceId }
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
  forOwner(owner: ExecutionOwner): AgentExecution | undefined { return [...this.executions.values()].find(e => this.key(e.owner) === this.key(owner)) }
  end(paneId: string): void { this.endOwner({ kind: 'pane', id: paneId }) }
  endOwner(owner: ExecutionOwner): void {
    const key = this.key(owner)
    for (const [id, execution] of this.executions) if (this.key(execution.owner) === key) this.executions.delete(id)
  }
  private key(owner: ExecutionOwner): string { return `${owner.kind}:${owner.id}` }
}
