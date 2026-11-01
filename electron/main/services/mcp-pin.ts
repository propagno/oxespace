/**
 * The small, synchronous half of the MCP guard (see mcp-guard.ts): the pin of a trusted server's config,
 * the state kept for it and what the panel shows. The comparison of tool lists lives in mcp-guard.ts and is
 * loaded when a server is connected, so the main bundle does not carry it from the start.
 */
import { createHash } from 'node:crypto'
import type { McpServerConfig, McpServerGuard, McpTrustedSnapshot } from '../../../shared/types/mcp'
import { storedSnapshot, trustedSnapshot } from '../../../shared/mcp-trusted'
import { isMainMessage, mainMessage, type MainMessage } from '../../../shared/messages'

export interface ToolPrint { name: string; hash: string }

export interface Quarantine {
  at: number
  /** English sentences; kept for compatibility. `codes` carry the same for the window to translate. */
  reasons: string[]
  /** Absent on quarantines recorded before message codes existed. */
  codes?: MainMessage[]
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
  /**
   * The config as trusted, without secrets (shared/mcp-trusted.ts), what a moved config is shown against. Absent on
   * states written before it existed; filled in when the config still matches the pin.
   */
  trusted?: McpTrustedSnapshot
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
  return { pin: { hash: configHash(config), at: now }, tools, quarantine: null, trusted: trustedSnapshot(config) }
}

export type GuardVerdict =
  | { ok: true; state: GuardState }
  | { ok: false; state: GuardState; quarantine: Quarantine }

export const quarantined = (state: GuardState, now: number, reasons: string[], codes: MainMessage[], change: Partial<Pick<Quarantine, 'added' | 'removed' | 'changed' | 'observed'>> = {}): GuardVerdict => {
  const quarantine: Quarantine = { at: now, reasons, codes, added: [], removed: [], changed: [], observed: null, ...change }
  return { ok: false, state: { ...state, quarantine }, quarantine }
}

/** A server trusted before pins existed gets its pin from the config it has now; one that no longer matches its pin is quarantined. */
export function checkConfig(state: GuardState | null, config: McpServerConfig, now: number): GuardVerdict {
  if (!state) return { ok: true, state: trustState(config, now) }
  // A config that still matches its pin is the trusted one, so an older state can learn what that was.
  if (state.pin.hash === configHash(config)) return { ok: true, state: state.trusted ? state : { ...state, trusted: trustedSnapshot(config) } }
  return quarantined(state, now, ['Its command, arguments, environment or URL changed after you trusted it.'], [mainMessage('mcp.quarantine.configChanged', {})])
}

/** What the panel shows about a server: no hashes, only what a person can act on. */
export function summarizeGuard(state: GuardState | null): McpServerGuard {
  return {
    toolsRemembered: state?.tools != null,
    quarantine: state?.quarantine ? { at: state.quarantine.at, reasons: state.quarantine.reasons, ...storedCodes(state.quarantine.codes), added: state.quarantine.added, removed: state.quarantine.removed, changed: state.quarantine.changed, ...trustedOf(state) } : null
  }
}

function trustedOf(state: GuardState): { trusted?: McpTrustedSnapshot } {
  const trusted = storedSnapshot(state.trusted)
  return trusted ? { trusted } : {}
}

const LIST_CODES = new Set(['mcp.quarantine.changed', 'mcp.quarantine.added', 'mcp.quarantine.removed'])

/** A quarantine code as written by this file: one of the quarantine codes, with its list of tool names. */
function isQuarantineCode(value: unknown): value is MainMessage {
  if (!isMainMessage(value)) return false
  if (value.code === 'mcp.quarantine.configChanged') return true
  const tools = (value.params as { tools?: unknown }).tools
  return LIST_CODES.has(value.code) && Array.isArray(tools) && tools.length > 0 && tools.every(name => typeof name === 'string')
}

/**
 * Codes read back from the database reach the window only when every one is a valid quarantine code; otherwise none
 * do and the window shows `reasons`, so a damaged record never hides a reason.
 */
function storedCodes(codes: unknown): { codes?: MainMessage[] } {
  return Array.isArray(codes) && codes.length > 0 && codes.every(isQuarantineCode) ? { codes } : {}
}
