import type { AgentProcessKind, AgentProcessPriority, AgentProcessState } from '../../../../shared/types/diagnostics'

export interface ManagedAgentProcessRegistration {
  rootPid: number
  provider: string
  kind: AgentProcessKind
  contextId: string
  label: string
  startedAt?: number
  state?: AgentProcessState
  idleSinceMs?: number | null
  priority?: AgentProcessPriority
  jobGoverned?: boolean
  nativeSessionId?: string | null
  isHeld?: () => boolean
  hibernate?: () => Promise<boolean>
  stop?: () => Promise<void>
}

export interface ManagedAgentProcessRecord {
  rootPid: number
  provider: string
  kind: AgentProcessKind
  contextId: string
  label: string
  startedAt: number
  state: AgentProcessState
  idleSinceMs: number | null
  priority: AgentProcessPriority
  jobGoverned: boolean
  nativeSessionId: string | null
  isHeld?: () => boolean
  hibernate?: () => Promise<boolean>
  stop?: () => Promise<void>
}

type RegisterListener = (record: ManagedAgentProcessRecord) => void

/**
 * Lightweight in-memory registry of OS root PIDs spawned and owned by OXESpace (OxeChat, OxeCode, Delegations,
 * Automations). Controls (`setPriority`, `hibernate`, `killTree`) strictly require membership here so external
 * machine processes can never be mutated or killed by mistake.
 */
export class ManagedAgentProcessRegistry {
  private readonly entries = new Map<number, ManagedAgentProcessRecord>()
  private readonly registerListeners = new Set<RegisterListener>()

  register(input: ManagedAgentProcessRegistration): ManagedAgentProcessRecord {
    const pid = Math.trunc(input.rootPid)
    if (!Number.isInteger(pid) || pid <= 1) {
      throw new Error('Invalid managed process PID')
    }
    const existing = this.entries.get(pid)
    const now = Date.now()
    const state: AgentProcessState = input.state ?? existing?.state ?? 'active'
    const idleSinceMs =
      state === 'idle'
        ? (input.idleSinceMs ?? existing?.idleSinceMs ?? now)
        : null
    const record: ManagedAgentProcessRecord = {
      rootPid: pid,
      provider: input.provider.trim().toLowerCase() || 'agent',
      kind: input.kind,
      contextId: input.contextId,
      label: input.label,
      startedAt: input.startedAt ?? existing?.startedAt ?? now,
      state,
      idleSinceMs,
      priority: input.priority ?? existing?.priority ?? 'normal',
      jobGoverned: input.jobGoverned ?? existing?.jobGoverned ?? false,
      nativeSessionId: input.nativeSessionId !== undefined ? input.nativeSessionId : (existing?.nativeSessionId ?? null),
      isHeld: input.isHeld ?? existing?.isHeld,
      hibernate: input.hibernate ?? existing?.hibernate,
      stop: input.stop ?? existing?.stop
    }
    const isNew = !existing
    this.entries.set(pid, record)
    if (isNew) {
      for (const listener of [...this.registerListeners]) {
        try { listener(record) } catch { /* listeners must never break process launch */ }
      }
    }
    return record
  }

  unregister(rootPid: number): boolean {
    return this.entries.delete(Math.trunc(rootPid))
  }

  markState(rootPid: number, state: AgentProcessState, now = Date.now()): boolean {
    const record = this.entries.get(Math.trunc(rootPid))
    if (!record) return false
    record.state = state
    record.idleSinceMs = state === 'idle' ? (record.idleSinceMs ?? now) : null
    return true
  }

  markContextState(
    contextId: string,
    state: AgentProcessState,
    now = Date.now(),
    extra?: { nativeSessionId?: string | null; kind?: AgentProcessKind }
  ): number {
    let updated = 0
    for (const record of this.entries.values()) {
      if (record.contextId !== contextId) continue
      record.state = state
      record.idleSinceMs = state === 'idle' ? (record.idleSinceMs ?? now) : null
      if (extra?.nativeSessionId !== undefined) record.nativeSessionId = extra.nativeSessionId
      if (extra?.kind) record.kind = extra.kind
      updated++
    }
    return updated
  }

  setPriorityState(rootPid: number, priority: AgentProcessPriority, jobGoverned?: boolean): boolean {
    const record = this.entries.get(Math.trunc(rootPid))
    if (!record) return false
    record.priority = priority
    if (typeof jobGoverned === 'boolean') record.jobGoverned = jobGoverned
    return true
  }

  get(rootPid: number): ManagedAgentProcessRecord | undefined {
    return this.entries.get(Math.trunc(rootPid))
  }

  has(rootPid: number): boolean {
    return this.entries.has(Math.trunc(rootPid))
  }

  findByContext(contextId: string): ManagedAgentProcessRecord[] {
    const out: ManagedAgentProcessRecord[] = []
    for (const record of this.entries.values()) {
      if (record.contextId === contextId) out.push(record)
    }
    return out
  }

  listManaged(): ManagedAgentProcessRecord[] {
    return [...this.entries.values()]
  }

  onRegister(listener: RegisterListener): () => void {
    this.registerListeners.add(listener)
    return () => { this.registerListeners.delete(listener) }
  }

  clear(): void {
    this.entries.clear()
  }
}

export const managedAgentProcessRegistry = new ManagedAgentProcessRegistry()
