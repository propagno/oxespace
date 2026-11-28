import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compactToolOutput,
  isCriticalDiagnosticLine,
  isProtectedStructuredOutput,
  MIN_COMPRESSIBLE_LENGTH
} from '../../electron/main/mcp-internal/output-compactor'
import { boundToolResult, boundToolResultWithMeta } from '../../electron/main/mcp-internal/tool-result-bound'
import {
  CACHE_TTL_MS,
  DEFAULT_DEDUP_MIN_CHARS,
  extractFreshFlag,
  getToolCachePolicy,
  MAX_CACHE_ENTRIES,
  ToolResultCache
} from '../../electron/main/mcp-internal/tool-result-cache'
import { createLocalRpcServer } from '../../electron/main/mcp-internal/local-rpc-server'
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { handlers, resetJobOutputCursors } from '../../electron/main/mcp-internal/tool-handlers'
import { WebPreviewBus } from '../../electron/main/mcp-internal/web-preview-bus'
import { WorktreeEventBus } from '../../electron/main/mcp-internal/worktree-event-bus'
import {
  createIdleSilencePromoter,
  DEFAULT_IDLE_SILENCE_TIMEOUT_MS
} from '../../electron/main/services/conversation/thread-background'
import type { BackgroundJobOutputChunk } from '../../shared/types/background'
import type { InternalMcpToolCallResult } from '../../shared/types/mcp-internal'

afterEach(() => {
  resetJobOutputCursors()
})

