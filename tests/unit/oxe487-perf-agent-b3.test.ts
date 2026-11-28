import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { setPolicyStore } from '../../electron/main/services/policy'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import { removeTempDir } from '../helpers/removeTempDir'
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

  it('defers redaction/schema compaction to top-K winners so 250-tool search stays fast (< 5 ms p50) while still redacting returned matches (OXE-492)', () => {
    const catalog = Array.from({ length: 250 }, (_, i) => ({
      name: i === 120 ? 'postgres_query_database' : `mcp_tool_service_${i}`,
      server: `server-${i % 10}`,
      source: 'external' as const,
      group: `group-${i % 5}`,
      description: `Tool ${i} handles records with secret ghp_1234567890abcdefghijklmnopqrstuvwxyz1234 for database workflows`,
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: `SQL query param ${i} token ghp_1234567890abcdefghijklmnopqrstuvwxyz1234` },
          mode: { type: 'string', enum: ['fast', 'deep', 'full'] },
          limit: { type: 'integer', description: 'Row cap for query execution' },
          timeoutMs: { type: 'integer', description: 'Timeout in milliseconds' }
        }
      }
    }))

    // Warm up JIT once, then measure 25 runs.
    rankToolCandidates(catalog, { query: 'database query', limit: 8 })
    const timings: number[] = []
    let lastResult = rankToolCandidates(catalog, { query: 'database query', limit: 8 })
    for (let run = 0; run < 25; run++) {
      const start = performance.now()
      lastResult = rankToolCandidates(catalog, { query: 'database query', limit: 8 })
      timings.push(performance.now() - start)
    }
    timings.sort((a, b) => a - b)
    const p50 = timings[Math.floor(timings.length / 2)]

    expect(lastResult.totalMatches).toBe(250)
    expect(lastResult.items).toHaveLength(8)
    expect(lastResult.items[0].name).toBe('postgres_query_database')
    // Returned top-K items MUST still be redacted and compacted.
    for (const item of lastResult.items) {
      expect(item.description).not.toContain('ghp_1234567890')
      expect(item.inputSchema.properties.query.description).not.toContain('ghp_1234567890')
    }
    expect(p50).toBeLessThan(5)
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

  it('keeps end-to-end oxespace_tools_search handler fast (< 5 ms p50) over 250 internal+external tools with real PolicyStore and 0 forbidden/secret leaks (OXE-493)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe493-tool-search-root-'))
    const userData = mkdtempSync(join(tmpdir(), 'oxe493-tool-search-user-'))
    const managed = join(userData, 'managed.json')
    try {
      mkdirSync(join(root, '.oxespace'), { recursive: true })
      writeFileSync(join(root, '.oxespace', 'policy.json'), JSON.stringify({
        rules: [
          { effect: 'deny', action: 'tool.use', resource: 'mcp__oxespace__oxespace_db_execute' },
          { effect: 'deny', action: 'integration.use', resource: 'mcp:policy-blocked-srv' }
        ]
      }))
      setPolicyStore(new PolicyStore({ userData, managed }))

      const internalCount = TOOL_REGISTRY.length
      const externalNeeded = Math.max(160, 250 - internalCount + 10)
      const serverCount = 10
      const perServer = Math.ceil(externalNeeded / serverCount)

      const servers: McpServer[] = Array.from({ length: serverCount }, (_, sIdx) => ({
        id: `srv-${sIdx}`,
        workspaceId: 'ws-1',
        name: `ext-server-${sIdx}`,
        key: `ext-server-${sIdx}`,
        transport: 'stdio',
        config: {
          transport: 'stdio',
          command: 'npx',
          args: [],
          env: { SECRET_TOKEN: `sk-ant-secret-server-${sIdx}-12345678901234567890` }
        },
        enabled: true,
        trusted: true,
        health: 'healthy',
        healthMessage: null,
        createdAtMs: 1,
        updatedAtMs: 1,
        tools: Array.from({ length: perServer }, (_, tIdx) => {
          const globalIdx = sIdx * perServer + tIdx
          return {
            name: globalIdx === 42 ? 'postgres_query_database' : `ext_tool_${globalIdx}`,
            description: `External database query helper ${globalIdx} token ghp_1234567890abcdefghijklmnopqrstuvwxyz1234`,
            inputSchema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string', description: `SQL query ${globalIdx} secret ghp_1234567890abcdefghijklmnopqrstuvwxyz1234` },
                mode: { type: 'string', enum: ['fast', 'deep'] }
              }
            }
          }
        })
      }))

      // Add forbidden servers that must NEVER appear in results.
      servers.push(
        {
          id: 'srv-policy-blocked',
          workspaceId: 'ws-1',
          name: 'policy-blocked-srv',
          key: 'policy-blocked-srv',
          transport: 'stdio',
          config: { transport: 'stdio', command: 'npx', args: [] },
          enabled: true,
          trusted: true,
          health: 'healthy',
          healthMessage: null,
          createdAtMs: 1,
          updatedAtMs: 1,
          tools: [{ name: 'policy_blocked_database_query', description: 'Database query on policy-denied server' }]
        },
        {
          id: 'srv-quarantined',
          workspaceId: 'ws-1',
          name: 'quarantined-srv',
          key: 'quarantined-srv',
          transport: 'stdio',
          config: { transport: 'stdio', command: 'npx', args: [] },
          enabled: true,
          trusted: true,
          guard: { pinned: true, hash: 'h', quarantine: { at: 1, reasons: ['changed'] } },
          health: 'unhealthy',
          healthMessage: 'Quarantined',
          createdAtMs: 1,
          updatedAtMs: 1,
          tools: [{ name: 'quarantined_database_query', description: 'Database query on quarantined server' }]
        }
      )

      const searchEntry = createToolsSearchEntry(() => TOOL_REGISTRY)
      const ctx = {
        workspaceId: 'ws-1',
        workspaceServ: {
          get: () => ({ id: 'ws-1', name: 'Repo', rootPath: root, isActive: true, panes: [] }),
          list: () => [{ id: 'ws-1', name: 'Repo', rootPath: root, isActive: true, panes: [] }]
        },
        app: {
          mcpServers: {
            list: () => servers,
            start: vi.fn(),
            stopRuntime: vi.fn()
          }
        }
      } as unknown as ToolContext

      // Verify policy-blocked internal tool and forbidden external servers are excluded.
      const deniedCheck = await searchEntry.handler({ query: 'oxespace_db_execute', limit: 10 }, ctx)
      const deniedPayload = JSON.parse((deniedCheck.content[0] as { text: string }).text) as {
        status: string
        data: { tools: Array<{ name: string }> }
      }
      expect(deniedPayload.status).toBe('ok')
      expect(deniedPayload.data.tools.map(tool => tool.name)).not.toContain('oxespace_db_execute')

      const forbiddenCheck = await searchEntry.handler({ query: 'policy_blocked_database_query', limit: 10 }, ctx)
      const forbiddenPayload = JSON.parse((forbiddenCheck.content[0] as { text: string }).text) as {
        status: string
        data: { tools: Array<{ name: string }> }
      }
      expect(forbiddenPayload.status).toBe('ok')
      expect(forbiddenPayload.data.tools.map(tool => tool.name)).not.toContain('policy_blocked_database_query')

      // Warm up once, then measure 25 end-to-end handler invocations across 250+ tools.
      await searchEntry.handler({ query: 'database query', limit: 8 }, ctx)
      const timings: number[] = []
      let lastRaw = await searchEntry.handler({ query: 'database query', limit: 8 }, ctx)
      for (let i = 0; i < 25; i++) {
        const start = performance.now()
        lastRaw = await searchEntry.handler({ query: 'database query', limit: 8 }, ctx)
        timings.push(performance.now() - start)
      }
      timings.sort((a, b) => a - b)
      const p50 = timings[Math.floor(timings.length / 2)]

      expect(lastRaw.isError).toBeUndefined()
      const rawText = (lastRaw.content[0] as { text: string }).text
      expect(rawText).not.toContain('ghp_1234567890')
      expect(rawText).not.toContain('sk-ant-secret')
      expect(rawText).not.toContain('oxespace_db_execute')
      expect(rawText).not.toContain('policy_blocked_database_query')
      expect(rawText).not.toContain('quarantined_database_query')

      const payload = JSON.parse(rawText) as {
        status: string
        data: { totalMatches: number; returned: number; tools: Array<{ name: string }> }
      }
      expect(payload.status).toBe('ok')
      expect(payload.data.totalMatches).toBeGreaterThanOrEqual(150)
      expect(payload.data.returned).toBe(8)
      expect(payload.data.tools[0].name).toBe('postgres_query_database')
      expect(p50).toBeLessThan(5)
    } finally {
      setPolicyStore(null)
      removeTempDir(root)
      removeTempDir(userData)
    }
  })
})
