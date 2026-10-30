/**
 * MCP servers as dependencies: what a person trusted is pinned, and a change is a reason to ask again.
 *
 * Trusting a server records a pin (a hash of its command, arguments, environment and URL). The first tool
 * list seen afterwards is remembered as a fingerprint of each tool's description and schema. If the config
 * no longer matches the pin, or a later list adds, removes or rewrites a tool, the server is quarantined:
 * it becomes untrusted, leaves `.mcp.json` and refuses to start until the person trusts it again, which
 * stays a user-only action (the panel; never an MCP tool).
 *
 * Pure: the database and the process live in mcp.service.ts.
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { McpServerConfig, McpServerGuard, McpToolDescriptor } from '../../../shared/types/mcp'

export interface ToolPrint { name: string; hash: string }

export interface Quarantine {
  at: number
  reasons: string[]
  added: string[]
  removed: string[]
  changed: string[]
  /** The tools seen when it was quarantined: trusting again accepts these. */
  observed: ToolPrint[] | null
}

export interface GuardState {
  pin: { hash: string; at: number }
  /** Null until the first tool list after trust. */
  tools: ToolPrint[] | null
  quarantine: Quarantine | null
}

const sha = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length)

/** JSON with sorted keys, so equal values hash equally. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** What decides what runs: the command line and its environment, or the URL and its headers. */
export function configHash(config: McpServerConfig): string {
  return sha(stable(config.transport === 'stdio'
    ? { transport: 'stdio', command: config.command?.trim(), args: config.args ?? [], env: config.env ?? {} }
    : { transport: config.transport, url: config.url?.trim(), headers: config.headers ?? {} }), 32)
}

export function printTools(tools: readonly McpToolDescriptor[]): ToolPrint[] {
  return tools
    .map(tool => ({ name: String(tool.name), hash: sha(stable({ description: tool.description ?? '', inputSchema: tool.inputSchema ?? null }), 16) }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

export function diffTools(before: readonly ToolPrint[], after: readonly ToolPrint[]): { added: string[]; removed: string[]; changed: string[] } {
  const was = new Map(before.map(tool => [tool.name, tool.hash]))
  const now = new Map(after.map(tool => [tool.name, tool.hash]))
  return {
    added: [...now.keys()].filter(name => !was.has(name)),
    removed: [...was.keys()].filter(name => !now.has(name)),
    changed: [...now].filter(([name, hash]) => was.has(name) && was.get(name) !== hash).map(([name]) => name)
  }
}

export function parseGuard(json: string | null | undefined): GuardState | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as GuardState
    return value && typeof value === 'object' && typeof value.pin?.hash === 'string' ? value : null
  } catch { return null }
}

/** The state when a person trusts a server: the pin of its config. `tools` keeps a list the person already reviewed. */
export function trustState(config: McpServerConfig, now: number, tools: ToolPrint[] | null = null): GuardState {
  return { pin: { hash: configHash(config), at: now }, tools, quarantine: null }
}

export type GuardVerdict =
  | { ok: true; state: GuardState }
  | { ok: false; state: GuardState; quarantine: Quarantine }

const quarantined = (state: GuardState, now: number, reasons: string[], change: Partial<Pick<Quarantine, 'added' | 'removed' | 'changed' | 'observed'>> = {}): GuardVerdict => {
  const quarantine: Quarantine = { at: now, reasons, added: [], removed: [], changed: [], observed: null, ...change }
  return { ok: false, state: { ...state, quarantine }, quarantine }
}

/** A server trusted before pins existed gets its pin from the config it has now; one that no longer matches its pin is quarantined. */
export function checkConfig(state: GuardState | null, config: McpServerConfig, now: number): GuardVerdict {
  if (!state) return { ok: true, state: trustState(config, now) }
  return state.pin.hash === configHash(config) ? { ok: true, state } : quarantined(state, now, ['Its command, arguments, environment or URL changed after you trusted it.'])
}

/** The first list after trust is remembered; a later one that differs quarantines the server. */
export function checkTools(state: GuardState, tools: readonly McpToolDescriptor[], now: number): GuardVerdict {
  const seen = printTools(tools)
  if (!state.tools) return { ok: true, state: { ...state, tools: seen } }
  const change = diffTools(state.tools, seen)
  if (!change.added.length && !change.removed.length && !change.changed.length) return { ok: true, state }
  const reasons: string[] = []
  if (change.changed.length) reasons.push(`The description or inputs of ${list(change.changed)} changed after you trusted it.`)
  if (change.added.length) reasons.push(`It added ${list(change.added)}.`)
  if (change.removed.length) reasons.push(`It removed ${list(change.removed)}.`)
  return quarantined(state, now, reasons, { ...change, observed: seen })
}

function list(names: string[]): string {
  const shown = names.slice(0, 4).map(name => `"${name.slice(0, 60)}"`).join(', ')
  return names.length > 4 ? `${shown} and ${names.length - 4} more` : shown
}

const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx', 'pipx'])
const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/

/** The package a runner starts (`npx -y pkg@1.2.3`, `uvx pkg==1.2.3`), with its version when it is an exact one. */
export function launcherPackage(config: McpServerConfig): { package: string; version: string | null } | null {
  if (config.transport !== 'stdio') return null
  const command = basename((config.command ?? '').trim()).toLowerCase().replace(/\.(?:cmd|exe|bat|ps1)$/, '')
  const args = config.args ?? []
  let rest: string[]
  if (RUNNERS.has(command)) rest = args
  else if (['npm', 'pnpm', 'yarn', 'bun'].includes(command) && (args[0] === 'dlx' || args[0] === 'exec' || args[0] === 'x')) rest = args.slice(1)
  else return null
  // Flags that take a value ("--from pkg", "-p pkg") name the package themselves.
  const from = rest.findIndex(arg => arg === '--from' || arg === '-p' || arg === '--package')
  const spec = from >= 0 ? rest[from + 1] : rest.find(arg => !arg.startsWith('-'))
  if (!spec) return null
  const match = /^(@[^/@]+\/[^@=]+|[^@=/][^@=]*?)(?:(?:@|==)(.+))?$/.exec(spec)
  if (!match) return null
  const version = match[2] ?? null
  return { package: match[1], version: version && EXACT.test(version) ? version : null }
}

/** What the panel shows about a server: no hashes, only what a person can act on. */
export function summarizeGuard(state: GuardState | null, config: McpServerConfig): McpServerGuard {
  const launcher = launcherPackage(config)
  return {
    package: launcher?.package ?? null,
    version: launcher?.version ?? null,
    floating: launcher !== null && launcher.version === null,
    toolsRemembered: state?.tools != null,
    quarantine: state?.quarantine ? { at: state.quarantine.at, reasons: state.quarantine.reasons, added: state.quarantine.added, removed: state.quarantine.removed, changed: state.quarantine.changed } : null
  }
}