describe('OXE-486: semantic tool output compactor', () => {
  it('protects valid JSON, NDJSON, YAML, TOML, CSV, and XML from semantic mutation', () => {
    const bigJson = JSON.stringify({
      ok: true,
      items: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        name: 'same-value-repeated',
        note: 'npm warn deprecated foo@1.0.0'
      }))
    }, null, 2)
    expect(bigJson.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(bigJson)).toBe(true)
    const jsonRes = compactToolOutput(bigJson)
    expect(jsonRes.compacted).toBe(false)
    expect(jsonRes.skippedReason).toBe('structured_format')
    expect(jsonRes.text).toBe(bigJson)

    const ndjson = Array.from({ length: 30 }, (_, i) => JSON.stringify({ idx: i, status: 'ok', payload: 'x'.repeat(30) })).join('\n')
    expect(ndjson.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(ndjson)).toBe(true)
    expect(compactToolOutput(ndjson).text).toBe(ndjson)

    const yamlDoc = [
      '---',
      'version: "2.0"',
      'services:',
      ...Array.from({ length: 25 }, (_, i) => [
        `  worker_${i}:`,
        '    image: node:22-alpine',
        '    restart: always',
        '    ports:',
        `      - "${3000 + i}:3000"`
      ].join('\n'))
    ].join('\n')
    expect(yamlDoc.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(yamlDoc)).toBe(true)
    expect(compactToolOutput(yamlDoc).text).toBe(yamlDoc)

    const tomlDoc = [
      '[package]',
      'name = "oxespace-agent"',
      'version = "1.6.2"',
      'edition = "2021"',
      '',
      '[dependencies]',
      ...Array.from({ length: 35 }, (_, i) => `crate_${i} = { version = "1.0.${i}", features = ["full"] }`)
    ].join('\n')
    expect(tomlDoc.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(tomlDoc)).toBe(true)
    expect(compactToolOutput(tomlDoc).text).toBe(tomlDoc)

    const csvDoc = [
      'id,name,status,description',
      ...Array.from({ length: 40 }, (_, i) => `${i},"item, ${i}",active,"consistent row value ${i}"`)
    ].join('\n')
    expect(csvDoc.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(csvDoc)).toBe(true)
    expect(compactToolOutput(csvDoc).text).toBe(csvDoc)

    const xmlDoc = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<report>',
      ...Array.from({ length: 30 }, (_, i) => `  <entry id="${i}" status="ok">value-${i}</entry>`),
      '</report>'
    ].join('\n')
    expect(xmlDoc.length).toBeGreaterThanOrEqual(MIN_COMPRESSIBLE_LENGTH)
    expect(isProtectedStructuredOutput(xmlDoc)).toBe(true)
    expect(compactToolOutput(xmlDoc).text).toBe(xmlDoc)
  })

  it('skips outputs shorter than MIN_COMPRESSIBLE_LENGTH (1024 chars)', () => {
    const short = '\x1B[32mnpm warn deprecated old@1.0.0\x1B[0m\n'.repeat(5)
    expect(short.length).toBeLessThan(MIN_COMPRESSIBLE_LENGTH)
    const res = compactToolOutput(short)
    expect(res.compacted).toBe(false)
    expect(res.skippedReason).toBe('too_short')
    expect(res.text).toBe(short)
  })

  it('strips ANSI codes, resolves CR progress frames, collapses lockfile diffs and boilerplate while preserving errors and diagnostics', () => {
    const lockfileLines = Array.from({ length: 120 }, (_, i) => `+    "pkg-${i}": "1.0.${i}",`)
    const deprecatedLines = Array.from({ length: 15 }, (_, i) => `\x1B[33mnpm warn deprecated legacy-pkg-${i}@0.1.0: no longer maintained\x1B[0m`)
    const progressLines = [
      '\x1B[36mDownloading 10%\rDownloading 45%\rDownloading 80%\rInstalled 42 packages in 1.2s\x1B[0m',
      '⠋ Installing packages...',
      '⠙ Installing packages...',
      '⠹ Installing packages...',
      '10% building 4/20 modules',
      '50% building 10/20 modules',
      '95% emitting assets',
      '[=========>     ] 60%',
      '[==============>] 99%'
    ]
    const repeatedBoilerplate = Array.from({ length: 20 }, () => '  info: scanning workspace dependencies without changes')

    const rawOutput = [
      ...deprecatedLines,
      ...progressLines,
      ...repeatedBoilerplate,
      'diff --git a/package-lock.json b/package-lock.json',
      'index 1111111..2222222 100644',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -1,120 +1,120 @@',
      ...lockfileLines,
      'diff --git a/src/service.ts b/src/service.ts',
      '--- a/src/service.ts',
      '+++ b/src/service.ts',
      '@@ -10,2 +10,3 @@',
      '+export const keptSourceLine = true',
      'FAIL tests/unit/service.test.ts',
      'src/service.ts:42:10 - error TS2345: Argument of type "string" is not assignable to parameter of type "number".',
      'TypeError: Cannot read properties of undefined (reading "id")',
      '    at resolveUser (src/service.ts:42:10)',
      '    at Object.<anonymous> (tests/unit/service.test.ts:18:5)',
      'Process exited with code 1'
    ].join('\n')

    expect(isProtectedStructuredOutput(rawOutput)).toBe(false)
    const compacted = compactToolOutput(rawOutput)
    expect(compacted.compacted).toBe(true)
    expect(compacted.originalChars).toBe(rawOutput.length)
    expect(compacted.compactedChars).toBe(compacted.text.length)
    expect(compacted.charsSaved).toBeGreaterThan(rawOutput.length * 0.6)

    // ANSI codes removed & CR overwrite frames reduced to final frame
    expect(compacted.text).not.toContain('\x1B[')
    expect(compacted.text).not.toContain('Downloading 10%')
    expect(compacted.text).toContain('Installed 42 packages in 1.2s')

    // Lockfile collapsed, real source diff kept
    expect(compacted.text).toContain('diff --git a/package-lock.json b/package-lock.json')
    expect(compacted.text).toContain('[lockfile diff omitted: 120 lines changed]')
    expect(compacted.text).not.toContain('"pkg-50"')
    expect(compacted.text).toContain('+export const keptSourceLine = true')

    // Boilerplate and deprecated warnings collapsed
    expect(compacted.text).toContain('[npm warn deprecated omitted: 15 lines]')
    expect(compacted.text).toContain('[repeated 20 times]')

    // Critical diagnostics, stack traces, test failures, and exit code preserved intact
    expect(isCriticalDiagnosticLine('src/service.ts:42:10 - error TS2345: ...')).toBe(true)
    expect(compacted.text).toContain('FAIL tests/unit/service.test.ts')
    expect(compacted.text).toContain('src/service.ts:42:10 - error TS2345:')
    expect(compacted.text).toContain('TypeError: Cannot read properties of undefined')
    expect(compacted.text).toContain('    at resolveUser (src/service.ts:42:10)')
    expect(compacted.text).toContain('Process exited with code 1')
  })

  it('applies semantic compaction inside boundToolResult before blind head/tail truncation and tracks stats', () => {
    const middleError = 'ERROR src/core.ts:99:1: critical failure in middle of log'
    const hugeNoisyLog = [
      ...Array.from({ length: 300 }, () => '  verbose heartbeat polling status unchanged...'),
      middleError,
      ...Array.from({ length: 300 }, () => '  verbose heartbeat polling status unchanged...')
    ].join('\n')

    expect(hugeNoisyLog.length).toBeGreaterThan(20_000)
    const saver = vi.fn(() => '/tmp/saved.txt')
    const { result, stats } = boundToolResultWithMeta({ content: [{ type: 'text', text: hugeNoisyLog }] }, 4_000, saver)

    // Compaction shrank 27KB down to < 4KB so blind 60/40 truncation was completely avoided and the middle error survived!
    expect(stats.compacted).toBe(true)
    expect(stats.truncated).toBe(false)
    expect(stats.originalChars).toBe(hugeNoisyLog.length)
    expect(stats.compactedChars).toBeLessThan(4_000)
    expect(stats.charsSaved).toBeGreaterThan(20_000)
    expect(saver).not.toHaveBeenCalled()
    expect(result.content[0].type === 'text' && result.content[0].text).toContain(middleError)

    // Backwards-compatible boundToolResult returns the exact same content shape
    const bounded = boundToolResult({ content: [{ type: 'text', text: hugeNoisyLog }] }, 4_000)
    expect(bounded.content[0].type === 'text' && bounded.content[0].text).toContain(middleError)
  })
})

