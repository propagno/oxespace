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
/**
 * B23 · What an execution asked for lives no longer than the execution. When a pane closes or exits, or a conversation's
 * session ends or is replaced, everything waiting on its behalf is cancelled: approval brokers listen here and cancel
 * the execution's pending asks (and drop its grants), and work that asks without a broker takes the execution's signal.
 * The listeners are module-level, like the approval center, so a broker or service needs no extra wiring. The signals
 * belong to one execution each: keyed by its own `owner` object (fresh per launch), so a call that carries an ended
 * launch's owner gets that launch's aborted signal, never the next launch's, and two registries never share one.
 */
const endedListeners = new Set<(execution: AgentExecution) => void>()
const executionSignals = new WeakMap<ExecutionOwner, AbortController>()

/** Calls `listener` with every execution that ends; returns the unsubscribe. A failing listener never stops the others. */
export function onExecutionEnded(listener: (execution: AgentExecution) => void): () => void {
  endedListeners.add(listener)
  return () => { endedListeners.delete(listener) }
}

/**
 * Aborted when the execution that `owner` belongs to ends. Pass the authenticated execution's own `execution.owner`;
 * an owner object that came from anywhere else has no signal (undefined), which keeps the ask uncancelled as before.
 */
export function executionSignal(owner: ExecutionOwner | undefined): AbortSignal | undefined {
  return owner ? executionSignals.get(owner)?.signal : undefined
}

/** Process-lifetime credentials; unrelated to provider conversation IDs or memory availability. */
export class ExecutionRegistry {
  private executions = new Map<string, AgentExecution>()
  private generations = new Map<string, number>()
  register(input: { paneId: string; workspaceId: string; cwd: string } | { owner: ExecutionOwner; workspaceId: string; cwd: string }): Record<string, string> {
    // A fresh object per launch, even when the caller reuses one: it is this execution's key to its own signal.
    const owner: ExecutionOwner = 'owner' in input ? { kind: input.owner.kind, id: input.owner.id } : { kind: 'pane', id: input.paneId }
    this.endOwner(owner)
    const ownerKey = this.key(owner)
    const generation = (this.generations.get(ownerKey) ?? 0) + 1
    this.generations.set(ownerKey, generation)
    const paneId = owner.kind === 'pane' ? owner.id : `thread:${owner.id}`
    const execution: AgentExecution = { ...input, paneId, owner, canonicalRoot: resolve(input.cwd), generation,
      id: randomUUID(), token: randomBytes(32).toString('hex') }
    this.executions.set(execution.id, execution)
    executionSignals.set(owner, new AbortController())
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
  /** B7.4 · How many live executions run in this folder or below it (the policy change request's note). */
  liveWithin(root: string): number {
    const folder = resolve(root)
    const inside = (cwd: string) => { const path = resolve(cwd); return process.platform === 'win32' ? (path.toLowerCase() + '\\').startsWith(folder.toLowerCase().replace(/\\?$/, '\\')) : (path + '/').startsWith(folder.replace(/\/?$/, '/')) }
    return [...this.executions.values()].filter(execution => inside(execution.cwd)).length
  }
  forPane(paneId: string): AgentExecution | undefined { return [...this.executions.values()].find(e => e.paneId === paneId) }
  forOwner(owner: ExecutionOwner): AgentExecution | undefined { return [...this.executions.values()].find(e => this.key(e.owner) === this.key(owner)) }
  end(paneId: string): void { this.endOwner({ kind: 'pane', id: paneId }) }
  endOwner(owner: ExecutionOwner): void {
    const key = this.key(owner)
    const ended: AgentExecution[] = []
    for (const [id, execution] of this.executions) if (this.key(execution.owner) === key) { this.executions.delete(id); ended.push(execution) }
    // Kept in the map once aborted: a late call carrying this execution's owner gets an aborted signal, so it is refused.
    for (const execution of ended) executionSignals.get(execution.owner)?.abort()
    for (const execution of ended) for (const listener of endedListeners) {
      try { listener(execution) } catch { /* one listener's failure never keeps another's asks alive */ }
    }
  }
  private key(owner: ExecutionOwner): string { return `${owner.kind}:${owner.id}` }
}
