/**
 * Environment scrubber for processes the app starts on an agent's behalf (roadmap S7).
 *
 * A child inherits a variable only when its name does not look like a secret, or when something names it as
 * needed: the provider being launched (an explicit allowlist below), or the person through a policy rule
 * `{ "effect": "allow", "action": "integration.use", "resource": "env:<NAME>" }`. A `deny` on `env:<NAME>`
 * withholds a variable even when its name looks harmless or the provider would need it. Only names are ever
 * reported; values never leave this function.
 */
import type { LoadedPolicy } from './policy'
import { evaluatePolicy } from './policy'

export type EnvScope = 'claude' | 'codex' | 'hook' | 'mcp'

/** Names that look like credentials. Matched against whole name segments so `KEYBOARD` and `MONKEY_PATCH` pass. */
const SECRET_WORDS = ['TOKEN', 'SECRET', 'KEY', 'PASSWORD', 'PASSWD', 'PASSPHRASE', 'CREDENTIAL', 'CREDENTIALS', 'APIKEY', 'AUTH', 'COOKIE']
/** Cloud and provider variables that carry credentials whatever the name looks like. */
const KNOWN_SECRET = /^(AWS_(ACCESS_KEY_ID|SESSION_TOKEN|SHARED_CREDENTIALS_FILE|WEB_IDENTITY_TOKEN_FILE|CONTAINER_AUTHORIZATION_TOKEN)|AZURE_(CLIENT_ID|TENANT_ID|SUBSCRIPTION_ID)|ARM_[A-Z_]+|GOOGLE_APPLICATION_CREDENTIALS|GH_[A-Z_]+|GITHUB_[A-Z_]+|GITLAB_[A-Z_]+|NPM_CONFIG_[A-Z_]*(AUTH|TOKEN)[A-Z_]*|NODE_AUTH_TOKEN|DOCKER_AUTH_CONFIG|DATABASE_URL|[A-Z_]+_DATABASE_URL|[A-Z_]+_DSN|ANTHROPIC_[A-Z_]+|OPENAI_[A-Z_]+|CODEX_[A-Z_]+|CLAUDE_CODE_[A-Z_]+|OXESPACE_[A-Z_]+|AI_MEMORY_[A-Z_]+)$/

/**
 * What each provider's CLI needs to authenticate or choose its account. These are kept for that provider only:
 * a Codex launch never receives Anthropic variables and the reverse. Cloud routing variables (Bedrock, Vertex)
 * are kept for Claude because the CLI reads the credentials chain from them.
 */
export const PROVIDER_ENV_ALLOWLIST: Record<'claude' | 'codex', readonly RegExp[]> = {
  claude: [/^ANTHROPIC_[A-Z_]+$/, /^CLAUDE_[A-Z_]+$/, /^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|REGION|DEFAULT_REGION|PROFILE|BEARER_TOKEN_BEDROCK)$/,
    /^GOOGLE_APPLICATION_CREDENTIALS$/, /^CLOUD_ML_REGION$/, /^VERTEX_[A-Z_]+$/, /^AZURE_(API_KEY|FOUNDRY_[A-Z_]+)$/],
  codex: [/^OPENAI_[A-Z_]+$/, /^CODEX_[A-Z_]+$/, /^AZURE_OPENAI_[A-Z_]+$/]
}

export function looksSecret(name: string): boolean {
  const upper = name.toUpperCase()
  // A socket path the person's own ssh agent listens on; it grants nothing without the agent.
  if (upper === 'SSH_AUTH_SOCK') return false
  if (KNOWN_SECRET.test(upper)) return true
  const segments = upper.split(/[^A-Z0-9]+/).filter(Boolean)
  // Also catch run-together names such as `APIKEY`, `ACCESSTOKEN`, `GITHUBTOKEN`.
  return segments.some(segment => SECRET_WORDS.includes(segment) || /(TOKEN|SECRET|PASSWORD|APIKEY|CREDENTIAL)$/.test(segment))
}

export interface ScrubResult { env: NodeJS.ProcessEnv; withheld: string[] }

export interface ScrubOptions {
  scope: EnvScope
  /** The loaded policy for the project, when there is one. `env:<NAME>` rules apply on top of the defaults. */
  policy?: LoadedPolicy | null
}

function providerNeeds(scope: EnvScope, name: string): boolean {
  if (scope !== 'claude' && scope !== 'codex') return false
  return PROVIDER_ENV_ALLOWLIST[scope].some(pattern => pattern.test(name.toUpperCase()))
}

/** Decides one variable: whether the child inherits it. */
export function inheritsVariable(name: string, scope: EnvScope, policy?: LoadedPolicy | null): boolean {
  const rule = policy ? evaluatePolicy(policy, 'integration.use', `env:${name}`) : null
  if (rule?.rule) return rule.allowed
  if (providerNeeds(scope, name)) return true
  return !looksSecret(name)
}

/** The environment a child receives, and the names that were left out (names only, sorted). */
export function scrubEnvironment(source: NodeJS.ProcessEnv, options: ScrubOptions): ScrubResult {
  const env: NodeJS.ProcessEnv = {}
  const withheld: string[] = []
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (inheritsVariable(name, options.scope, options.policy)) env[name] = value
    else withheld.push(name)
  }
  return { env, withheld: withheld.sort() }
}

/**
 * Names withheld by the most recent launches, per scope, for Settings and diagnostics. Names only; kept in memory,
 * bounded, and never written to disk.
 */
const recent = new Map<EnvScope, string[]>()
export function noteWithheld(scope: EnvScope, names: string[]): void { recent.set(scope, names.slice(0, 100)) }
export function withheldSummary(): Array<{ scope: EnvScope; names: string[] }> {
  return [...recent.entries()].map(([scope, names]) => ({ scope, names }))
}
export function clearWithheldForTests(): void { recent.clear() }
