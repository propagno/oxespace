/**
 * MCP servers as dependencies: what a person trusted is pinned, and a change is a reason to ask again.
 *
 * Trusting a server records a pin (a hash of its command, arguments, environment and URL; mcp-pin.ts). The
 * first tool list seen afterwards is remembered as a fingerprint of each tool's description and schema. If
 * the config no longer matches the pin, or a later list adds, removes or rewrites a tool, the server is
 * quarantined: it becomes untrusted, leaves `.mcp.json` and refuses to start until the person trusts it
 * again, which stays a user-only action (the panel; never an MCP tool).
 *
 * This half compares tool lists. It is loaded when a server connects, not at start-up. Pure: the database
 * and the process live in mcp.service.ts.
 */
import type { McpToolDescriptor } from '../../../shared/types/mcp'
import { quarantined, sha, stable, type GuardState, type GuardVerdict, type ToolPrint } from './mcp-pin'

export * from './mcp-pin'

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
