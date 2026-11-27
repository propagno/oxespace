import {
  DEFAULT_AGENT_PROCESS_POLICY,
  type AgentProcessGovernancePolicy
} from '../../../../shared/types/diagnostics'
import { readJson, writePrivateJson } from '../private-json'

const MIN_IDLE_TTL_MINUTES = 0
const MAX_IDLE_TTL_MINUTES = 240
const MIN_CONCURRENT_AGENTS = 1
const MAX_CONCURRENT_AGENTS = 32

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const rounded = Math.trunc(value)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

export function normalizeAgentProcessPolicy(
  raw: unknown,
  base: AgentProcessGovernancePolicy = DEFAULT_AGENT_PROCESS_POLICY
): AgentProcessGovernancePolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base }
  }
  const input = raw as Record<string, unknown>
  return {
    autoEcoBackground: typeof input.autoEcoBackground === 'boolean' ? input.autoEcoBackground : base.autoEcoBackground,
    idleReaperEnabled: typeof input.idleReaperEnabled === 'boolean' ? input.idleReaperEnabled : base.idleReaperEnabled,
    idleTtlMinutes: clampInt(input.idleTtlMinutes, base.idleTtlMinutes, MIN_IDLE_TTL_MINUTES, MAX_IDLE_TTL_MINUTES),
    maxConcurrentAgents: clampInt(
      input.maxConcurrentAgents,
      base.maxConcurrentAgents,
      MIN_CONCURRENT_AGENTS,
      MAX_CONCURRENT_AGENTS
    )
  }
}

/**
 * Owner-only JSON preference store (`<userData>/agent-process-policy.json`) backed by `private-json.ts`.
 * Requires zero SQLite migrations and zero additional `node:fs` allowlist entries.
 */
export class AgentProcessPolicyStore {
  private current: AgentProcessGovernancePolicy = { ...DEFAULT_AGENT_PROCESS_POLICY }
  private loaded = false

  constructor(private readonly filePath: string) {}

  async load(): Promise<AgentProcessGovernancePolicy> {
    try {
      const raw = await readJson(this.filePath)
      this.current = normalizeAgentProcessPolicy(raw)
    } catch {
      this.current = { ...DEFAULT_AGENT_PROCESS_POLICY }
    }
    this.loaded = true
    return { ...this.current }
  }

  get(): AgentProcessGovernancePolicy {
    return { ...this.current }
  }

  async update(patch: Partial<AgentProcessGovernancePolicy>): Promise<AgentProcessGovernancePolicy> {
    if (!this.loaded) await this.load()
    const next = normalizeAgentProcessPolicy(patch, this.current)
    await writePrivateJson(this.filePath, next)
    this.current = next
    return { ...this.current }
  }
}
