/**
 * Organization policy in simple rules (roadmap C1).
 *
 * A rule allows or denies an action on a resource: `{ "effect": "deny", "action": "integration.use",
 * "resource": "mcp:github" }`. Resources are names with `*` wildcards, compared without case:
 * - `provider.use`: `claude`, `codex`;
 * - `tool.use`: a tool name as the agent reports it (`Bash`, `mcp__github__create_issue`); `mcp__github` covers the server's tools;
 * - `integration.use`: `mcp:<server>`, `skill:<id>`, `db:<connection>`, `memory`;
 * - `integration.use` also takes `env:<NAME>` (an allow lets a secret-looking variable reach agent child processes; a deny withholds
 *   one, see env-scrub.ts) and `net:<domain>` (network reach; evaluated by net-policy.ts, not enforced yet);
 * - `db.write`: `<environment>:<connection>` (`prod:*`, `*:reports-db`). A `deny` makes the connection read-only in OxeQuery.
 *
 * Rules are read from three layers, in this order: the project (`.oxespace/policy.json`), the user
 * (`<userData>/policy.json`) and the managed file an administrator installs. The last rule that matches decides,
 * so the managed file always has the final word. With no matching rule the action is allowed: policy blocks,
 * it never grants anything the app would not already do. `allow` only lifts an earlier `deny`.
 */
export type PolicyAction = 'provider.use' | 'tool.use' | 'integration.use' | 'db.write'
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

const ACTIONS: readonly PolicyAction[] = ['provider.use', 'tool.use', 'integration.use', 'db.write']
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

/** The server part of an MCP tool name (`mcp__github` for `mcp__github__create_issue`), split as Claude splits it. */
export function mcpToolServer(name: string): string | undefined {
  return /^(mcp__.+?)__.+$/.exec(name)?.[1]
}

/** The decision for one action on one resource: the last matching rule across the layers, in order. */
export function evaluatePolicy(policy: LoadedPolicy, action: PolicyAction, resource: string): PolicyDecision {
  let decision: PolicyDecision = { allowed: true }
  // As in Claude, a `tool.use` rule naming a whole MCP server (`mcp__github`) covers each of its tools.
  const server = action === 'tool.use' ? mcpToolServer(resource) : undefined
  const sources = [...policy.sources].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))
  for (const source of sources) {
    for (const rule of source.rules) {
      if (rule.action !== action || !(matchesResource(rule.resource, resource) || (server !== undefined && matchesResource(rule.resource, server)))) continue
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

/** B7.4 · A gated file: a policy layer's `policy.json`, or the tool group modes of the project's `oxe.yaml`. */
export type PolicyChangeFile = 'policy' | 'oxe.yaml'

/**
 * B7.4 · A gated file whose content on disk is not the version the person accepted. Until they accept it, the accepted
 * version applies. `pending`: a request is (or will be) asked. `rejected`: the person kept the accepted rules for exactly
 * this content; it is not asked again until the file changes, and "Review again" (`policy.reviewChange`) asks once more.
 * The hashes bind an answer to the versions compared, so an answer for an older pair is refused.
 */
export interface PolicyChangeStatus {
  layer: PolicyLayer
  file: PolicyChangeFile
  /** The file, as the app located it. */
  path: string
  state: 'pending' | 'rejected'
  baseHash: string
  newHash: string
  /** Lines that widen and lines that tighten; absent until the change was compared. */
  widen?: number
  tighten?: number
}

/** What Settings shows: the files that apply to a project, read only. */
export interface PolicyView extends LoadedPolicy {
  /** Every place a policy file is looked for, in evaluation order, whether or not it exists. */
  locations: Array<{ layer: PolicyLayer; path: string }>
  /** B7.4 · Policy files of these layers whose content on disk is not accepted; the accepted version applies. */
  changes?: PolicyChangeStatus[]
}

/** B7.4 · Which pending change an answer from Settings is for: the project of a workspace (or none), the layer and file, and the compared versions. */
export interface PolicyChangeAnswerInput {
  workspaceId?: string | null
  layer: PolicyLayer
  file: PolicyChangeFile
  baseHash: string
  newHash: string
}

/** Main's notice that a gated file changed (`policy.onChanged`): the tightening that applied at once, or a version kept out. */
export interface PolicyChangedEvent {
  layer: PolicyLayer
  file: PolicyChangeFile
  path: string
  message: import('./messages').MainMessage
}

export interface PolicyApi {
  /** The policy for a workspace's project, or the app-wide layers without one. */
  get(workspaceId?: string): Promise<PolicyView>
  /**
   * B7.4 · Accepts a pending change, the same as Accept in its request: the content compared is recorded as accepted,
   * the file is not rewritten. Refused with a C3 code (`policy.change.baseChanged` when the accepted version or the
   * file changed since, `policy.change.notPending`). The window only; never an MCP tool or a phone command.
   */
  acceptChange?(input: PolicyChangeAnswerInput): Promise<PolicyView>
  /** B7.4 · "Review again": asks once more about a change the person kept out, or one whose request ended unanswered. */
  reviewChange?(input: PolicyChangeAnswerInput): Promise<PolicyView>
  onChanged?(listener: (event: PolicyChangedEvent) => void): () => void
}
