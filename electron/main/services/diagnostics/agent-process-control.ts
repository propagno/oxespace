import { constants, setPriority as nodeSetPriority } from 'node:os'
import type {
  AgentProcessActionResult,
  AgentProcessGovernancePolicy,
  AgentProcessPriority,
  AgentProcessPriorityResult
} from '../../../../shared/types/diagnostics'
import { killProcessTree } from '../../utils/process-tree'
import type { ManagedAgentProcessRecord, ManagedAgentProcessRegistry } from './agent-process-registry'
import { walkDescendants, type OsProcessSampler } from './agent-processes'

/**
 * Optional OS-specific containment seam (Windows Job Object `KILL_ON_JOB_CLOSE` / EcoQoS or Linux cgroups v2).
 * Always degrades gracefully to standard `os.setPriority` + `killProcessTree` when native hooks are unavailable.
 */
export interface ProcessGovernanceBackend {
  applyEcoGovernance?(
    rootPid: number,
    pids: number[],
    priority: AgentProcessPriority
  ): Promise<{ governed: boolean; mechanism?: 'win32-job-object' | 'linux-cgroup-v2' | 'os-priority' }>
  closeGovernance?(rootPid: number): Promise<boolean>
}

export function createDefaultGovernanceBackend(): ProcessGovernanceBackend {
  return {
    async applyEcoGovernance() {
      return { governed: false, mechanism: 'os-priority' }
    },
    async closeGovernance() {
      return false
    }
  }
}

export function priorityToOsValue(priority: AgentProcessPriority): number {
  switch (priority) {
    case 'low':
      return constants.priority.PRIORITY_LOW
    case 'belowNormal':
      return constants.priority.PRIORITY_BELOW_NORMAL
    case 'normal':
    default:
      return constants.priority.PRIORITY_NORMAL
  }
}

export interface AgentProcessControllerDeps {
  registry: ManagedAgentProcessRegistry
  sampler: OsProcessSampler
  getPolicy: () => AgentProcessGovernancePolicy
  setOsPriority?: (pid: number, priority: number) => void
  killTree?: (pid: number) => Promise<void>
  governance?: ProcessGovernanceBackend
  selfPid?: number
  parentPid?: number
  hibernateManaged?: (entry: ManagedAgentProcessRecord) => Promise<boolean>
}

/**
 * Governs ONLY processes registered in `ManagedAgentProcessRegistry`.
 * External processes on the machine are strictly refused for every control operation.
 */
export class AgentProcessController {
  private readonly setOsPriority: (pid: number, priority: number) => void
  private readonly killTreeFn: (pid: number) => Promise<void>
  private readonly governance: ProcessGovernanceBackend
  private readonly selfPid: number
  private readonly parentPid: number

  constructor(private readonly deps: AgentProcessControllerDeps) {
    this.setOsPriority = deps.setOsPriority ?? ((pid, value) => { nodeSetPriority(pid, value) })
    this.killTreeFn = deps.killTree ?? ((pid) => killProcessTree(pid))
    this.governance = deps.governance ?? createDefaultGovernanceBackend()
    this.selfPid = deps.selfPid ?? process.pid
    this.parentPid = deps.parentPid ?? process.ppid
  }

