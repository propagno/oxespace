import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { evaluatePolicy, type LoadedPolicy, type PolicyAction, type PolicyChangeStatus, type PolicyDecision, type PolicyLayer, type PolicySource } from '../../../../shared/policy'
import type { AcceptedConfig, PolicyProjection, Subject } from './accepted-config'
import { MAX_POLICY_BYTES, parsePolicyProjection, tooLarge } from './projections'

/** Where an administrator installs the managed policy, which every other layer gives way to. */
export function managedPolicyPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return join(env.ProgramData ?? env.PROGRAMDATA ?? 'C:\\ProgramData', 'OXESpace', 'policy.json')
  if (platform === 'darwin') return '/Library/Application Support/OXESpace/policy.json'
  return '/etc/oxespace/policy.json'
}

type ReadResult = { source?: PolicySource; problem?: string }

/**
 * Reads the policy files: the project's `.oxespace/policy.json`, the user's `<userData>/policy.json` and the
 * managed file. Each is read again when its modification time, size or change time moves, so an edit applies without
 * a restart (and a write that keeps the old modification time is still seen: the change time cannot be set back).
 * The one writer is Settings › Tools (B7.3, mcp-tool-rules.ts), which changes the project layer at the person's request
 * from the app's window; nothing writes the user or managed layers, and no plugin or MCP tool writes any.
 *
 * B7.4: with a gate (accepted-config.ts), a layer applies only in the version the person accepted. A file that differs
 * (edited, deleted, broken) keeps the accepted rules in force while the change is compared and, if it widens anything,
 * asked. The managed file is gated too unless it is out of the user's reach.
 */
export class PolicyStore {
  private readonly cache = new Map<string, { key: string; version: number; result: ReadResult | null }>()
  private gate: AcceptedConfig | null = null
  /** Whether the managed file is out of reach, by its stat key: probed again only when the file changes. */
  private managedProbe: { key: string; protected: boolean } | null = null

  constructor(private readonly paths: { userData: string; managed?: string }) {}

  setGate(gate: AcceptedConfig | null): void {
    this.gate = gate
    this.cache.clear()
  }

  /** Where each layer's file is looked for, in evaluation order. */
  locations(projectRoot?: string | null): Array<{ layer: PolicyLayer; path: string }> {
    return [
      ...(projectRoot ? [{ layer: 'project' as const, path: join(projectRoot, '.oxespace', 'policy.json') }] : []),
      { layer: 'user', path: join(this.paths.userData, 'policy.json') },
      { layer: 'managed', path: this.paths.managed ?? managedPolicyPath() }
    ]
  }

  /** Every layer for a project root (or none for app-wide checks), in evaluation order. */
  load(projectRoot?: string | null): LoadedPolicy {
    const policy: LoadedPolicy = { sources: [], problems: [] }
    for (const { layer, path } of this.locations(projectRoot)) {
      const result = this.read(layer, path, projectRoot ?? null)
      if (result?.source) policy.sources.push(result.source)
      if (result?.problem) policy.problems.push(result.problem)
    }
    return policy
  }

  /** B7.4 · The gated subject of each layer's file for this project (none without a gate). */
  subjects(projectRoot?: string | null): Subject[] {
    const gate = this.gate
    return gate ? this.locations(projectRoot).map(({ layer, path }) => gate.subject('policy', layer, projectRoot ?? null, path)) : []
  }

  /** B7.4 · Layers whose file is not the accepted version, after reading them. */
  changes(projectRoot?: string | null): PolicyChangeStatus[] {
    this.load(projectRoot)
    return this.gate ? this.gate.status(this.subjects(projectRoot)) : []
  }

  /** Drops what was read from a file, so a write in the same millisecond as the last read is never missed. */
  forget(path: string): void { this.cache.delete(path) }

  decide(action: PolicyAction, resource: string, projectRoot?: string | null): PolicyDecision {
    return evaluatePolicy(this.load(projectRoot), action, resource)
  }

  private managedProtected(gate: AcceptedConfig, path: string, key: string): boolean {
    if (this.managedProbe?.key !== `${path}\0${key}`) this.managedProbe = { key: `${path}\0${key}`, protected: gate.managedProtected(path) }
    return this.managedProbe.protected
  }

  private read(layer: PolicyLayer, path: string, projectRoot: string | null): ReadResult | null {
    let size = 0
    let key = 'absent'
    try {
      const stat = statSync(path)
      if (stat.isFile()) { key = `${stat.mtimeMs}:${stat.size}:${stat.ctimeMs}`; size = stat.size }
    } catch { /* no file */ }
    const cached = this.cache.get(path)
    if (cached && cached.key === key && cached.version === (this.gate?.version ?? 0)) return cached.result
    let text: string | null = null
    let found: { projection: PolicyProjection; problem?: string }
    if (key === 'absent') found = parsePolicyProjection(null, layer, path)
    else if (size > MAX_POLICY_BYTES) found = tooLarge(path)
    else {
      try { text = readFileSync(path, 'utf8') } catch { /* unreadable */ }
      found = text === null ? { projection: { state: 'invalid' }, problem: `${path}: could not be read` } : parsePolicyProjection(text, layer, path)
    }
    let effective = found.projection
    let problem = found.problem
    const gate = this.gate
    // The managed file has the last word: it stays ungated only where people on this computer cannot write it.
    if (gate && !(layer === 'managed' && key !== 'absent' && this.managedProtected(gate, path, key))) {
      effective = gate.resolve(gate.subject('policy', layer, projectRoot, path), found.projection)
      if (effective !== found.projection) problem = `${path}: not the version you accepted${found.problem ? ` (${found.problem.slice(path.length + 2)})` : ''}; the accepted version applies`
    }
    const result: ReadResult | null = effective.state === 'value'
      ? { source: { layer, path, ...(effective.value.organization ? { organization: effective.value.organization } : {}), rules: effective.value.rules }, ...(problem ? { problem } : {}) }
      : effective.state === 'invalid' || problem ? { problem: problem ?? `${path}: not valid` } : null
    this.cache.set(path, { key, version: gate?.version ?? 0, result })
    return result
  }
}
