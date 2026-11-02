/**
 * What makes a Codex side chat (B1.2) safe to open: every MCP tool call it makes asks for approval, which the side
 * chat then declines. Verified live against codex-cli 0.166.0 (tests/live/thread-side-chat-codex.live.test.ts):
 *  - `thread/fork` honours `config` overrides `mcp_servers.<server>.default_tools_approval_mode = "prompt"`;
 *  - a per-tool `tools.<tool>.approval_mode` in the person's config wins over that default, so each one is overridden too;
 *  - without the override a tool that declares `readOnlyHint` runs with no request at all.
 *  - plugin servers and the app connectors (`codex_apps`) are not reached by that override, so the copy turns them off:
 *    `plugins = { <id> = { enabled = false } }` for every configured plugin, and `features.apps = false`.
 * An older version, a name the dotted override cannot address, or a server the copy still reports that the override did
 * not reach means the copy cannot be made safe, and the side chat is reported as unavailable.
 *
 * On Windows the Codex sandbox is weaker than on the other platforms, so the copy also forces `approval_policy =
 * "untrusted"`: every shell command asks, and the side chat declines it. The fork's answer must report that policy
 * back, or the side chat is reported as unavailable there.
 */

import { THREAD_READ_ONLY_MCP_TOOLS } from './thread-mcp'

/** The OXESpace bridge: the one server whose read-only lookups a side chat may run without asking. */
export const OXESPACE_BRIDGE_SERVER = 'oxespace-delegation'

/** The first Codex version on which the approval override was verified. */
export const CODEX_SIDE_FORK_MIN_VERSION: readonly [number, number, number] = [0, 166, 0]

const NAME = /^[A-Za-z0-9_-]{1,120}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** The Codex version in the app-server's handshake (`serverInfo.version` or the `name/x.y.z` user agent). */
export function codexVersion(handshake: unknown): [number, number, number] | null {
  const value = record(handshake), info = record(value.serverInfo)
  const text = [info.version, value.version, value.userAgent].find(item => typeof item === 'string' && /\d+\.\d+\.\d+/.test(item)) as string | undefined
  const match = text?.match(/(?:^|\/|v)(\d+)\.(\d+)\.(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function codexSupportsSideFork(handshake: unknown): boolean {
  const version = codexVersion(handshake)
  if (!version) return false
  for (let index = 0; index < 3; index++) if (version[index] !== CODEX_SIDE_FORK_MIN_VERSION[index]) return version[index] > CODEX_SIDE_FORK_MIN_VERSION[index]
  return true
}

/**
 * The `thread/fork` config that makes every tool of every configured MCP server ask first and turns plugins and app
 * connectors off, from the effective configuration `config/read` returns. Null when that configuration is missing or
 * a server or tool name cannot be addressed safely.
 *
 * The one exemption: on the OXESpace bridge, each of `lookups` that is in THREAD_READ_ONLY_MCP_TOOLS is approved by
 * name. The bridge itself stays at "prompt", so any other OXESpace tool still asks and is declined.
 *
 * `approvalPolicy` is the policy the fork must run with: "untrusted" on Windows (also set in `config`), none elsewhere,
 * where the adapter's own policy stands.
 */
export function sideForkApprovalOverrides(configRead: unknown, lookups: readonly string[] = [], platform: NodeJS.Platform = process.platform): { config: Record<string, unknown>; servers: Set<string>; approvalPolicy: 'untrusted' | null } | null {
  const effective = record(record(configRead).config)
  // No answer means nothing is known about the servers; an answer without any is an empty list.
  if (!Object.keys(effective).length || (effective.mcp_servers != null && typeof effective.mcp_servers !== 'object')) return null
  const servers = record(effective.mcp_servers)
  const plugins = Object.keys(record(effective.plugins))
  const approvalPolicy = sideForkApprovalPolicy(platform)
  const config: Record<string, unknown> = { 'features.apps': false, ...(approvalPolicy ? { approval_policy: approvalPolicy } : {}),
    ...(plugins.length ? { plugins: Object.fromEntries(plugins.map(id => [id, { enabled: false }])) } : {}) }
  for (const [server, value] of Object.entries(servers)) {
    if (!NAME.test(server)) return null
    config[`mcp_servers.${server}.default_tools_approval_mode`] = 'prompt'
    for (const tool of Object.keys(record(record(value).tools))) {
      if (!NAME.test(tool)) return null
      config[`mcp_servers.${server}.tools.${tool}.approval_mode`] = 'prompt'
    }
  }
  if (OXESPACE_BRIDGE_SERVER in servers) {
    for (const tool of lookups) if (THREAD_READ_ONLY_MCP_TOOLS.includes(tool) && NAME.test(tool)) config[`mcp_servers.${OXESPACE_BRIDGE_SERVER}.tools.${tool}.approval_mode`] = 'approve'
  }
  return { config, servers: new Set(Object.keys(servers)), approvalPolicy }
}

/** The approval policy a side chat copy must run with on this platform: every shell command asks on Windows. */
export function sideForkApprovalPolicy(platform: NodeJS.Platform): 'untrusted' | null {
  return platform === 'win32' ? 'untrusted' : null
}

/** Whether the fork's answer reports the policy the copy was asked for; a version that ignores it cannot be made safe. */
export function sideForkPolicyHonoured(forkResponse: unknown, required: 'untrusted' | null): boolean {
  return required === null || record(forkResponse).approvalPolicy === required
}

/** Servers the fork reports that the override did not cover; any one of them refuses the side chat. */
export function uncoveredMcpServers(statuses: unknown[], covered: ReadonlySet<string>): string[] {
  return statuses.map(record).filter(status => typeof status.pluginId === 'string' || typeof status.name !== 'string' || !covered.has(status.name))
    .map(status => String(status.name ?? '?'))
}