  private isSafeTargetPid(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 1) return false
    if (pid === this.selfPid || pid === this.parentPid) return false
    if (process.platform === 'win32' && pid === 4) return false
    return true
  }

  async setPriority(rootPid: number, priority: AgentProcessPriority): Promise<AgentProcessPriorityResult> {
    const pid = Math.trunc(rootPid)
    const entry = this.deps.registry.get(pid)
    if (!entry) {
      return {
        ok: false,
        rootPid: pid,
        priority,
        appliedPids: [],
        failedPids: [],
        jobGoverned: false,
        error: 'Refused: process is not managed by OXESpace'
      }
    }

    const samples = await this.deps.sampler().catch(() => [])
    const descendants = walkDescendants(samples, pid)
    const targets = [pid, ...descendants].filter(candidate => this.isSafeTargetPid(candidate))
    const osValue = priorityToOsValue(priority)

    const appliedPids: number[] = []
    const failedPids: number[] = []
    for (const targetPid of targets) {
      try {
        this.setOsPriority(targetPid, osValue)
        appliedPids.push(targetPid)
      } catch {
        failedPids.push(targetPid)
      }
    }

    let jobGoverned = entry.jobGoverned
    if (this.governance.applyEcoGovernance) {
      try {
        const res = await this.governance.applyEcoGovernance(pid, targets, priority)
        jobGoverned = Boolean(res?.governed)
      } catch {
        jobGoverned = false
      }
    }

    const ok = appliedPids.length > 0 || jobGoverned
    if (ok) {
      this.deps.registry.setPriorityState(pid, priority, jobGoverned)
    }

    return {
      ok,
      rootPid: pid,
      priority,
      appliedPids,
      failedPids,
      jobGoverned,
      ...(ok ? {} : { error: 'Could not change OS priority for this process tree' })
    }
  }

  async hibernate(rootPid: number): Promise<AgentProcessActionResult> {
    const pid = Math.trunc(rootPid)
    const entry = this.deps.registry.get(pid)
    if (!entry) {
      return {
        ok: false,
        rootPid: pid,
        error: 'Refused: process is not managed by OXESpace'
      }
    }
    if (entry.state === 'active') {
      return {
        ok: false,
        rootPid: pid,
        error: 'Cannot hibernate an active agent process'
      }
    }
    if (entry.isHeld?.()) {
      return {
        ok: false,
        rootPid: pid,
        error: 'Agent session is held by a pending operation'
      }
    }

    try {
      const handled = entry.hibernate
        ? await entry.hibernate()
        : this.deps.hibernateManaged
          ? await this.deps.hibernateManaged(entry)
          : false
      if (!handled) {
        if (entry.stop) await entry.stop()
        else await this.killTreeFn(pid)
      }
      this.deps.registry.unregister(pid)
      return { ok: true, rootPid: pid }
    } catch (error) {
      return {
        ok: false,
        rootPid: pid,
        error: error instanceof Error ? error.message : 'Failed to hibernate agent process'
      }
    }
  }

  async killTree(rootPid: number): Promise<AgentProcessActionResult> {
    const pid = Math.trunc(rootPid)
    const entry = this.deps.registry.get(pid)
    if (!entry) {
      return {
        ok: false,
        rootPid: pid,
        error: 'Refused: only OXESpace-managed agent processes can be terminated'
      }
    }

    const samples = await this.deps.sampler().catch(() => [])
    const descendants = walkDescendants(samples, pid)
    const terminatedPids = [pid, ...descendants].filter(candidate => this.isSafeTargetPid(candidate))

    try {
      await this.governance.closeGovernance?.(pid).catch(() => false)
      if (entry.stop) {
        await entry.stop().catch(() => undefined)
      }
      await this.killTreeFn(pid)
      this.deps.registry.unregister(pid)
      return {
        ok: true,
        rootPid: pid,
        terminatedPids
      }
    } catch (error) {
      return {
        ok: false,
        rootPid: pid,
        error: error instanceof Error ? error.message : 'Failed to terminate managed process tree'
      }
    }
  }

  /**
   * Automatically applies Eco (`belowNormal`) priority to newly registered background trees
   * (`delegation`, `automation`) when `policy.autoEcoBackground` is enabled.
   */
  attachAutoEco(): () => void {
    return this.deps.registry.onRegister(record => {
      if (record.kind !== 'delegation' && record.kind !== 'automation') return
      if (!this.deps.getPolicy().autoEcoBackground) return
      void this.setPriority(record.rootPid, 'belowNormal').catch(() => undefined)
    })
  }
}
