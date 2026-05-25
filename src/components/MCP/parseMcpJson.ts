import type { McpStdioConfig } from '../../../shared/types/mcp'

export interface ParsedMcpEntry {
  /** Empty when the JSON didn't carry a name (raw `{ command, args }` shape). */
  name: string
  config: McpStdioConfig
}

/**
 * Parses a chunk of JSON the user pasted into the "JSON" tab of the MCP create
 * form. Accepts the three shapes that show up in the wild:
 *
 *   A) Project-style `.mcp.json` — `{ "mcpServers": { "github": { command, args, env } } }`
 *   B) Bare named map — `{ "github": { command, args, env } }`
 *   C) Anonymous single server — `{ command, args, env }`
 *
 * Returns one entry per server, ready to feed into `CreateMcpServerInput`.
 * Throws a `SyntaxError`/`Error` with a human-readable reason on invalid
 * input so the form can surface it inline.
 */
export function parseMcpJson(input: string): ParsedMcpEntry[] {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Paste a JSON object — the field is empty.')

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isObject(parsed)) {
    throw new Error('Expected a JSON object at the top level.')
  }

  // Shape A: explicit { mcpServers: { ... } } wrapper (Claude Code / Copilot CLI
  // canonical format).
  if ('mcpServers' in parsed && isObject((parsed as Record<string, unknown>).mcpServers)) {
    const map = (parsed as Record<string, unknown>).mcpServers as Record<string, unknown>
    return entriesFromNamedMap(map)
  }

  // Shape C check has to come BEFORE Shape B, because a single-server object
  // with `command` would otherwise be misread as a name→config map where the
  // key happens to be "command". We look for the shape signature
  // (string "command" plus optional args/env) at the top level.
  if (looksLikeStdioEntry(parsed)) {
    return [{ name: '', config: normalizeStdioConfig(parsed) }]
  }

  // Shape B: { name1: {...}, name2: {...} } where every value is an stdio entry.
  const entries = Object.entries(parsed)
  if (entries.length > 0 && entries.every(([, value]) => looksLikeStdioEntry(value))) {
    return entriesFromNamedMap(parsed as Record<string, unknown>)
  }

  throw new Error(
    'JSON does not match any MCP server shape. Expected { command, args, env }, ' +
    '{ name: { command, args, env } }, or { mcpServers: { ... } }.'
  )
}

function entriesFromNamedMap(map: Record<string, unknown>): ParsedMcpEntry[] {
  const out: ParsedMcpEntry[] = []
  for (const [rawName, value] of Object.entries(map)) {
    const name = rawName.trim()
    if (!name) throw new Error('A server entry has an empty name.')
    if (!looksLikeStdioEntry(value)) {
      throw new Error(`Server "${name}" is missing a string "command" field.`)
    }
    out.push({ name, config: normalizeStdioConfig(value) })
  }
  if (out.length === 0) {
    throw new Error('No servers found in the JSON.')
  }
  return out
}

function looksLikeStdioEntry(value: unknown): boolean {
  return isObject(value) && typeof (value as { command?: unknown }).command === 'string'
}

function normalizeStdioConfig(value: unknown): McpStdioConfig {
  const v = value as { command?: unknown; args?: unknown; env?: unknown; type?: unknown }
  // Future-proof: if the user pastes a Cloud-Code/HTTP config we should fail
  // loud rather than silently coerce it to stdio.
  if (typeof v.type === 'string' && v.type.toLowerCase() !== 'stdio') {
    throw new Error(`Only "stdio" transport is supported here (got "${String(v.type)}").`)
  }
  if (typeof v.command !== 'string' || !v.command.trim()) {
    throw new Error('"command" must be a non-empty string.')
  }
  const args = normalizeArgs(v.args)
  const env = normalizeEnv(v.env)
  return { transport: 'stdio', command: v.command.trim(), args, env }
}

function normalizeArgs(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new Error('"args" must be an array of strings.')
  }
  return value.map((entry, idx) => {
    if (typeof entry !== 'string') {
      throw new Error(`"args[${idx}]" must be a string.`)
    }
    return entry
  })
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!isObject(value)) {
    throw new Error('"env" must be a plain object of string→string.')
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') {
      throw new Error(`"env.${key}" must be a string.`)
    }
    out[key] = raw
  }
  return out
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
