import { app } from 'electron'
import { evaluatePolicy, policyBlockedMessage } from '../../../../shared/policy'
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

/** Tool names a policy denies outright (no wildcards), still denied after every layer. Claude hides them at launch. */
export function policyDeniedToolNames(projectRoot?: string | null, policy: PolicyStore | null = policyStore()): string[] {
  if (!policy) return []
  const loaded = policy.load(projectRoot)
  const names = new Set<string>()
  for (const source of loaded.sources) {
    for (const rule of source.rules) {
      if (rule.action !== 'tool.use' || rule.effect !== 'deny' || rule.resource.includes('*')) continue
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
