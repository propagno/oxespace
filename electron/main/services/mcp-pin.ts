/**
 * The small, synchronous half of the MCP guard (see mcp-guard.ts): the pin of a trusted server's config,
 * the state kept for it and what the panel shows. The comparison of tool lists lives in mcp-guard.ts and is
 * loaded when a server is connected, so the main bundle does not carry it from the start.
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { McpServerConfig, McpServerGuard } from '../../../shared/types/mcp'

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

export const sha = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length)

/** JSON with sorted keys, so equal values hash equally. */
export function stable(value: unknown): string {
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

export const quarantined = (state: GuardState, now: number, reasons: string[], change: Partial<Pick<Quarantine, 'added' | 'removed' | 'changed' | 'observed'>> = {}): GuardVerdict => {
  const quarantine: Quarantine = { at: now, reasons, added: [], removed: [], changed: [], observed: null, ...change }
  return { ok: false, state: { ...state, quarantine }, quarantine }
}

/** A server trusted before pins existed gets its pin from the config it has now; one that no longer matches its pin is quarantined. */
export function checkConfig(state: GuardState | null, config: McpServerConfig, now: number): GuardVerdict {
  if (!state) return { ok: true, state: trustState(config, now) }
  return state.pin.hash === configHash(config) ? { ok: true, state } : quarantined(state, now, ['Its command, arguments, environment or URL changed after you trusted it.'])
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
