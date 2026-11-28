import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'

/** Maximum cached entries retained in the LRU cache. */
export const MAX_CACHE_ENTRIES = 256

/** Tiered TTLs by tool volatility. */
export const CACHE_TTL_MS = {
  /** Volatile git status/diff/log and background job list queries. */
  fast: 30_000,
  /** File listing and workspace metadata queries. */
  medium: 120_000,
  /** Database schema introspection queries. */
  slow: 300_000
} as const

/** Payloads at or above this size return a compact deduplicated reference on repeat hits within the same session. */
export const DEFAULT_DEDUP_MIN_CHARS = 512

export type CacheTier = keyof typeof CACHE_TTL_MS
export type CacheDomain = 'git' | 'workspace' | 'jobs' | 'db' | 'search' | 'other'

export interface ToolCachePolicy {
  tier: CacheTier
  ttlMs: number
  domain: CacheDomain
  /** Tools that require verified live execution credentials before serving any cached response. */
  requiresAuthCheck?: boolean
}

export interface MutationInvalidation {
  domains: CacheDomain[]
  connection?: string
}

export interface ToolCacheContext {
  sessionKey: string
  workspaceScope: string
  cwd?: string
  connection?: string
}

export interface CachedToolEntry {
  key: string
  toolName: string
  sessionKey: string
  workspaceScope: string
  cwd?: string
  connection?: string
  domain: CacheDomain
  tier: CacheTier
  result: InternalMcpToolCallResult
  charCount: number
  cachedAtMs: number
  cachedAtIso: string
  expiresAtMs: number
}

export type ToolCacheLookupResult =
  | { hit: false }
  | { hit: true; deduped: boolean; entry: CachedToolEntry; result: InternalMcpToolCallResult }

export interface ToolResultCacheOptions {
  maxEntries?: number
  dedupMinChars?: number
  now?: () => number
}

export interface ToolResultCacheStats {
  size: number
  maxEntries: number
  hits: number
  dedupHits: number
  misses: number
  evictions: number
  invalidations: number
}

const FAST_GIT_ACTIONS = new Set(['status', 'branch', 'diff_summary', 'diff', 'file_at_ref', 'checkpoints', 'log'])
const READ_GITHUB_ACTIONS = new Set(['status', 'branches', 'pull_requests', 'pull_request_status', 'commits', 'commit', 'releases', 'workflows', 'runs', 'run', 'run_logs'])
const READ_TASK_ACTIONS = new Set(['list', 'ready', 'executions'])
const READ_SKILL_ACTIONS = new Set(['list', 'get'])
const READ_SETTINGS_ACTIONS = new Set(['workspace', 'policy'])
const READ_INTEGRATION_ACTIONS = new Set(['groups', 'handoffs'])
const READ_SEARCH_ACTIONS = new Set(['files', 'text'])

const AUTH_GATED_READ_TOOLS = new Set([
  'oxespace_capabilities',
  'oxespace_execution_context',
  'oxespace_project_context',
  'oxespace_delegation_targets',
  'oxespace_list_agents',
  'oxespace_db_connections',
  'oxespace_db_describe',
  'oxespace_db_tables',
  'oxespace_db_explain'
])