describe('OXE-486: ToolResultCache LRU, tiered TTLs, mutation invalidation, and session dedup', () => {
  const makeResult = (text: string): InternalMcpToolCallResult => ({ content: [{ type: 'text', text }] })

  it('enforces MAX_CACHE_ENTRIES = 256 LRU eviction preserving recently accessed items', () => {
    expect(MAX_CACHE_ENTRIES).toBe(256)
    const clock = 1_000_000
    const cache = new ToolResultCache({ now: () => clock })
    const policy = getToolCachePolicy('oxespace_list_workspaces', {})!
    const ctx = { sessionKey: 'exec-1', workspaceScope: 'ws-1' }

    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      cache.set('oxespace_list_workspaces', { idx: i }, ctx, policy, makeResult(`ws-${i}`))
    }
    expect(cache.size).toBe(256)

    // Touch idx=0 so it becomes MRU, making idx=1 the LRU victim.
    const touched = cache.lookup('oxespace_list_workspaces', { idx: 0 }, ctx)
    expect(touched.hit).toBe(true)

    // Insert 257th entry -> idx=1 must be evicted, idx=0 must remain.
    cache.set('oxespace_list_workspaces', { idx: 256 }, ctx, policy, makeResult('ws-256'))
    expect(cache.size).toBe(256)
    expect(cache.lookup('oxespace_list_workspaces', { idx: 1 }, ctx).hit).toBe(false)
    expect(cache.lookup('oxespace_list_workspaces', { idx: 0 }, ctx).hit).toBe(true)
    expect(cache.getStats().evictions).toBe(1)
  })

  it('respects tiered TTLs: 30s fast, 120s medium, and 300s slow', () => {
    expect(CACHE_TTL_MS).toEqual({ fast: 30_000, medium: 120_000, slow: 300_000 })
    let clock = 10_000_000
    const cache = new ToolResultCache({ now: () => clock })
    const ctx = { sessionKey: 'exec-1', workspaceScope: 'ws-1' }

    const fastPolicy = getToolCachePolicy('oxespace_git', { action: 'status' })!
    const medPolicy = getToolCachePolicy('oxespace_search', { action: 'files' })!
    const slowPolicy = getToolCachePolicy('oxespace_db_describe', { connection: 'pg-main' })!
    const tablesPolicy = getToolCachePolicy('oxespace_db_tables', { connection: 'pg-main' })!
    const connPolicy = getToolCachePolicy('oxespace_db_connections', {})!

    expect(fastPolicy.ttlMs).toBe(30_000)
    expect(medPolicy.ttlMs).toBe(120_000)
    expect(slowPolicy.ttlMs).toBe(300_000)
    expect(tablesPolicy.ttlMs).toBe(300_000)
    expect(connPolicy.ttlMs).toBe(300_000)

    cache.set('oxespace_git', { action: 'status' }, ctx, fastPolicy, makeResult('clean'))
    cache.set('oxespace_search', { action: 'files' }, ctx, medPolicy, makeResult('a.ts'))
    cache.set('oxespace_db_describe', { connection: 'pg-main' }, ctx, slowPolicy, makeResult('users'))

    // At +29,999ms: all 3 valid
    clock += 29_999
    expect(cache.lookup('oxespace_git', { action: 'status' }, ctx).hit).toBe(true)
    expect(cache.lookup('oxespace_search', { action: 'files' }, ctx).hit).toBe(true)
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-main' }, ctx).hit).toBe(true)

    // At +30,000ms: fast expires, medium & slow remain valid
    clock += 1
    expect(cache.lookup('oxespace_git', { action: 'status' }, ctx).hit).toBe(false)
    expect(cache.lookup('oxespace_search', { action: 'files' }, ctx).hit).toBe(true)
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-main' }, ctx).hit).toBe(true)

    // At +120,000ms: medium expires, slow remains valid
    clock += 90_000
    expect(cache.lookup('oxespace_search', { action: 'files' }, ctx).hit).toBe(false)
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-main' }, ctx).hit).toBe(true)

    // At +300,000ms: slow expires
    clock += 180_000
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-main' }, ctx).hit).toBe(false)
  })

  it('invalidates cached entries immediately on mutating tool calls scoped by workspace and DB connection', () => {
    const cache = new ToolResultCache()
    const ws1 = { sessionKey: 's1', workspaceScope: 'ws-1', cwd: '/repo-a' }
    const ws2 = { sessionKey: 's2', workspaceScope: 'ws-2', cwd: '/repo-b' }

    cache.set('oxespace_git', { action: 'status' }, ws1, getToolCachePolicy('oxespace_git', { action: 'status' })!, makeResult('ws1-git'))
    cache.set('oxespace_git', { action: 'status' }, ws2, getToolCachePolicy('oxespace_git', { action: 'status' })!, makeResult('ws2-git'))
    cache.set('oxespace_db_describe', { connection: 'pg-a' }, ws1, getToolCachePolicy('oxespace_db_describe', { connection: 'pg-a' })!, makeResult('schema-a'))
    cache.set('oxespace_db_describe', { connection: 'pg-b' }, ws1, getToolCachePolicy('oxespace_db_describe', { connection: 'pg-b' })!, makeResult('schema-b'))

    // Mutating git in ws-1 invalidates ws-1 git without touching ws-2 or DB caches
    cache.invalidateForTool('oxespace_git_change', { action: 'commit', message: 'feat' }, { workspaceScope: 'ws-1', cwd: '/repo-a' })
    expect(cache.lookup('oxespace_git', { action: 'status' }, ws1).hit).toBe(false)
    expect(cache.lookup('oxespace_git', { action: 'status' }, ws2).hit).toBe(true)
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-a' }, ws1).hit).toBe(true)

    // Mutating DB connection pg-a invalidates pg-a without touching pg-b
    cache.invalidateForTool('oxespace_db_execute', { connection: 'pg-a', sql: 'ALTER TABLE users ADD COLUMN x int' }, { workspaceScope: 'ws-1' })
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-a' }, ws1).hit).toBe(false)
    expect(cache.lookup('oxespace_db_describe', { connection: 'pg-b' }, ws1).hit).toBe(true)
  })

  it('returns compact dedup notice for large repeat calls within the same session and honors fresh: true', async () => {
    let clock = Date.parse('2026-11-28T03:00:00.000Z')
    const cache = new ToolResultCache({ now: () => clock })
    const largePayload = 'x'.repeat(DEFAULT_DEDUP_MIN_CHARS + 200)
    const sessionA = { sessionKey: 'exec-A', workspaceScope: 'ws-1' }
    const sessionB = { sessionKey: 'exec-B', workspaceScope: 'ws-1' }

    const handler = vi.fn(async () => makeResult(largePayload))

    // 1st call -> cache miss, returns full payload
    const first = await cache.readThrough('oxespace_git', { action: 'diff' }, sessionA, handler)
    expect(first.fromCache).toBe(false)
    expect(first.deduped).toBe(false)
    expect(first.result.content[0].type === 'text' && first.result.content[0].text).toBe(largePayload)
    expect(handler).toHaveBeenCalledTimes(1)

    // 2nd identical call in same session -> cache hit with compact dedup summary
    clock += 1_000
    const second = await cache.readThrough('oxespace_git', { action: 'diff' }, sessionA, handler)
    expect(second.fromCache).toBe(true)
    expect(second.deduped).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    const dedupText = second.result.content[0].type === 'text' ? second.result.content[0].text : ''
    expect(dedupText).toBe(
      `Same output as previous run at 2026-11-28T03:00:00.000Z (${largePayload.length} chars; unchanged). Pass fresh: true to force full output.`
    )

    // Different session gets full payload (never told "same output as previous run" for another session)
    const otherSession = await cache.readThrough('oxespace_git', { action: 'diff' }, sessionB, handler)
    expect(otherSession.fromCache).toBe(false)
    expect(otherSession.deduped).toBe(false)
    expect(handler).toHaveBeenCalledTimes(2)

    // Passing fresh: true bypasses dedup, strips `fresh` before calling handler, and returns full output
    const refreshed = await cache.readThrough('oxespace_git', { action: 'diff', fresh: true }, sessionA, handler)
    expect(refreshed.fromCache).toBe(false)
    expect(refreshed.deduped).toBe(false)
    expect(refreshed.result.content[0].type === 'text' && refreshed.result.content[0].text).toBe(largePayload)
    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler.mock.calls[2][0]).toEqual({ action: 'diff' })
    expect(extractFreshFlag({ action: 'diff', fresh: true })).toEqual({ fresh: true, sanitizedArgs: { action: 'diff' } })
  })

  it('wires ToolResultCache into LocalRpcServer for dedup, fresh bypass, and mutation invalidation', async () => {
    let gitStatusCalls = 0
    const workspaces = [{
      id: 'ws-rpc',
      name: 'RPC Repo',
      rootPath: '/repo',
      isActive: true,
      panes: []
    }]
    const server = createLocalRpcServer({
      workspaceServ: {
        get: (id: string) => workspaces.find(w => w.id === id) ?? null,
        list: () => workspaces
      } as never,
      git: {
        getStatus: async () => {
          gitStatusCalls++
          return {
            branch: 'feat/oxe-486',
            upstream: 'origin/main',
            ahead: 1,
            behind: 0,
            staged: [],
            unstaged: Array.from({ length: 20 }, (_, i) => ({ path: `src/module-${i}/component-${i}.ts`, status: 'modified' })),
            untracked: []
          }
        },
        getBranch: async () => 'feat/oxe-486',
        getDiffSummary: async () => ({ base: 'HEAD', files: [] }),
        buildDiff: async () => ({ base: 'HEAD', files: [] }),
        getFileAtRef: async () => ''
      } as never,
      github: {} as never,
      background: {
        list: () => [],
        getOutput: () => ({ jobId: '', startSequence: 0, lines: [] }),
        start: () => ({ id: 'j1', status: 'running' }),
        stop: () => undefined
      } as never,
      fileSystem: {} as never,
      webPreview: new WebPreviewBus(),
      worktree: new WorktreeEventBus()
    })
    const token = 'b'.repeat(64)
    server.setToken(token)
    const { port } = await server.start(0)

    const callRpc = (name: string, args: Record<string, unknown>) => new Promise<{ result: InternalMcpToolCallResult }>((resolve, reject) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-OXE-Workspace-Id': 'ws-rpc',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { data += chunk })
        res.on('end', () => resolve(JSON.parse(data)))
      })
      req.on('error', reject)
      req.write(payload)
      req.end()
    })

    try {
      const first = await callRpc('oxespace_git', { action: 'status' })
      const firstText = first.result.content[0].type === 'text' ? first.result.content[0].text : ''
      expect(firstText.length).toBeGreaterThanOrEqual(DEFAULT_DEDUP_MIN_CHARS)
      expect(firstText).toContain('module-0')
      expect(gitStatusCalls).toBe(1)

      const second = await callRpc('oxespace_git', { action: 'status' })
      const secondText = second.result.content[0].type === 'text' ? second.result.content[0].text : ''
      expect(secondText).toMatch(/^Same output as previous run at .+ \(\d+ chars; unchanged\)\. Pass fresh: true to force full output\.$/)
      expect(gitStatusCalls).toBe(1)

      const forced = await callRpc('oxespace_git', { action: 'status', fresh: true })
      const forcedText = forced.result.content[0].type === 'text' ? forced.result.content[0].text : ''
      expect(forcedText).toContain('module-0')
      expect(forcedText).not.toContain('Same output as previous run')
      expect(gitStatusCalls).toBe(2)
    } finally {
      await server.stop()
    }
  })
})

