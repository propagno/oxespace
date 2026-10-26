/**
 * Organization policy in simple rules (roadmap C1).
 *
 * A rule allows or denies an action on a resource: `{ "effect": "deny", "action": "integration.use",
 * "resource": "mcp:github" }`. Resources are names with `*` wildcards, compared without case:
 * - `provider.use`: `claude`, `codex`;
 * - `tool.use`: a tool name as the agent reports it (`Bash`, `mcp__github__create_issue`);
 * - `integration.use`: `mcp:<server>`, `skill:<id>`, `db:<connection>`, `memory`.
 *
 * Rules are read from three layers, in this order: the project (`.oxespace/policy.json`), the user
 * (`<userData>/policy.json`) and the managed file an administrator installs. The last rule that matches decides,
 * so the managed file always has the final word. With no matching rule the action is allowed: policy blocks,
 * it never grants anything the app would not already do. `allow` only lifts an earlier `deny`.
 */
export type PolicyAction = 'provider.use' | 'tool.use' | 'integration.use'
export type PolicyEffect = 'allow' | 'deny'
export type PolicyLayer = 'project' | 'user' | 'managed'

export interface PolicyRule { effect: PolicyEffect; action: PolicyAction; resource: string }

/** One policy file, as read. */
export interface PolicySource { layer: PolicyLayer; path: string; organization?: string; rules: PolicyRule[] }

/** Every layer that applies to a project, in evaluation order, and the files that could not be used. */
export interface LoadedPolicy { sources: PolicySource[]; problems: string[] }

export interface PolicyDecision {
  allowed: boolean
  /** The rule that decided, when one matched. */
  rule?: PolicyRule
  layer?: PolicyLayer
  organization?: string
  path?: string
}

const ACTIONS: readonly PolicyAction[] = ['provider.use', 'tool.use', 'integration.use']
const MAX_RULES = 500
const MAX_RESOURCE = 200

export const LAYER_ORDER: readonly PolicyLayer[] = ['project', 'user', 'managed']

/** Reads one policy file's text. A file that is not a valid policy is refused whole, never applied in part. */
export function parsePolicy(text: string, layer: PolicyLayer, path: string): { source: PolicySource } | { problem: string } {
  let value: unknown
  try { value = JSON.parse(text) } catch { return { problem: `${path}: not valid JSON` } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problem: `${path}: expected an object with "rules"` }
  const document = value as { organization?: unknown; rules?: unknown }
  if (!Array.isArray(document.rules)) return { problem: `${path}: "rules" must be a list` }
  if (document.rules.length > MAX_RULES) return { problem: `${path}: more than ${MAX_RULES} rules` }
  const rules: PolicyRule[] = []
  for (const [index, entry] of document.rules.entries()) {
    const rule = entry as Partial<Record<keyof PolicyRule, unknown>>
    if (!rule || typeof rule !== 'object') return { problem: `${path}: rule ${index + 1} is not an object` }
    if (rule.effect !== 'allow' && rule.effect !== 'deny') return { problem: `${path}: rule ${index + 1} needs "effect": "allow" or "deny"` }
    if (!ACTIONS.includes(rule.action as PolicyAction)) return { problem: `${path}: rule ${index + 1} has an unknown "action"; use ${ACTIONS.join(', ')}` }
    if (typeof rule.resource !== 'string' || !rule.resource.trim() || rule.resource.length > MAX_RESOURCE) return { problem: `${path}: rule ${index + 1} needs a "resource"` }
    rules.push({ effect: rule.effect, action: rule.action as PolicyAction, resource: rule.resource.trim() })
  }
  const organization = typeof document.organization === 'string' && document.organization.trim() ? document.organization.trim().slice(0, 80) : undefined
  return { source: { layer, path, ...(organization ? { organization } : {}), rules } }
}

/** `*` matches any run of characters; everything else is literal; case does not matter. */
export function matchesResource(pattern: string, resource: string): boolean {
  const escaped = pattern.toLowerCase().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${escaped}$`).test(resource.toLowerCase())
}

/** The decision for one action on one resource: the last matching rule across the layers, in order. */
export function evaluatePolicy(policy: LoadedPolicy, action: PolicyAction, resource: string): PolicyDecision {
  let decision: PolicyDecision = { allowed: true }
  const sources = [...policy.sources].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))
  for (const source of sources) {
    for (const rule of source.rules) {
      if (rule.action !== action || !matchesResource(rule.resource, resource)) continue
      decision = { allowed: rule.effect === 'allow', rule, layer: source.layer, path: source.path, ...(source.organization ? { organization: source.organization } : {}) }
    }
  }
  return decision
}

/** What a person sees when policy blocks something. */
export function policyBlockedMessage(decision: PolicyDecision, what: string): string {
  const owner = decision.organization ? `${decision.organization} policy` : decision.layer === 'managed' ? 'your organization’s policy' : decision.layer === 'project' ? 'this project’s policy' : 'your policy'
  return `${what} is blocked by ${owner}.`
}
