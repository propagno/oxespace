import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'
import type { McpServer, McpToolDescriptor } from '../../../shared/types/mcp'
import { redactSecrets } from '../../../shared/secrets'
import type { ToolContext, ToolEntry } from './tool-registry'
import { toolCallBlocked } from './tool-policy'
import { mcpServerAllowed } from '../services/policy'
import { MCP_TOOL_GROUPS } from '../services/conversation/thread-mcp'

export const DEFAULT_TOOL_SEARCH_LIMIT = 8
export const MAX_TOOL_SEARCH_LIMIT = 20
const MAX_QUERY_CHARS = 300
const MAX_CATEGORY_CHARS = 60
const MAX_DESCRIPTION_CHARS = 220
const MAX_PROP_DESC_CHARS = 120
const MAX_SCHEMA_PROPS = 12
const MAX_ENUM_VALUES = 12

export interface CompactToolSchemaSummary {
  required?: string[]
  properties: Record<string, { type: string; enum?: string[]; description?: string }>
  truncatedProperties?: number
}

export interface ToolSearchMatch {
  name: string
  server: string
  source: 'internal' | 'external'
  group?: string
  description: string
  inputSchema: CompactToolSchemaSummary
  score: number
}

export interface ToolSearchCandidate {
  name: string
  server: string
  source: 'internal' | 'external'
  group?: string
  description: string
  inputSchema: Record<string, unknown>
}

