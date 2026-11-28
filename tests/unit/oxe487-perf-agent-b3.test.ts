import { describe, expect, it, vi } from 'vitest'
import {
  computePromptCacheFingerprint,
  evaluatePromptCacheStatus,
  PROVIDER_CACHE_TTL_MS,
  recordPromptCacheConfigChange,
  recordPromptCacheTurn
} from '../../shared/prompt-cache'
import {
  normalizeUtilityModel,
  PROVIDER_DEFAULT_UTILITY_MODELS,
  resolveUtilityModel,
  runWithUtilityModelFallback
} from '../../shared/utility-model'
import {
  updateThreadPromptCacheOnConfig,
  updateThreadPromptCacheOnCost
} from '../../electron/main/services/conversation/thread-prompt-cache'
import { ThreadSideChats, type ThreadSideHost } from '../../electron/main/services/conversation/thread-side-chat'
import {
  createToolsSearchEntry,
  filterSearchableExternalServers,
  rankToolCandidates,
  summarizeInputSchema
} from '../../electron/main/mcp-internal/tool-search'
import { findTool, TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import {
  projectToolModes,
  sessionToolPlan,
  shouldOfferToolSearch,
  TOOLS_SEARCH
} from '../../electron/main/services/conversation/tool-groups'
import { AUTO_APPROVED_LOOKUPS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/read-only-mcp-tools'
import type { AgentConversationAdapter, ConversationThread } from '../../shared/types/thread'
import type { McpServer } from '../../shared/types/mcp'

function makeThread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: 'thread-1',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    rootPath: '/repo',
    provider: 'claude',
    nativeSessionId: 'native-1',
    title: 'Performance work',
    pinned: false,
    status: 'idle',
    model: 'claude-opus-4-6',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  }
}

describe('OXE-487 Pillar 1 · Prompt Cache Stale & Break Detection', () => {
  it('marks cache warm after a cached turn and transitions to stale after provider TTL', () => {
    const thread = makeThread({ provider: 'claude', model: 'claude-sonnet-4-6' })
    const fp = computePromptCacheFingerprint(thread)
    const t0 = 1_000_000

    const state = recordPromptCacheTurn(undefined, {
      provider: 'claude',
      fingerprint: fp,
      cacheReadTokens: 18_500,
      inputTokens: 400,
      now: t0
    })
    expect(state).toBeDefined()
    expect(evaluatePromptCacheStatus(state, t0 + 60_000, fp)).toMatchObject({
      kind: 'warm',
      lastCacheReadTokens: 18_500
    })

    const stale = evaluatePromptCacheStatus(state, t0 + PROVIDER_CACHE_TTL_MS.claude + 10_000, fp)
    expect(stale.kind).toBe('stale')
    expect(stale.idleMs).toBeGreaterThanOrEqual(PROVIDER_CACHE_TTL_MS.claude)
  })

  it('detects prefix invalidation when model, MCP tools, or mode settings change', () => {
    const thread = makeThread({ provider: 'claude', model: 'claude-sonnet-4-6', mode: 'default' })
    const t0 = 2_000_000
    updateThreadPromptCacheOnCost(thread, { cacheReadTokens: 24_000, inputTokens: 300 }, t0)
    expect(evaluatePromptCacheStatus(thread.promptCache, t0 + 10_000).kind).toBe('warm')

    // Model change breaks cache
    updateThreadPromptCacheOnConfig(thread, { model: 'claude-sonnet-4-6' }, { model: 'claude-opus-4-6' }, t0 + 15_000)
    expect(evaluatePromptCacheStatus(thread.promptCache, t0 + 15_000)).toMatchObject({
      kind: 'broken',
      reason: 'model-changed'
    })

    // Re-warming clears the break
    thread.model = 'claude-opus-4-6'
    updateThreadPromptCacheOnCost(thread, { cacheCreationTokens: 25_000, inputTokens: 200 }, t0 + 20_000)
    expect(evaluatePromptCacheStatus(thread.promptCache, t0 + 25_000).kind).toBe('warm')

    // MCP disabled tools change breaks cache
    updateThreadPromptCacheOnConfig(
      thread,
      { model: 'claude-opus-4-6', disabledMcpTools: [] },
      { model: 'claude-opus-4-6', disabledMcpTools: ['github/create_issue'] },
      t0 + 30_000
    )
    expect(evaluatePromptCacheStatus(thread.promptCache, t0 + 30_000)).toMatchObject({
      kind: 'broken',
      reason: 'mcp-tools-changed'
    })

    // Mode change breaks cache with configuration-changed
    const nextState = recordPromptCacheConfigChange(
      { ...thread.promptCache!, breakReason: undefined, brokenAt: undefined },
      thread,
      { ...thread, mode: 'plan' },
      t0 + 35_000
    )
    expect(evaluatePromptCacheStatus(nextState, t0 + 35_000)).toMatchObject({
      kind: 'broken',
      reason: 'configuration-changed'
    })
  })

  it('detects sharp cacheReadTokens drop within TTL as prefix-drop', () => {
    const thread = makeThread({ provider: 'codex', model: 'gpt-5' })
    const fp = computePromptCacheFingerprint(thread)
    const t0 = 5_000_000

    const warm = recordPromptCacheTurn(undefined, {
      provider: 'codex',
      fingerprint: fp,
      cacheReadTokens: 40_000,
      inputTokens: 500,
      now: t0
    })

    const dropped = recordPromptCacheTurn(warm, {
      provider: 'codex',
      fingerprint: fp,
      cacheReadTokens: 2_000,
      cacheCreationTokens: 35_000,
      inputTokens: 3_000,
      now: t0 + 30_000
    })
    expect(evaluatePromptCacheStatus(dropped, t0 + 31_000, fp)).toMatchObject({
      kind: 'broken',
      reason: 'prefix-drop'
    })
  })
})