function readStringField(args: unknown, field: string): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const value = (args as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Returns the caching policy for a read-only tool call, or `null` when the call must never be cached
 * (e.g., live streaming outputs, polling waits, approval-gated queries, or mutating tools).
 */
export function getToolCachePolicy(toolName: string, args: unknown): ToolCachePolicy | null {
  const action = readStringField(args, 'action')
  const requiresAuthCheck = AUTH_GATED_READ_TOOLS.has(toolName)

  // Slow tier (300s): DB schema introspection
  if (toolName === 'oxespace_db_describe' || toolName === 'oxespace_db_tables' || toolName === 'oxespace_db_connections' || toolName === 'oxespace_db_explain') {
    return { tier: 'slow', ttlMs: CACHE_TTL_MS.slow, domain: 'db', requiresAuthCheck }
  }

  // Fast tier (30s): volatile git/job/container/task/github status queries
  if (toolName === 'oxespace_git') {
    return action && FAST_GIT_ACTIONS.has(action)
      ? { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'git' }
      : null
  }
  if (toolName === 'oxespace_list_background_jobs') {
    return { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'jobs' }
  }
  if (toolName === 'oxespace_list_worktrees') {
    return { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'git' }
  }
  if (toolName === 'oxespace_github') {
    return action && READ_GITHUB_ACTIONS.has(action)
      ? { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'git' }
      : null
  }
  if (toolName === 'oxespace_tasks') {
    return action && READ_TASK_ACTIONS.has(action)
      ? { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'workspace' }
      : null
  }
  if (toolName === 'oxespace_agents') {
    // Only cache same-workspace agent list; cross-workspace reads require approval, and read/wait/bus are live.
    if (action === 'list' && !readStringField(args, 'workspaceId')) {
      return { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'workspace' }
    }
    return null
  }
  if (toolName === 'oxespace_containers_list') {
    return { tier: 'fast', ttlMs: CACHE_TTL_MS.fast, domain: 'db' }
  }

  // Medium tier (120s): file listings and workspace metadata
  if (toolName === 'oxespace_search') {
    return action && READ_SEARCH_ACTIONS.has(action)
      ? { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'search' }
      : null
  }
  if (
    toolName === 'oxespace_list_workspaces' ||
    toolName === 'oxespace_list_panes' ||
    toolName === 'oxespace_list_scripts' ||
    toolName === 'oxespace_project_context' ||
    toolName === 'oxespace_capabilities' ||
    toolName === 'oxespace_execution_context' ||
    toolName === 'oxespace_delegation_targets' ||
    toolName === 'oxespace_list_agents'
  ) {
    return { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'workspace', requiresAuthCheck }
  }
  if (toolName === 'oxespace_skills') {
    return action && READ_SKILL_ACTIONS.has(action)
      ? { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'workspace' }
      : null
  }
  if (toolName === 'oxespace_settings') {
    return action && READ_SETTINGS_ACTIONS.has(action)
      ? { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'workspace' }
      : null
  }
  if (toolName === 'oxespace_integration') {
    return action && READ_INTEGRATION_ACTIONS.has(action)
      ? { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'workspace' }
      : null
  }
  if (toolName === 'oxespace_mcp_servers') {
    return action === 'list'
      ? { tier: 'medium', ttlMs: CACHE_TTL_MS.medium, domain: 'workspace' }
      : null
  }

  return null
}

const DB_MUTATION_TOOLS = new Set([
  'oxespace_db_execute',
  'oxespace_mongo_write',
  'oxespace_container_action'
])

const GIT_MUTATION_TOOLS = new Set([
  'oxespace_git_change',
  'oxespace_create_worktree',
  'oxespace_remove_worktree',
  'oxespace_github_change'
])

const EXEC_MUTATION_TOOLS = new Set([
  'oxespace_run_script',
  'oxespace_stop_background_job',
  'oxespace_agents_change',
  'oxespace_tasks_change'
])

const WORKSPACE_MUTATION_TOOLS = new Set([
  'oxespace_skills_change',
  'oxespace_mcp_servers_change',
  'oxespace_workspace_change',
  'oxespace_threads_change',
  'oxespace_thread_create',
  'oxespace_thread_send',
  'oxespace_delegate_task',
  'oxespace_work_plan',
  'oxespace_delegation_update',
  'oxespace_delegation_control',
  'oxespace_work_cancel'
])

const GENERIC_MUTATION_RE = /(?:^|_)(?:write|edit|patch|create|delete|remove|drop|alter|insert|update|execute|exec|run|stop|start|commit|push|pull|checkout|merge|rebase|stage|unstage|restore|install|change)(?:$|_)/i
const GENERIC_DB_TOOL_RE = /(?:^|_)(?:db|sql|mongo|postgres|mysql|sqlite|schema|table|ddl)(?:$|_)/i

/**
 * Classifies whether a tool call mutates state and which cache domains/connections it must invalidate.
 */
export function getMutationInvalidation(toolName: string, args: unknown): MutationInvalidation | null {
  // Known read-only tools never invalidate.
  if (getToolCachePolicy(toolName, args) !== null) return null

  const connection = readStringField(args, 'connection') ?? readStringField(args, 'database')

  if (DB_MUTATION_TOOLS.has(toolName)) {
    return { domains: ['db'], ...(connection ? { connection } : {}) }
  }
  if (GIT_MUTATION_TOOLS.has(toolName)) {
    return { domains: ['git', 'search', 'workspace'] }
  }
  if (EXEC_MUTATION_TOOLS.has(toolName)) {
    return { domains: ['jobs', 'git', 'search', 'workspace'] }
  }
  if (WORKSPACE_MUTATION_TOOLS.has(toolName)) {
    return { domains: ['workspace', 'git', 'search'] }
  }

  // Known non-cached read-only tools should not trigger unnecessary invalidations.
  if (
    toolName === 'oxespace_get_job_output' ||
    toolName === 'oxespace_terminal' ||
    toolName === 'oxespace_quality_check' ||
    toolName === 'oxespace_diagnostics' ||
    toolName === 'oxespace_usage' ||
    toolName === 'oxespace_db_query' ||
    toolName === 'oxespace_mongo_find' ||
    toolName === 'oxespace_mongo_aggregate' ||
    toolName === 'oxespace_db_activity' ||
    toolName === 'oxespace_container_logs' ||
    toolName === 'oxespace_capture_web_preview' ||
    toolName === 'oxespace_device_screenshot' ||
    toolName === 'oxespace_android_logcat_tail' ||
    toolName === 'oxespace_tools_enable' ||
    toolName === 'oxespace_tools_search'
  ) {
    return null
  }

  if (GENERIC_MUTATION_RE.test(toolName)) {
    if (GENERIC_DB_TOOL_RE.test(toolName)) {
      return { domains: ['db'], ...(connection ? { connection } : {}) }
    }
    return { domains: ['git', 'search', 'workspace', 'jobs'] }
  }

  return null
}

/**
 * Extracts the optional `fresh?: boolean` cache bypass flag from raw tool arguments.
 * Strips `fresh` before forwarding to handlers whose schema has `additionalProperties: false`.
 */
export function extractFreshFlag(args: unknown, toolDefinesFresh = false): { fresh: boolean; sanitizedArgs: unknown } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { fresh: false, sanitizedArgs: args }
  }
  const record = args as Record<string, unknown>
  if (!Object.hasOwn(record, 'fresh')) {
    return { fresh: false, sanitizedArgs: args }
  }
  const fresh = record.fresh === true
  if (toolDefinesFresh) {
    return { fresh, sanitizedArgs: args }
  }
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (k !== 'fresh') rest[k] = v
  }
  return { fresh, sanitizedArgs: rest }
}

