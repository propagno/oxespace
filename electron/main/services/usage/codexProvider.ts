import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Codex (OpenAI) persists sessions to `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl`.
 * Each JSONL has `session_meta` (with `cwd`) and `event_msg` records carrying `token_count`
 * payloads with both `total_token_usage` (cumulative) and `last_token_usage` (per turn),
 * plus `model_context_window` for the real limit.
 *
 * Format example:
 *   {"type":"event_msg","payload":{"type":"token_count","info":{
 *     "total_token_usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N,...},
 *     "last_token_usage":{...},
 *     "model_context_window":258400
 *   }}}
 */

interface CodexTokenUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  total_tokens?: number
}

interface CodexRecord {
  type?: string
  timestamp?: string
  payload?: {
    type?: string
    cwd?: string
    id?: string
    model?: string
    info?: {
      total_token_usage?: CodexTokenUsage
      last_token_usage?: CodexTokenUsage
      model_context_window?: number
    }
  }
}

// GPT-5 family pricing (USD per million tokens). Best-effort defaults; configurable in future.
const PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-5': { input: 5, output: 15, cachedInput: 0.5 },
  'gpt-5-mini': { input: 0.5, output: 2, cachedInput: 0.05 }
}

const DEFAULT_CONTEXT_LIMIT = 256_000

export class CodexUsageProvider implements UsageProvider {
  readonly provider = 'codex' as const

  constructor(private readonly sessionsRoot: string = join(homedir(), '.codex', 'sessions')) {}

  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const files = this.findSessionFilesFor(workspaceRootPath)
    if (files.length === 0) return EMPTY_CONTEXT_USAGE

    const target = sessionId
      ? files.find((f) => f.sessionId === sessionId) ?? files[0]
      : files[0]
    return parseSession(target.fullPath, target.sessionId, target.mtimeMs, target.birthtimeMs)
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    return this.findSessionFilesFor(workspaceRootPath).map((f) => {
      const snap = parseSession(f.fullPath, f.sessionId, f.mtimeMs, f.birthtimeMs)
      return {
        sessionId: snap.sessionId ?? f.sessionId,
        lastUpdatedMs: snap.lastUpdatedMs ?? f.mtimeMs,
        sessionStartedAtMs: snap.sessionStartedAtMs ?? f.birthtimeMs,
        modelId: snap.modelId,
        requestCount: snap.requestCount
      }
    })
  }

  /**
   * Scan recent days for JSONL files whose `session_meta.cwd` matches `workspaceRootPath`.
   * Codex stores sessions by date, so we walk the last ~14 days for performance.
   */
  private findSessionFilesFor(workspaceRootPath: string): SessionFileInfo[] {
    if (!existsSync(this.sessionsRoot)) return []
    const normalizedTarget = normalizePath(workspaceRootPath)
    const results: SessionFileInfo[] = []
    const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000

    for (const year of safeReaddir(this.sessionsRoot)) {
      const yearDir = join(this.sessionsRoot, year)
      for (const month of safeReaddir(yearDir)) {
        const monthDir = join(yearDir, month)
        for (const day of safeReaddir(monthDir)) {
          const dayDir = join(monthDir, day)
          for (const file of safeReaddir(dayDir)) {
            if (!file.endsWith('.jsonl')) continue
            const fullPath = join(dayDir, file)
            try {
              const stat = statSync(fullPath)
              if (stat.mtimeMs < cutoffMs) continue
              const sessionCwd = readSessionCwd(fullPath)
              if (!sessionCwd || normalizePath(sessionCwd) !== normalizedTarget) continue
              results.push({
                fullPath,
                sessionId: extractSessionId(file),
                mtimeMs: stat.mtimeMs,
                birthtimeMs: stat.birthtimeMs || stat.ctimeMs
              })
            } catch {
              // unreadable; skip
            }
          }
        }
      }
    }

    results.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return results
  }
}