describe('OXE-487 Pillar 2 · Utility Model Routing & Graceful Fallback', () => {
  it('resolves Auto defaults, explicit overrides, primary opt-out, and catalog validation', () => {
    expect(normalizeUtilityModel('  auto  ')).toBe('')
    expect(normalizeUtilityModel('PRIMARY')).toBe('primary')
    expect(normalizeUtilityModel('claude-haiku-4-5')).toBe('claude-haiku-4-5')
    expect(normalizeUtilityModel('bad model with spaces!')).toBe('')

    // Auto picks provider fast default with primary as fallback
    const claudeAuto = resolveUtilityModel('claude', 'claude-opus-4-6', '')
    expect(claudeAuto).toEqual({
      model: PROVIDER_DEFAULT_UTILITY_MODELS.claude,
      fallbackModel: 'claude-opus-4-6',
      isUtilityOverride: true,
      source: 'provider-default'
    })

    // Primary opt-out keeps primary model with no override
    const keepPrimary = resolveUtilityModel('codex', 'gpt-5', 'primary')
    expect(keepPrimary).toEqual({
      model: 'gpt-5',
      fallbackModel: undefined,
      isUtilityOverride: false,
      source: 'primary'
    })

    // Explicit per-provider config
    const perProvider = resolveUtilityModel('antigravity', 'gemini-2.5-pro', { antigravity: 'gemini-2.5-flash-lite' })
    expect(perProvider).toMatchObject({
      model: 'gemini-2.5-flash-lite',
      fallbackModel: 'gemini-2.5-pro',
      isUtilityOverride: true,
      source: 'configured'
    })

    // Unavailable explicit model gracefully falls back to primary
    const unavailable = resolveUtilityModel('claude', 'claude-sonnet-4-6', 'nonexistent-mini', {
      availableModels: ['claude-sonnet-4-6', 'claude-opus-4-6']
    })
    expect(unavailable).toEqual({
      model: 'claude-sonnet-4-6',
      fallbackModel: undefined,
      isUtilityOverride: false,
      source: 'primary'
    })
  })

  it('gracefully falls back to primary model on utility model error without failing the workflow', async () => {
    const resolution = resolveUtilityModel('claude', 'claude-opus-4-6', 'claude-haiku-4-5')
    const attempts: Array<{ model: string | undefined; attempt: string }> = []
    const onFallback = vi.fn()

    const result = await runWithUtilityModelFallback(
      resolution,
      async (model, attempt) => {
        attempts.push({ model, attempt })
        if (attempt === 'utility') throw new Error('429 rate limited on utility model')
        return 'ok-from-primary'
      },
      { onFallback }
    )

    expect(result).toEqual({
      value: 'ok-from-primary',
      modelUsed: 'claude-opus-4-6',
      usedFallback: true
    })
    expect(attempts).toEqual([
      { model: 'claude-haiku-4-5', attempt: 'utility' },
      { model: 'claude-opus-4-6', attempt: 'fallback' }
    ])
    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('does not swallow explicit user AbortError during utility model routing', async () => {
    const resolution = resolveUtilityModel('codex', 'gpt-5', 'gpt-4o-mini')
    const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' })
    await expect(
      runWithUtilityModelFallback(resolution, async () => { throw abortErr })
    ).rejects.toThrow('Aborted')
  })

  it('routes ThreadSideChats through utility model and falls back to primary when utility model fails to start', async () => {
    const thread = makeThread({ provider: 'claude', model: 'claude-opus-4-6', nativeSessionId: 'sess-1' })
    const connectModels: Array<string | undefined> = []

    const createAdapter = (failOnStart: boolean): AgentConversationAdapter => ({
      capabilities: { resume: true, approvals: false, attachments: false, modelSelection: true },
      evidence: { transport: 'test', verified: 'fixture' },
      start: vi.fn(async () => {
        if (failOnStart) throw new Error('Model claude-haiku-4-5 unavailable for this plan')
      }),
      send: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      approve: vi.fn(async () => {}),
      dispose: vi.fn(async () => {})
    })

    const host: ThreadSideHost = {
      readThread: () => thread,
      subscribe: () => () => {},
      connect: vi.fn(async (_t, _forkId, req) => {
        connectModels.push(req?.model)
        return createAdapter(req?.model === 'claude-haiku-4-5')
      }),
      unavailable: () => false,
      discard: vi.fn(async () => {})
    }

    const sides = new ThreadSideChats(host)
    const opened = await sides.open(thread.id, () => {}, { utilityModel: 'claude-haiku-4-5' })

    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.side.model).toBe('claude-opus-4-6')
      expect(opened.side.utilityModelFallback).toBe(true)
    }
    expect(connectModels).toEqual(['claude-haiku-4-5', 'claude-opus-4-6'])
    await sides.stop()
  })
})