function clipAndRedact(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return ''
  const compact = redactSecrets(value).replace(/\s+/g, ' ').trim()
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1)}…` : compact
}

/**
 * Produces a compact, token-efficient summary of a tool's JSON input schema
 * (required keys, property types/enums, brief redacted descriptions, bounded count).
 */
export function summarizeInputSchema(schema: Record<string, unknown> | undefined): CompactToolSchemaSummary {
  if (!schema || typeof schema !== 'object') return { properties: {} }
  const rawProps = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? (schema.properties as Record<string, unknown>)
    : {}
  const rawRequired = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  const entries = Object.entries(rawProps)
  const limited = entries.slice(0, MAX_SCHEMA_PROPS)
  const properties: CompactToolSchemaSummary['properties'] = {}

  for (const [key, rawDef] of limited) {
    const def = rawDef && typeof rawDef === 'object' && !Array.isArray(rawDef)
      ? (rawDef as Record<string, unknown>)
      : {}
    const typeValue = typeof def.type === 'string'
      ? def.type
      : Array.isArray(def.enum)
        ? 'enum'
        : 'any'
    const enumValues = Array.isArray(def.enum)
      ? def.enum.slice(0, MAX_ENUM_VALUES).map(item => clipAndRedact(String(item), 48)).filter(Boolean)
      : undefined
    const desc = clipAndRedact(def.description, MAX_PROP_DESC_CHARS)
    properties[key] = {
      type: typeValue,
      ...(enumValues && enumValues.length > 0 ? { enum: enumValues } : {}),
      ...(desc ? { description: desc } : {})
    }
  }

  return {
    ...(rawRequired.length > 0 ? { required: rawRequired.slice(0, MAX_SCHEMA_PROPS) } : {}),
    properties,
    ...(entries.length > MAX_SCHEMA_PROPS ? { truncatedProperties: entries.length - MAX_SCHEMA_PROPS } : {})
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

function rawSchemaSearchText(schema: Record<string, unknown> | undefined): string {
  if (!schema || typeof schema !== 'object') return ''
  const rawProps = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? (schema.properties as Record<string, unknown>)
    : null
  if (!rawProps) return ''

  const parts: string[] = []
  let propCount = 0
  for (const key in rawProps) {
    if (!Object.prototype.hasOwnProperty.call(rawProps, key)) continue
    if (propCount >= MAX_SCHEMA_PROPS) break
    propCount += 1
    parts.push(key)
    const rawDef = rawProps[key]
    if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue
    const def = rawDef as Record<string, unknown>
    if (Array.isArray(def.enum)) {
      const enumLimit = Math.min(def.enum.length, MAX_ENUM_VALUES)
      for (let i = 0; i < enumLimit; i++) {
        const val = String(def.enum[i])
        if (val) parts.push(val.length > 48 ? val.slice(0, 48) : val)
      }
    }
    if (typeof def.description === 'string' && def.description.length > 0) {
      parts.push(def.description.length > MAX_PROP_DESC_CHARS ? def.description.slice(0, MAX_PROP_DESC_CHARS) : def.description)
    }
  }
  return parts.length > 0 ? parts.join(' ').toLowerCase() : ''
}

/**
 * Ranks and filters tool candidates by query keywords and optional category/server filter.
 * Expensive secret redaction and schema compaction (`clipAndRedact` / `summarizeInputSchema`)
 * are deferred strictly to the final top-K winners so 250+ tool catalogs search in < 1 ms.
 */
export function rankToolCandidates(
  candidates: readonly ToolSearchCandidate[],
  options: { query?: string; category?: string; limit?: number } = {}
): { totalMatches: number; items: ToolSearchMatch[] } {
  const query = (options.query ?? '').trim().toLowerCase()
  const category = (options.category ?? '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(MAX_TOOL_SEARCH_LIMIT, Math.floor(options.limit ?? DEFAULT_TOOL_SEARCH_LIMIT)))
  const tokens = query ? tokenize(query) : []

  const scored: Array<{ candidate: ToolSearchCandidate; score: number }> = []

  for (const candidate of candidates) {
    const nameLower = candidate.name.toLowerCase()
    const serverLower = candidate.server.toLowerCase()
    const groupLower = (candidate.group ?? '').toLowerCase()

    if (category) {
      const catMatch = groupLower === category ||
        serverLower === category ||
        groupLower.includes(category) ||
        serverLower.includes(category) ||
        nameLower.includes(category)
      if (!catMatch) continue
    }

    let score = 0
    if (!query) {
      score = 1
    } else {
      const descLower = typeof candidate.description === 'string' && candidate.description.length > 0
        ? candidate.description.toLowerCase()
        : ''
      const schemaLower = rawSchemaSearchText(candidate.inputSchema)

      if (nameLower === query) score += 120
      else if (nameLower.startsWith(query)) score += 65
      else if (nameLower.includes(query)) score += 45

      if (serverLower === query || groupLower === query) score += 35

      for (const token of tokens) {
        if (nameLower.includes(token)) score += 25
        if (serverLower.includes(token) || groupLower.includes(token)) score += 15
        if (descLower.includes(token)) score += 10
        if (schemaLower.includes(token)) score += 6
      }

      if (score === 0) continue
    }

    scored.push({ candidate, score })
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    a.candidate.name.localeCompare(b.candidate.name) ||
    a.candidate.server.localeCompare(b.candidate.server)
  )

  const winners = scored.slice(0, limit)
  const items: ToolSearchMatch[] = winners.map(({ candidate, score }) => ({
    name: candidate.name,
    server: candidate.server,
    source: candidate.source,
    ...(candidate.group ? { group: candidate.group } : {}),
    description: clipAndRedact(candidate.description, MAX_DESCRIPTION_CHARS),
    inputSchema: summarizeInputSchema(candidate.inputSchema),
    score
  }))

  return {
    totalMatches: scored.length,
    items
  }
}

const INTERNAL_TOOL_GROUP_MAP = (() => {
  const map = new Map<string, string>()
  for (const [group, tools] of Object.entries(MCP_TOOL_GROUPS as Record<string, readonly string[]>)) {
    for (const tool of tools) map.set(tool, group)
  }
  return map
})()

function groupOfInternalTool(name: string): string {
  return INTERNAL_TOOL_GROUP_MAP.get(name) ?? 'discovery'
}

/**
 * Security filter for external MCP servers: only enabled, trusted, non-quarantined,
 * non-internal servers allowed by workspace policy may appear in search results.
 */
export function filterSearchableExternalServers(
  servers: readonly McpServer[],
  rootPath?: string
): McpServer[] {
  return servers.filter(server => {
    if (!server.enabled || !server.trusted) return false
    if (server.guard?.quarantine) return false
    if (server.name.trim().toLowerCase() === 'oxespace') return false
    if (rootPath) {
      if (!mcpServerAllowed(server.name, rootPath)) return false
      if (server.key && !mcpServerAllowed(server.key, rootPath)) return false
    }
    return true
  })
}

function externalCandidates(servers: readonly McpServer[]): ToolSearchCandidate[] {
  const out: ToolSearchCandidate[] = []
  for (const server of servers) {
    const serverLabel = server.key || server.name
    const tools: readonly McpToolDescriptor[] = Array.isArray(server.tools) ? server.tools : []
    for (const tool of tools) {
      if (!tool?.name) continue
      out.push({
        name: tool.name,
        server: serverLabel,
        source: 'external',
        group: serverLabel,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>
      })
    }
  }
  return out
}

function resolveCallerWorkspace(ctx: ToolContext): { workspaceId: string | null; rootPath?: string } {
  let execution: ReturnType<NonNullable<ToolContext['executions']>['authenticate']> | undefined
  try {
    execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
  } catch { /* Non-execution caller falls back to workspace header / active workspace. */ }

  if (execution) {
    const rootPath = execution.canonicalRoot || execution.cwd
    if (execution.workspaceId.startsWith('thread:')) {
      const norm = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      const matched = ctx.workspaceServ.list().find(ws => norm(ws.rootPath) === norm(rootPath))
      return { workspaceId: matched?.id ?? null, rootPath }
    }
    return { workspaceId: execution.workspaceId, rootPath }
  }

  const explicit = ctx.workspaceId ? ctx.workspaceServ.get(ctx.workspaceId) : null
  const active = explicit ?? ctx.workspaceServ.list().find(ws => ws.isActive === true) ?? null
  return { workspaceId: active?.id ?? null, rootPath: active?.rootPath }
}

/**
 * Builds the `oxespace_tools_search` internal MCP tool for multi-provider deferred tool discovery
 * (Codex, Antigravity, and Claude).
 */
export function createToolsSearchEntry(catalogue: () => ToolEntry[]): ToolEntry {
  return {
    descriptor: {
      name: 'oxespace_tools_search',
      description: 'Search available OXESpace and connected workspace MCP tools by keywords or category. Returns compact tool names, descriptions and parameter summaries so you can discover tools on demand without loading every schema up front.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: MAX_QUERY_CHARS,
            description: 'Keywords or tool name fragment to search for (for example "git diff", "database", "preview", "worktree").'
          },
          category: {
            type: 'string',
            maxLength: MAX_CATEGORY_CHARS,
            description: 'Optional tool group or MCP server name filter (for example app, data, preview, orchestration, code, or an external server name).'
          },
          includeExternal: {
            type: 'boolean',
            description: 'Include tools from enabled, trusted workspace MCP servers. Default true.'
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_TOOL_SEARCH_LIMIT,
            description: `Maximum number of matching tools to return (1-${MAX_TOOL_SEARCH_LIMIT}, default ${DEFAULT_TOOL_SEARCH_LIMIT}).`
          }
        },
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    requiresWorkspace: false,
    handler: async (args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> => {
      const reply = (body: Record<string, unknown>, isError = false): InternalMcpToolCallResult => ({
        content: [{ type: 'text', text: JSON.stringify({ schemaVersion: 1, ...body }) }],
        ...(isError ? { isError: true } : {})
      })

      if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: 'Arguments must be an object.', retryable: false } }, true)
      }
      const input = (args ?? {}) as Record<string, unknown>
      const allowedKeys = new Set(['query', 'category', 'includeExternal', 'limit'])
      if (Object.keys(input).some(key => !allowedKeys.has(key))) {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: 'Accepted fields: query, category, includeExternal, limit.', retryable: false } }, true)
      }

      const query = input.query === undefined ? '' : typeof input.query === 'string' ? input.query.trim().slice(0, MAX_QUERY_CHARS) : null
      if (query === null) {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: '"query" must be a string.', retryable: false } }, true)
      }
      const category = input.category === undefined ? '' : typeof input.category === 'string' ? input.category.trim().slice(0, MAX_CATEGORY_CHARS) : null
      if (category === null) {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: '"category" must be a string.', retryable: false } }, true)
      }
      if (input.includeExternal !== undefined && typeof input.includeExternal !== 'boolean') {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: '"includeExternal" must be a boolean.', retryable: false } }, true)
      }
      if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_TOOL_SEARCH_LIMIT)) {
        return reply({ status: 'error', error: { code: 'INVALID_ARGUMENTS', message: `"limit" must be an integer between 1 and ${MAX_TOOL_SEARCH_LIMIT}.`, retryable: false } }, true)
      }

      const includeExternal = input.includeExternal !== false
      const limit = (input.limit as number | undefined) ?? DEFAULT_TOOL_SEARCH_LIMIT
      const candidates: ToolSearchCandidate[] = []

      // 1. Internal OXESpace tools (respecting project group modes and org policy).
      for (const entry of catalogue()) {
        const name = entry.descriptor.name
        if (name === 'oxespace_tools_search') continue
        if (toolCallBlocked(name, ctx)) continue
        candidates.push({
          name,
          server: 'oxespace',
          source: 'internal',
          group: groupOfInternalTool(name),
          description: entry.descriptor.description,
          inputSchema: entry.descriptor.inputSchema as unknown as Record<string, unknown>
        })
      }

      // 2. Enabled, trusted, non-quarantined external workspace MCP servers.
      if (includeExternal && ctx.app?.mcpServers) {
        const { workspaceId, rootPath } = resolveCallerWorkspace(ctx)
        const allServers = ctx.app.mcpServers.list(workspaceId)
        const safeServers = filterSearchableExternalServers(allServers, rootPath)
        candidates.push(...externalCandidates(safeServers))
      }

      const { totalMatches, items } = rankToolCandidates(candidates, { query, category, limit })
      return reply({
        status: 'ok',
        data: {
          query,
          ...(category ? { category } : {}),
          totalMatches,
          returned: items.length,
          truncated: totalMatches > items.length,
          tools: items.map(({ score: _score, ...rest }) => rest)
        }
      })
    }
  }
}