interface SessionFileInfo {
  fullPath: string
  sessionId: string
  mtimeMs: number
  birthtimeMs: number
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function normalizePath(p: string): string {
  return p.replace(/[/\\]+/g, sep).replace(/\\$/, '').toLowerCase()
}

function extractSessionId(filename: string): string {
  // rollout-2026-02-14T00-48-11-019c5a43-627a-7e52-a42a-8245975bfa19.jsonl
  // Take the UUID portion at the end.
  const match = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
  return match ? match[1] : filename.replace(/\.jsonl$/, '')
}

/** Read only the first line (session_meta) to get cwd without loading the whole file. */
function readSessionCwd(filePath: string): string | null {
  try {
    // Read first ~4KB to find the first newline
    const buf = Buffer.alloc(4096)
    const fd = require('node:fs').openSync(filePath, 'r')
    try {
      const bytesRead = require('node:fs').readSync(fd, buf, 0, 4096, 0)
      const head = buf.subarray(0, bytesRead).toString('utf8')
      const newline = head.indexOf('\n')
      const firstLine = newline >= 0 ? head.slice(0, newline) : head
      const record = JSON.parse(firstLine) as CodexRecord
      return record.payload?.cwd ?? null
    } finally {
      require('node:fs').closeSync(fd)
    }
  } catch {
    return null
  }
}

function parseSession(filePath: string, sessionId: string, mtimeMs: number, birthtimeMs: number): ContextUsageSnapshot {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)

  let modelId: string | null = null
  let contextWindow: number | null = null
  let total: CodexTokenUsage = {}
  let last: CodexTokenUsage = {}
  let requestCount = 0

  for (const line of lines) {
    let record: CodexRecord
    try { record = JSON.parse(line) as CodexRecord } catch { continue }

    if (record.type === 'session_meta' && record.payload?.model) {
      modelId = record.payload.model
    }
    if (record.payload?.type === 'token_count') {
      const info = record.payload.info
      if (!info) continue
      if (info.model_context_window) contextWindow = info.model_context_window
      if (info.total_token_usage) total = info.total_token_usage
      if (info.last_token_usage) last = info.last_token_usage
      requestCount += 1
    }
  }

  if (requestCount === 0) return EMPTY_CONTEXT_USAGE

  const totalInput = total.input_tokens ?? 0
  const totalCached = total.cached_input_tokens ?? 0
  const totalOutput = (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0)

  const lastInput = last.input_tokens ?? 0
  const lastCached = last.cached_input_tokens ?? 0
  const lastOutput = (last.output_tokens ?? 0) + (last.reasoning_output_tokens ?? 0)

  return {
    available: true,
    sessionId,
    modelId,
    // Map Codex's cached_input_tokens to our cacheRead bucket (semantic equivalent)
    inputTokens: totalInput,
    cacheCreationTokens: 0,
    cacheReadTokens: totalCached,
    outputTokens: totalOutput,
    lastTurnInputTokens: lastInput,
    lastTurnCacheCreationTokens: 0,
    lastTurnCacheReadTokens: lastCached,
    lastTurnOutputTokens: lastOutput,
    requestCount,
    estimatedCostUsd: computeCost(modelId, totalInput, totalCached, totalOutput),
    contextLimit: contextWindow ?? DEFAULT_CONTEXT_LIMIT,
    lastUpdatedMs: mtimeMs,
    sessionStartedAtMs: birthtimeMs
  }
}

function computeCost(modelId: string | null, input: number, cachedInput: number, output: number): number {
  const lookup = modelId ? PRICING[modelId] : undefined
  const price = lookup ?? PRICING['gpt-5']
  const cost =
    (input / 1_000_000) * price.input +
    (cachedInput / 1_000_000) * (price.cachedInput ?? price.input * 0.1) +
    (output / 1_000_000) * price.output
  return Math.round(cost * 10000) / 10000
}