describe('OXE-487 Pillar 3 · Multi-Provider Deferred Tool Search (oxespace_tools_search)', () => {
  it('registers oxespace_tools_search as read-only and auto-approved, and offers it to Codex and Antigravity', () => {
    const entry = findTool(TOOLS_SEARCH)
    expect(entry).not.toBeNull()
    expect(entry!.descriptor.annotations?.readOnlyHint).toBe(true)
    expect(entry!.descriptor.annotations?.destructiveHint).toBe(false)
    expect(THREAD_READ_ONLY_MCP_TOOLS).toContain(TOOLS_SEARCH)
    expect(AUTO_APPROVED_LOOKUPS).toContain(TOOLS_SEARCH)

    expect(shouldOfferToolSearch('codex')).toBe(true)
    expect(shouldOfferToolSearch('antigravity')).toBe(true)
    expect(shouldOfferToolSearch('claude')).toBe(false)

    const defaults = projectToolModes(undefined)
    const codexPlan = sessionToolPlan(true, {}, defaults, { provider: 'codex' })
    const agyPlan = sessionToolPlan(true, {}, defaults, { provider: 'antigravity' })
    const claudePlan = sessionToolPlan(true, {}, defaults, { provider: 'claude' })
    const claudeOptIn = sessionToolPlan(true, {}, defaults, { provider: 'claude', includeToolSearch: true })

    expect(codexPlan.tools).toContain(TOOLS_SEARCH)
    expect(agyPlan.tools).toContain(TOOLS_SEARCH)
    expect(claudePlan.tools).not.toContain(TOOLS_SEARCH)
    expect(claudeOptIn.tools).toContain(TOOLS_SEARCH)
  })

  it('compacts schemas, redacts sensitive strings, ranks matches, and caps top-K results', () => {
    const summary = summarizeInputSchema({
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search using token ghp_1234567890abcdefghijklmnopqrstuvwxyz1234' },
        mode: { type: 'string', enum: ['fast', 'deep'] }
      }
    })
    expect(summary.required).toEqual(['query'])
    expect(summary.properties.mode.enum).toEqual(['fast', 'deep'])
    expect(summary.properties.query.description).not.toContain('ghp_1234567890')

    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `tool_${i}`,
      server: 'external-mcp',
      source: 'external' as const,
      group: 'external-mcp',
      description: `Helper tool ${i} for database queries`,
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } }
    }))
    const defaultBounded = rankToolCandidates(many, { query: 'database' })
    expect(defaultBounded.totalMatches).toBe(25)
    expect(defaultBounded.items).toHaveLength(8)

    const maxBounded = rankToolCandidates(many, { query: 'database', limit: 999 })
    expect(maxBounded.items).toHaveLength(20)
  })

  it('excludes disabled, untrusted, quarantined, and internal duplicate MCP servers from search results', async () => {
    const servers: McpServer[] = [
      {
        id: 's1', workspaceId: 'ws-1', name: 'linear', key: 'linear', transport: 'stdio',
        config: { transport: 'stdio', command: 'npx', args: [], env: { API_KEY: 'sk-ant-secret12345678901234567890' } },
        enabled: true, trusted: true, health: 'healthy', healthMessage: null, createdAtMs: 1, updatedAtMs: 1,
        tools: [{ name: 'linear_list_issues', description: 'List Linear issues for the team', inputSchema: { type: 'object', properties: { team: { type: 'string' } } } }]
      },
      {
        id: 's2', workspaceId: 'ws-1', name: 'quarantined-srv', key: 'quarantined-srv', transport: 'stdio',
        config: { transport: 'stdio', command: 'npx', args: [] },
        enabled: true, trusted: true,
        guard: { pinned: true, hash: 'abc', quarantine: { at: 1, reasons: ['tool changed'] } },
        health: 'unhealthy', healthMessage: 'Quarantined', createdAtMs: 1, updatedAtMs: 1,
        tools: [{ name: 'evil_list_issues', description: 'Should never appear' }]
      },
      {
        id: 's3', workspaceId: 'ws-1', name: 'disabled-srv', key: 'disabled-srv', transport: 'stdio',
        config: { transport: 'stdio', command: 'npx', args: [] },
        enabled: false, trusted: true, health: 'unknown', healthMessage: null, createdAtMs: 1, updatedAtMs: 1,
        tools: [{ name: 'disabled_list_issues', description: 'Disabled server tool' }]
      },
      {
        id: 's4', workspaceId: 'ws-1', name: 'untrusted-srv', key: 'untrusted-srv', transport: 'stdio',
        config: { transport: 'stdio', command: 'npx', args: [] },
        enabled: true, trusted: false, health: 'unknown', healthMessage: null, createdAtMs: 1, updatedAtMs: 1,
        tools: [{ name: 'untrusted_list_issues', description: 'Untrusted server tool' }]
      },
      {
        id: 's5', workspaceId: null, name: 'oxespace', key: 'oxespace', transport: 'stdio',
        config: { transport: 'stdio', command: 'node', args: [] },
        enabled: true, trusted: true, health: 'healthy', healthMessage: null, createdAtMs: 1, updatedAtMs: 1,
        tools: [{ name: 'oxespace_git', description: 'Duplicate internal' }]
      }
    ]

    const safe = filterSearchableExternalServers(servers)
    expect(safe.map(s => s.name)).toEqual(['linear'])

    const tool = createToolsSearchEntry(() => TOOL_REGISTRY)
    const ctx = {
      workspaceId: 'ws-1',
      workspaceServ: {
        get: () => ({ id: 'ws-1', name: 'Repo', rootPath: '/repo', isActive: true, panes: [] }),
        list: () => [{ id: 'ws-1', name: 'Repo', rootPath: '/repo', isActive: true, panes: [] }]
      },
      app: {
        mcpServers: {
          list: () => servers,
          start: vi.fn(),
          stopRuntime: vi.fn()
        }
      }
    } as unknown as ToolContext

    const raw = await tool.handler({ query: 'issues', limit: 10 }, ctx)
    expect(raw.isError).toBeUndefined()
    const payload = JSON.parse((raw.content[0] as { text: string }).text) as {
      status: string
      data: { tools: Array<{ name: string; server: string; source: string }> }
    }
    expect(payload.status).toBe('ok')
    const names = payload.data.tools.map(item => item.name)
    expect(names).toContain('linear_list_issues')
    expect(names).not.toContain('evil_list_issues')
    expect(names).not.toContain('disabled_list_issues')
    expect(names).not.toContain('untrusted_list_issues')
    // Must never leak env/command/secret metadata from server config
    expect((raw.content[0] as { text: string }).text).not.toContain('sk-ant-secret')
  })
})