describe('OXE-486: incremental job output deltas and idle silence promotion', () => {
  const WS = { id: 'ws-1', rootPath: '/repo', name: 'Repo', isActive: true }

  function makeJobCtx(
    getChunk: () => BackgroundJobOutputChunk,
    getStatus: () => 'running' | 'exited' = () => 'running',
    executionId?: string
  ): ToolContext {
    return {
      workspaceId: WS.id,
      executionId,
      workspaceServ: {
        get: (id: string) => (id === WS.id ? WS : null),
        list: () => [WS]
      },
      github: {},
      background: {
        list: () => [{ id: 'job-1', workspaceId: WS.id, status: getStatus() }],
        getOutput: () => getChunk()
      },
      fileSystem: {},
      webPreview: { emitPreview: vi.fn() },
      worktree: new WorktreeEventBus()
    } as unknown as ToolContext
  }

  it('registers sinceOffset and delta on oxespace_get_job_output schema', () => {
    const entry = TOOL_REGISTRY.find(e => e.descriptor.name === 'oxespace_get_job_output')
    expect(entry?.descriptor.inputSchema.properties).toHaveProperty('sinceOffset')
    expect(entry?.descriptor.inputSchema.properties).toHaveProperty('delta')
  })

  it('supports backwards-compatible full reads and incremental sinceOffset polling', async () => {
    const lines = ['line-1', 'line-2']
    let status: 'running' | 'exited' = 'running'
    const ctx = makeJobCtx(
      () => ({ jobId: 'job-1', startSequence: 0, lines: [...lines] }),
      () => status,
      'exec-offset'
    )

    // Backwards-compatible call without sinceOffset/delta returns full lines + nextOffset + hasMore
    const initial = await handlers.getJobOutput({ jobId: 'job-1' }, ctx)
    const p1 = JSON.parse(initial.content[0].type === 'text' ? initial.content[0].text : '{}')
    expect(p1.lines).toEqual(['line-1', 'line-2'])
    expect(p1.nextOffset).toBe('line-1'.length + 1 + 'line-2'.length + 1)
    expect(p1.hasMore).toBe(true)

    // No new output yet -> empty delta
    const emptyPoll = await handlers.getJobOutput({ jobId: 'job-1', sinceOffset: p1.nextOffset }, ctx)
    const p2 = JSON.parse(emptyPoll.content[0].type === 'text' ? emptyPoll.content[0].text : '{}')
    expect(p2.lines).toEqual([])
    expect(p2.nextOffset).toBe(p1.nextOffset)
    expect(p2.hasMore).toBe(true)
    expect(p2.delta).toBe(true)

    // Append new lines and finish job -> returns ONLY new lines and hasMore: false
    lines.push('line-3', 'build finished')
    status = 'exited'
    const finalPoll = await handlers.getJobOutput({ jobId: 'job-1', sinceOffset: p2.nextOffset }, ctx)
    const p3 = JSON.parse(finalPoll.content[0].type === 'text' ? finalPoll.content[0].text : '{}')
    expect(p3.lines).toEqual(['line-3', 'build finished'])
    expect(p3.startSequence).toBe(2)
    expect(p3.nextOffset).toBeGreaterThan(p2.nextOffset)
    expect(p3.hasMore).toBe(false)
  })

  it('tracks per-caller cursor automatically when delta: true is passed and reports ring-buffer eviction', async () => {
    let chunk: BackgroundJobOutputChunk = {
      jobId: 'job-1',
      startSequence: 0,
      lines: ['booting', 'step-1'],
      startCharOffset: 0,
      totalChars: 'booting'.length + 1 + 'step-1'.length + 1
    }
    const callerA = makeJobCtx(() => chunk, () => 'running', 'exec-A')
    const callerB = makeJobCtx(() => chunk, () => 'running', 'exec-B')

    const a1 = JSON.parse((await handlers.getJobOutput({ jobId: 'job-1', delta: true }, callerA)).content[0].type === 'text'
      ? (await handlers.getJobOutput({ jobId: 'job-1', delta: true }, callerA)).content[0].text
      : '{}')
    // Note: first call already consumed initial lines; second call immediately sees []
    expect(a1.lines).toEqual([])

    // Caller B still has its own independent cursor starting at 0
    const b1Res = await handlers.getJobOutput({ jobId: 'job-1', delta: true }, callerB)
    const b1 = JSON.parse(b1Res.content[0].type === 'text' ? b1Res.content[0].text : '{}')
    expect(b1.lines).toEqual(['booting', 'step-1'])

    // New output arrives -> Caller A receives only the new line
    const added = 'step-2'
    chunk = {
      jobId: 'job-1',
      startSequence: 0,
      lines: ['booting', 'step-1', added],
      startCharOffset: 0,
      totalChars: (chunk.totalChars ?? 0) + added.length + 1
    }
    const a2Res = await handlers.getJobOutput({ jobId: 'job-1', delta: true }, callerA)
    const a2 = JSON.parse(a2Res.content[0].type === 'text' ? a2Res.content[0].text : '{}')
    expect(a2.lines).toEqual(['step-2'])
    expect(a2.nextOffset).toBe(chunk.totalChars)

    // Simulate ring buffer eviction ahead of caller's sinceOffset
    chunk = {
      jobId: 'job-1',
      startSequence: 500,
      lines: ['newest-line'],
      startCharOffset: 10_000,
      totalChars: 10_012
    }
    const evictedRes = await handlers.getJobOutput({ jobId: 'job-1', sinceOffset: 100 }, callerA)
    const evicted = JSON.parse(evictedRes.content[0].type === 'text' ? evictedRes.content[0].text : '{}')
    expect(evicted.lines).toEqual(['newest-line'])
    expect(evicted.truncatedBeforeOffset).toBe(true)
    expect(evicted.nextOffset).toBe(10_012)
  })

  it('rejects invalid sinceOffset and delta arguments', async () => {
    const ctx = makeJobCtx(() => ({ jobId: 'job-1', startSequence: 0, lines: [] }))
    await expect(handlers.getJobOutput({ jobId: 'job-1', sinceOffset: -1 }, ctx)).rejects.toThrow('sinceOffset')
    await expect(handlers.getJobOutput({ jobId: 'job-1', sinceOffset: 1.5 }, ctx)).rejects.toThrow('sinceOffset')
    await expect(handlers.getJobOutput({ jobId: 'job-1', delta: 'yes' }, ctx)).rejects.toThrow('delta')
  })

  it('promotes silent long-running commands to background after configurable idle silence timeout and resets on touch()', async () => {
    expect(DEFAULT_IDLE_SILENCE_TIMEOUT_MS).toBe(300_000)
    vi.useFakeTimers()
    try {
      // 1. Active command that calls touch() before silence timeout finishes in foreground without promoting
      let finishForeground!: (value: string) => void
      const runActive = new Promise<string>(resolve => { finishForeground = resolve })
      const promoteActive = vi.fn(() => 'job-should-not-run')
      const activeCtrl = createIdleSilencePromoter({
        run: runActive,
        promoteToBackground: promoteActive,
        silenceTimeoutMs: 5_000
      })

      await vi.advanceTimersByTimeAsync(4_000)
      activeCtrl.touch()
      await vi.advanceTimersByTimeAsync(4_000)
      expect(promoteActive).not.toHaveBeenCalled()
      finishForeground('completed-ok')
      await expect(activeCtrl.promise).resolves.toEqual({ promoted: false, result: 'completed-ok' })

      // 2. Silent command exceeding threshold transitions cleanly to background returning jobId
      let rejectLater!: (err: Error) => void
      const runSilent = new Promise<string>((_resolve, reject) => { rejectLater = reject })
      const promoteSilent = vi.fn(async () => 'bg-job-486')
      const silentCtrl = createIdleSilencePromoter({
        run: runSilent,
        promoteToBackground: promoteSilent,
        silenceTimeoutMs: 10_000
      })

      await vi.advanceTimersByTimeAsync(10_000)
      const outcome = await silentCtrl.promise
      expect(promoteSilent).toHaveBeenCalledOnce()
      expect(outcome).toEqual({
        promoted: true,
        jobId: 'bg-job-486',
        reason: 'idle_silence_timeout',
        silenceTimeoutMs: 10_000
      })

      // Later rejection of detached foreground promise must not cause an unhandled rejection
      rejectLater(new Error('detached process ended'))
      await Promise.resolve()
    } finally {
      vi.useRealTimers()
    }
  })
})
