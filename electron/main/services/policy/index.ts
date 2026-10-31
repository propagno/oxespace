import { app } from 'electron'
import { evaluatePolicy, policyBlockedMessage } from '../../../../shared/policy'
import { noteWithheld, scrubEnvironment, type EnvScope } from '../../../../shared/env-scrub'
import { PolicyStore } from './policy-store'

/**
 * The app's policy, created on first use from Electron's userData folder. Outside the app (unit tests) there is
 * no `app`, so there is no policy and nothing is blocked; tests that need one pass a store explicitly.
 */
let store: PolicyStore | null | undefined

export function setPolicyStore(next: PolicyStore | null): void { store = next }
export function policyStore(): PolicyStore | null {
  if (store === undefined) {
    try { store = app?.getPath ? new PolicyStore({ userData: app.getPath('userData') }) : null } catch { store = null }
  }
  return store
}

/** Whether policy lets agents use an MCP server, by its configured name, in a project. */
export function mcpServerAllowed(name: string, projectRoot?: string | null, policy: PolicyStore | null = policyStore()): boolean {
  return !policy || policy.decide('integration.use', `mcp:${name}`, projectRoot).allowed
}

/**
 * Server names a policy denies outright (`mcp:<name>` without wildcards), still denied after every layer. They
 * become launch exclusions, which also reach servers configured directly in a CLI rather than in OXESpace.
 */
export function policyDeniedMcpNames(projectRoot?: string | null, policy: PolicyStore | null = policyStore()): string[] {
  if (!policy) return []
  const loaded = policy.load(projectRoot)
  const names = new Set<string>()
  for (const source of loaded.sources) {
    for (const rule of source.rules) {
      if (rule.action !== 'integration.use' || rule.effect !== 'deny' || !rule.resource.toLowerCase().startsWith('mcp:')) continue
      const name = rule.resource.slice(4)
      if (name && !name.includes('*') && !evaluatePolicy(loaded, 'integration.use', `mcp:${name}`).allowed) names.add(name)
    }
  }
  return [...names]
}

/**
 * Tool names a policy denies, still denied after every layer, for launch exclusions: exact names, plus MCP rules with
 * wildcards or a whole server (`mcp__github`, `mcp__github__*`, `mcp__github__delete_*`), which thread-mcp.ts resolves per CLI.
 */
export function policyDeniedToolNames(projectRoot?: string | null, policy: PolicyStore | null = policyStore()): string[] {
  if (!policy) return []
  const loaded = policy.load(projectRoot)
  const names = new Set<string>()
  for (const source of loaded.sources) {
    for (const rule of source.rules) {
      if (rule.action !== 'tool.use' || rule.effect !== 'deny' || (rule.resource.includes('*') && !/^mcp__[^*]/i.test(rule.resource))) continue
      if (!evaluatePolicy(loaded, 'tool.use', rule.resource).allowed) names.add(rule.resource)
    }
  }
  return [...names]
}

/** Refuses to start an agent the policy blocks, with the message a person sees. */
export function assertProviderAllowed(provider: string, projectRoot?: string | null, policy: PolicyStore | null = policyStore()): void {
  if (!policy) return
  const decision = policy.decide('provider.use', provider, projectRoot)
  if (!decision.allowed) throw new Error(policyBlockedMessage(decision, provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : provider))
}

/** The message to show when policy blocks an integration (`db:<name>`, `skill:<id>`, `memory`), or nothing. */
export function integrationBlocked(resource: string, what: string, projectRoot?: string | null, policy: PolicyStore | null = policyStore()): string | undefined {
  if (!policy) return undefined
  const decision = policy.decide('integration.use', resource, projectRoot)
  return decision.allowed ? undefined : policyBlockedMessage(decision, what)
}

/**
 * The environment an agent-side child process (a provider CLI, a hook, an MCP server) inherits: secret-looking
 * variables are left out unless the provider needs them or policy allows `env:<NAME>` (roadmap S7). Names withheld
 * are remembered, names only, for Settings and diagnostics.
 */
export function inheritedEnvironment(scope: EnvScope, projectRoot?: string | null, source: NodeJS.ProcessEnv = process.env,
  policy: PolicyStore | null = policyStore()): NodeJS.ProcessEnv {
  const result = scrubEnvironment(source, { scope, policy: policy ? policy.load(projectRoot) : null })
  noteWithheld(scope, result.withheld)
  return result.env
}
