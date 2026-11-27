import type { AgentProcessGovernancePolicy } from '../../../../shared/types/diagnostics'
import type { ManagedAgentProcessRecord, ManagedAgentProcessRegistry } from './agent-process-registry'

export interface ReapedAgentSession {
  rootPid: number
  contextId: string
  provider: string
  nativeSessionId: string | null
  idleMs: number
}

export type IdleReapSkipReason =
  | 'disabled'
  | 'active'
  | 'below-ttl'
  | 'held'
  | 'no-hibernate-hook'
  | 'failed'

export interface IdleReapReport {
  reaped: ReapedAgentSession[]
  skipped: Array<{ rootPid: number; reason: IdleReapSkipReason }>
}

export interface AgentIdleReaperDeps {
  registry: ManagedAgentProcessRegistry
  getPolicy: () => AgentProcessGovernancePolicy
  hibernateManaged?: (entry: ManagedAgentProcessRecord) => Promise<boolean>
  sweepIntervalMs?: number
}

const DEFAULT_SWEEP_INTERVAL_MS = 60_000

/**
 * Gracefully terminates idle managed ACP/CLI processes exceeding the configured TTL while preserving
 * `nativeSessionId` so the next user message transparently resumes the conversation.
 */
export class AgentIdleReaper {
  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false
  private readonly sweepIntervalMs: number

  constructor(private readonly deps: AgentIdleReaperDeps) {
    this.sweepIntervalMs = deps.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.sweep().catch(() => undefined)
    }, this.sweepIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async sweep(now = Date.now()): Promise<IdleReapReport> {
    if (this.sweeping) return { reaped: [], skipped: [] }
    this.sweeping = true
    try {
      const policy = this.deps.getPolicy()
      const entries = this.deps.registry.listManaged()
      if (!policy.idleReaperEnabled || policy.idleTtlMinutes <= 0) {
        return {
          reaped: [],
          skipped: entries.map(entry => ({ rootPid: entry.rootPid, reason: 'disabled' as const }))
        }
      }

      const ttlMs = policy.idleTtlMinutes * 60_000
      const reaped: ReapedAgentSession[] = []
      const skipped: Array<{ rootPid: number; reason: IdleReapSkipReason }> = []

      for (const entry of entries) {
        if (entry.state !== 'idle' || entry.idleSinceMs === null) {
          skipped.push({ rootPid: entry.rootPid, reason: 'active' })
          continue
        }
        const idleMs = Math.max(0, now - entry.idleSinceMs)
        if (idleMs < ttlMs) {
          skipped.push({ rootPid: entry.rootPid, reason: 'below-ttl' })
          continue
        }
        if (entry.isHeld?.()) {
          skipped.push({ rootPid: entry.rootPid, reason: 'held' })
          continue
        }

        const hibernateFn = entry.hibernate
          ? () => entry.hibernate!()
          : this.deps.hibernateManaged
            ? () => this.deps.hibernateManaged!(entry)
            : null
        if (!hibernateFn) {
          skipped.push({ rootPid: entry.rootPid, reason: 'no-hibernate-hook' })
          continue
        }

        try {
          const ok = await hibernateFn()
          if (!ok) {
            skipped.push({ rootPid: entry.rootPid, reason: 'failed' })
            continue
          }
          this.deps.registry.unregister(entry.rootPid)
          reaped.push({
            rootPid: entry.rootPid,
            contextId: entry.contextId,
            provider: entry.provider,
            nativeSessionId: entry.nativeSessionId,
            idleMs
          })
        } catch {
          skipped.push({ rootPid: entry.rootPid, reason: 'failed' })
        }
      }

      return { reaped, skipped }
    } finally {
      this.sweeping = false
    }
  }
}
