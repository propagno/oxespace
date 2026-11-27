import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import type { WorkspaceAccessLevel } from '../../../shared/access-ceiling'
import type { ExecutionBindingStore, PersistedExecutionBinding } from './execution-binding-store'

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
  /** OXE-327: Optional session access level requested by this execution; capped by workspace ceiling. */
  access?: WorkspaceAccessLevel
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

export interface ExecutionRegistryOptions {
  store?: ExecutionBindingStore
}

/** Process-lifetime credentials (plus daemon-reconciled pane credentials); unrelated to provider conversation IDs. */
export class ExecutionRegistry {
  private executions = new Map<string, AgentExecution>()
  private generations = new Map<string, number>()
  private readonly store?: ExecutionBindingStore

  constructor(options: ExecutionRegistryOptions = {}) {
    this.store = options.store
  }

  register(input: ({ paneId: string; workspaceId: string; cwd: string } | { owner: ExecutionOwner; workspaceId: string; cwd: string }) & { access?: WorkspaceAccessLevel }): Record<string, string> {
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
    if (owner.kind === 'pane') this.persistPaneBindings()
    return { OXESPACE_EXECUTION_ID: execution.id, OXESPACE_EXECUTION_TOKEN: execution.token,
      OXESPACE_EXECUTION_GENERATION: String(generation), OXESPACE_WORKSPACE_ID: input.workspaceId }
  }

  /**
   * OXE-447 · Re-hydrates ONLY persisted pane bindings whose `paneId` is confirmed live by the PTY daemon,
   * purging stale/dead entries immediately from memory and disk. Idempotent across repeated reconciliations.
   */
  async reconcileWithLiveSessions(liveSessionIds: Iterable<string>): Promise<{ restored: string[]; purged: string[] }> {
    const live = new Set(liveSessionIds)
    const stored = this.store?.load() ?? []
    const restored: string[] = []
    const purged: string[] = []
    const kept: PersistedExecutionBinding[] = []

    for (const binding of stored) {
      if (binding.owner.kind !== 'pane' || !live.has(binding.paneId)) {
        purged.push(binding.paneId)
        continue
      }
      kept.push(binding)
      const existing = this.executions.get(binding.id)
      if (existing && existing.paneId === binding.paneId) {
        restored.push(binding.paneId)
        continue
      }
      const owner: ExecutionOwner = { kind: 'pane', id: binding.paneId }
      const ownerKey = this.key(owner)
      const prevGen = this.generations.get(ownerKey) ?? 0
      this.generations.set(ownerKey, Math.max(prevGen, binding.generation))
      const execution: AgentExecution = {
        id: binding.id,
        paneId: binding.paneId,
        owner,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
        canonicalRoot: resolve(binding.canonicalRoot || binding.cwd),
        generation: binding.generation,
        token: binding.token,
        ...(binding.access ? { access: binding.access } : {})
      }
      this.executions.set(execution.id, execution)
      executionSignals.set(owner, new AbortController())
      restored.push(binding.paneId)
    }

    // Purge any in-memory pane execution whose daemon session is no longer live.
    for (const [id, execution] of [...this.executions.entries()]) {
      if (execution.owner.kind === 'pane' && !live.has(execution.paneId)) {
        this.executions.delete(id)
        executionSignals.get(execution.owner)?.abort()
        if (!purged.includes(execution.paneId)) purged.push(execution.paneId)
      }
    }

    this.store?.save(this.currentPaneBindings(kept))
    return { restored, purged }
  }
  authenticate(id?: string, token?: string, workspaceId?: string | null): AgentExecution {
    const execution = id ? this.executions.get(id) : undefined
    const supplied = Buffer.from(token ?? '')
    if (!execution || execution.workspaceId !== workspaceId || supplied.length !== Buffer.byteLength(execution.token) || !timingSafeEqual(supplied, Buffer.from(execution.token))) {
      throw new Error('Delegation requires a live OXESpace terminal. Open a new terminal after enabling automation.')
    }
    return execution
  }
  /** Whether the execution is still running in this app process; an app restart or a new session of its owner ends it. */
  isLive(id: string | undefined): boolean { return id !== undefined && this.executions.has(id) }
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
    if (ended.some(execution => execution.owner.kind === 'pane')) this.persistPaneBindings()
  }
  private persistPaneBindings(): void {
    if (!this.store) return
    try { this.store.save(this.currentPaneBindings()) } catch { /* persistence must never block terminal lifecycle */ }
  }
  private currentPaneBindings(seed: readonly PersistedExecutionBinding[] = []): PersistedExecutionBinding[] {
    const byPane = new Map<string, PersistedExecutionBinding>()
    for (const item of seed) byPane.set(item.paneId, item)
    for (const execution of this.executions.values()) {
      if (execution.owner.kind !== 'pane') continue
      byPane.set(execution.paneId, {
        id: execution.id,
        paneId: execution.paneId,
        owner: { kind: 'pane', id: execution.owner.id },
        workspaceId: execution.workspaceId,
        cwd: execution.cwd,
        canonicalRoot: execution.canonicalRoot,
        generation: execution.generation,
        token: execution.token,
        ...(execution.access ? { access: execution.access } : {})
      })
    }
    return [...byPane.values()]
  }
  private key(owner: ExecutionOwner): string { return `${owner.kind}:${owner.id}` }
}