/** Canonical JSON serialization with sorted keys so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically. */
export function canonicalizeArgs(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalizeArgs).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => k !== 'fresh' && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeArgs(v)}`).join(',')}}`
}

export function formatDedupSummary(cachedAtIso: string, charCount: number): string {
  return `Same output as previous run at ${cachedAtIso} (${charCount} chars; unchanged). Pass fresh: true to force full output.`
}

function textPayloadLength(result: InternalMcpToolCallResult): number {
  let total = 0
  let textBlocks = 0
  for (const block of result.content) {
    if (block.type === 'text') {
      total += block.text.length
      textBlocks++
    }
  }
  return total + Math.max(0, textBlocks - 1)
}

function hasNonTextBlocks(result: InternalMcpToolCallResult): boolean {
  return result.content.some(block => block.type !== 'text')
}

function normalizeScope(value: string | undefined): string {
  return (value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export class ToolResultCache {
  private readonly entries = new Map<string, CachedToolEntry>()
  private readonly maxEntries: number
  private readonly dedupMinChars: number
  private readonly now: () => number
  private hits = 0
  private dedupHits = 0
  private misses = 0
  private evictions = 0
  private invalidations = 0

  constructor(options: ToolResultCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? MAX_CACHE_ENTRIES)
    this.dedupMinChars = Math.max(0, options.dedupMinChars ?? DEFAULT_DEDUP_MIN_CHARS)
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  buildKey(toolName: string, args: unknown, ctx: ToolCacheContext): string {
    const conn = ctx.connection ?? readStringField(args, 'connection') ?? ''
    const cwd = normalizeScope(ctx.cwd)
    return `${ctx.sessionKey}\0${ctx.workspaceScope}\0${cwd}\0${conn}\0${toolName}\0${canonicalizeArgs(args)}`
  }

  /**
   * Read-through lookup. Returns a cache hit (with compact dedup response when payload >= `dedupMinChars`
   * and `fresh` is not true) or `{ hit: false }`.
   */
  lookup(
    toolName: string,
    args: unknown,
    ctx: ToolCacheContext,
    options: { fresh?: boolean } = {}
  ): ToolCacheLookupResult {
    if (options.fresh) {
      this.misses++
      return { hit: false }
    }
    const key = this.buildKey(toolName, args, ctx)
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses++
      return { hit: false }
    }
    const current = this.now()
    if (current >= entry.expiresAtMs) {
      this.entries.delete(key)
      this.misses++
      return { hit: false }
    }
    // Refresh LRU recency.
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.hits++

    if (entry.charCount >= this.dedupMinChars) {
      this.dedupHits++
      return {
        hit: true,
        deduped: true,
        entry,
        result: {
          content: [{ type: 'text', text: formatDedupSummary(entry.cachedAtIso, entry.charCount) }]
        }
      }
    }

    return {
      hit: true,
      deduped: false,
      entry,
      result: entry.result
    }
  }

  /**
   * Write-through store. Skips error results and non-text (e.g. image) results.
   */
  set(
    toolName: string,
    args: unknown,
    ctx: ToolCacheContext,
    policy: ToolCachePolicy,
    result: InternalMcpToolCallResult
  ): CachedToolEntry | null {
    if (result.isError || hasNonTextBlocks(result)) return null
    const key = this.buildKey(toolName, args, ctx)
    const cachedAtMs = this.now()
    const charCount = textPayloadLength(result)
    const connection = ctx.connection ?? readStringField(args, 'connection')
    const entry: CachedToolEntry = {
      key,
      toolName,
      sessionKey: ctx.sessionKey,
      workspaceScope: ctx.workspaceScope,
      ...(ctx.cwd ? { cwd: normalizeScope(ctx.cwd) } : {}),
      ...(connection ? { connection } : {}),
      domain: policy.domain,
      tier: policy.tier,
      result,
      charCount,
      cachedAtMs,
      cachedAtIso: new Date(cachedAtMs).toISOString(),
      expiresAtMs: cachedAtMs + policy.ttlMs
    }

    if (this.entries.has(key)) {
      this.entries.delete(key)
    }
    this.entries.set(key, entry)

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.entries.delete(oldestKey)
      this.evictions++
    }
    return entry
  }

  /**
   * Invalidates cached entries matching the supplied scope filters.
   * Returns the number of entries removed.
   */
  invalidate(filter: {
    workspaceScope?: string
    cwd?: string
    connection?: string
    domains?: readonly CacheDomain[]
  } = {}): number {
    const domainSet = filter.domains ? new Set(filter.domains) : null
    const normalizedCwd = filter.cwd ? normalizeScope(filter.cwd) : undefined
    let removed = 0

    for (const [key, entry] of this.entries) {
      if (domainSet && !domainSet.has(entry.domain)) continue

      // Connection-scoped DB invalidation clears all entries for that connection (or entries with no connection like db_connections).
      if (filter.connection) {
        if (entry.connection && entry.connection !== filter.connection) continue
      } else {
        if (filter.workspaceScope && entry.workspaceScope !== filter.workspaceScope && entry.workspaceScope !== 'global') {
          if (!normalizedCwd || entry.cwd !== normalizedCwd) continue
        } else if (!filter.workspaceScope && normalizedCwd && entry.cwd && entry.cwd !== normalizedCwd) {
          continue
        }
      }

      this.entries.delete(key)
      removed++
    }

    this.invalidations += removed
    return removed
  }

  /**
   * Automatically invalidates affected scopes when a mutating tool executes.
   */
  invalidateForTool(
    toolName: string,
    args: unknown,
    scope: { workspaceScope?: string; cwd?: string } = {}
  ): number {
    const mutation = getMutationInvalidation(toolName, args)
    if (!mutation) return 0
    return this.invalidate({
      workspaceScope: scope.workspaceScope,
      cwd: scope.cwd,
      connection: mutation.connection,
      domains: mutation.domains
    })
  }

  /**
   * Read-through / write-through helper that handles lookup, execution, caching, and mutation invalidation.
   */
  async readThrough(
    toolName: string,
    rawArgs: unknown,
    ctx: ToolCacheContext,
    execute: (sanitizedArgs: unknown) => Promise<InternalMcpToolCallResult>,
    options: { toolDefinesFresh?: boolean; customPolicy?: ToolCachePolicy | null } = {}
  ): Promise<{ result: InternalMcpToolCallResult; fromCache: boolean; deduped: boolean }> {
    const { fresh, sanitizedArgs } = extractFreshFlag(rawArgs, options.toolDefinesFresh)
    const policy = options.customPolicy !== undefined ? options.customPolicy : getToolCachePolicy(toolName, sanitizedArgs)

    if (policy) {
      const hit = this.lookup(toolName, sanitizedArgs, ctx, { fresh })
      if (hit.hit) {
        return { result: hit.result, fromCache: true, deduped: hit.deduped }
      }
      const produced = await execute(sanitizedArgs)
      this.set(toolName, sanitizedArgs, ctx, policy, produced)
      return { result: produced, fromCache: false, deduped: false }
    }

    const produced = await execute(sanitizedArgs)
    this.invalidateForTool(toolName, sanitizedArgs, { workspaceScope: ctx.workspaceScope, cwd: ctx.cwd })
    return { result: produced, fromCache: false, deduped: false }
  }

  clear(): void {
    this.entries.clear()
  }

  getStats(): ToolResultCacheStats {
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      dedupHits: this.dedupHits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations
    }
  }
}
