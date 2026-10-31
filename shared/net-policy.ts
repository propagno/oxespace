/**
 * Network rules and a command classifier (roadmap S4). Nothing here enforces anything yet: enforcement needs the
 * operating system sandbox (S3). These are the two pure pieces a future prompt and a future default-deny need.
 *
 * Rule: `{ "effect": "deny", "action": "integration.use", "resource": "net:*.example.com" }`. The resource is
 * `net:<domain>` with `*` wildcards, compared without case. `net:github.com` does not cover `api.github.com`;
 * write `net:*.github.com` for subdomains.
 */
import { evaluatePolicy, type LoadedPolicy, type PolicyDecision } from './policy'

/** `allow` is today's behavior. `deny` means a host is reachable only when an explicit `allow` rule names it. */
export type NetDefault = 'allow' | 'deny'
export const NET_DEFAULT: NetDefault = 'allow'

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/** Whether policy lets a command reach a host. With the default `allow`, only a matching `deny` rule blocks. */
export function decideNet(policy: LoadedPolicy, host: string, defaultMode: NetDefault = NET_DEFAULT): PolicyDecision {
  const decision = evaluatePolicy(policy, 'integration.use', `net:${normalizeHost(host)}`)
  if (decision.rule) return decision
  return { allowed: defaultMode === 'allow' }
}

export type NetUseKind = 'http-client' | 'git-remote' | 'package-install' | 'remote-shell'
export interface NetUse {
  /** `none` when no network use was recognized; `likely` for commands that always reach out. */
  confidence: 'none' | 'likely'
  kinds: NetUseKind[]
  /** Hosts written literally in the command, lower case, without port or credentials. */
  hosts: string[]
}

const URL_RE = /\b(?:https?|ftp|ssh|git):\/\/(?:[^\s/@'"]*@)?(\[[0-9a-f:]+\]|[a-z0-9._-]+)(?::\d+)?/gi
const SCP_RE = /\b(?:[\w.-]+@)([a-z0-9.-]+\.[a-z]{2,}):[\w./~-]/gi
const OFFLINE_FLAGS = /(?:^|\s)(?:--offline|--no-index|--no-network)(?:\s|$)/

/**
 * Splits on shell control operators so `cd x && curl y` is read as two commands. It is a classifier for a prompt,
 * not a parser: a command it cannot read is reported as `none`, never as safe.
 */
function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map(part => part.trim()).filter(Boolean)
}

function words(segment: string): string[] {
  const out = segment.replace(/^(?:\w+=\S*\s+)+/, '').match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return out.map(word => word.replace(/^["']|["']$/g, ''))
}

export function classifyNetworkUse(command: string): NetUse {
  const kinds = new Set<NetUseKind>()
  for (const segment of segments(command)) {
    const parts = words(segment)
    let program = (parts[0] ?? '').replace(/\\/g, '/').split('/').pop()!.toLowerCase().replace(/\.(exe|cmd)$/, '')
    let rest = parts.slice(1)
    if ((program === 'sudo' || program === 'env' || program === 'time') && rest.length) { program = rest[0].toLowerCase(); rest = rest.slice(1) }
    const sub = rest.find(word => !word.startsWith('-'))?.toLowerCase()
    const offline = OFFLINE_FLAGS.test(` ${segment} `)
    if (['curl', 'wget', 'http', 'https', 'xh', 'aria2c', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'].includes(program)) kinds.add('http-client')
    else if (['ssh', 'scp', 'sftp', 'rsync', 'nc', 'ncat', 'telnet'].includes(program) && /[@:]|\.\w{2,}/.test(rest.join(' '))) kinds.add('remote-shell')
    else if (program === 'git' && ['clone', 'fetch', 'pull', 'push', 'ls-remote', 'submodule'].includes(sub ?? '') && !offline) kinds.add('git-remote')
    else if (program === 'gh' && sub !== undefined && !['auth', 'config', 'alias'].includes(sub)) kinds.add('http-client')
    else if (['npm', 'pnpm', 'yarn', 'bun'].includes(program) && ['install', 'i', 'add', 'update', 'upgrade', 'ci', 'publish', 'dlx', 'create', 'exec'].includes(sub ?? '') && !offline) kinds.add('package-install')
    else if (program === 'npx' && !offline) kinds.add('package-install')
    else if (['pip', 'pip3', 'pipx', 'uv', 'poetry', 'cargo', 'go', 'gem', 'bundle', 'composer', 'dotnet', 'nuget', 'apt', 'apt-get', 'brew', 'choco', 'winget'].includes(program)
      && ['install', 'add', 'get', 'update', 'upgrade', 'fetch', 'restore', 'sync', 'download'].includes(sub ?? '') && !offline) kinds.add('package-install')
    else if (/^python[\d.]*$/.test(program) && rest[0] === '-m' && rest[1] === 'pip' && rest[2] === 'install') kinds.add('package-install')
  }
  const hosts = new Set<string>()
  if (kinds.size) {
    for (const match of command.matchAll(URL_RE)) hosts.add(normalizeHost(match[1]))
    for (const match of command.matchAll(SCP_RE)) hosts.add(normalizeHost(match[1]))
  }
  return { confidence: kinds.size ? 'likely' : 'none', kinds: [...kinds], hosts: [...hosts] }
}
