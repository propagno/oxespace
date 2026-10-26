import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { evaluatePolicy, parsePolicy, type LoadedPolicy, type PolicyAction, type PolicyDecision, type PolicyLayer, type PolicySource } from '../../../../shared/policy'

/** Where an administrator installs the managed policy, which every other layer gives way to. */
export function managedPolicyPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return join(env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData', 'OXESpace', 'policy.json')
  if (platform === 'darwin') return '/Library/Application Support/OXESpace/policy.json'
  return '/etc/oxespace/policy.json'
}

const MAX_BYTES = 256 * 1024

/**
 * Reads the policy files: the project's `.oxespace/policy.json`, the user's `<userData>/policy.json` and the
 * managed file. Each is read again when its modification time changes, so an edit applies without a restart.
 * Policy is only read here; nothing in the app, a plugin or an MCP server writes it.
 */
export class PolicyStore {
  private readonly cache = new Map<string, { mtimeMs: number; result: { source: PolicySource } | { problem: string } | null }>()

  constructor(private readonly paths: { userData: string; managed?: string }) {}

  /** Every layer for a project root (or none for app-wide checks), in evaluation order. */
  load(projectRoot?: string | null): LoadedPolicy {
    const files: Array<[PolicyLayer, string]> = [
      ...(projectRoot ? [['project', join(projectRoot, '.oxespace', 'policy.json')] as [PolicyLayer, string]] : []),
      ['user', join(this.paths.userData, 'policy.json')],
      ['managed', this.paths.managed ?? managedPolicyPath()]
    ]
    const policy: LoadedPolicy = { sources: [], problems: [] }
    for (const [layer, path] of files) {
      const result = this.read(layer, path)
      if (!result) continue
      if ('source' in result) policy.sources.push(result.source)
      else policy.problems.push(result.problem)
    }
    return policy
  }

  decide(action: PolicyAction, resource: string, projectRoot?: string | null): PolicyDecision {
    return evaluatePolicy(this.load(projectRoot), action, resource)
  }

  private read(layer: PolicyLayer, path: string): { source: PolicySource } | { problem: string } | null {
    let mtimeMs: number
    try {
      const stat = statSync(path)
      if (!stat.isFile()) return null
      if (stat.size > MAX_BYTES) return { problem: `${path}: larger than ${MAX_BYTES / 1024} KB` }
      mtimeMs = stat.mtimeMs
    } catch { this.cache.delete(path); return null }
    const cached = this.cache.get(path)
    if (cached && cached.mtimeMs === mtimeMs) return cached.result
    let result: { source: PolicySource } | { problem: string }
    try { result = parsePolicy(readFileSync(path, 'utf8'), layer, path) } catch { result = { problem: `${path}: could not be read` } }
    this.cache.set(path, { mtimeMs, result })
    return result
  }
}
