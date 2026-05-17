import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Claude Code persists each conversation to `~/.claude/projects/<encoded_path>/<sessionId>.jsonl`.
 * Path encoding: `C:\Users\dudu-\Estudos\oxespace` → `C--Users-dudu--Estudos-oxespace`
 * (colon, backslash, and forward-slash all become single dashes).
 *
 * Each line is one record. We're interested in records carrying `message.usage` token blocks
 * and a `message.model` field.
 */

interface ClaudeUsageBlock {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

interface ClaudeMessageRecord {
  message?: {
    model?: string
    usage?: ClaudeUsageBlock
  }
}

const PRICING: Record<string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 }
}

const CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-haiku-4': 200_000
}

const DEFAULT_CONTEXT_LIMIT = 1_000_000

export class ClaudeUsageProvider implements UsageProvider {
  readonly provider = 'claude' as const

  constructor(private readonly projectsRoot: string = join(homedir(), '.claude', 'projects')) {}

  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const projectDir = join(this.projectsRoot, encodePath(workspaceRootPath))
    if (!existsSync(projectDir)) return EMPTY_CONTEXT_USAGE

    const sessions = listSessionFiles(projectDir)
    const target = sessionId
      ? sessions.find((s) => s.sessionId === sessionId) ?? sessions[0]
      : sessions[0]
    if (!target) return EMPTY_CONTEXT_USAGE

    return parseSession(target.fullPath, target.sessionId, target.mtimeMs, target.birthtimeMs)
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    const projectDir = join(this.projectsRoot, encodePath(workspaceRootPath))
    if (!existsSync(projectDir)) return []

    return listSessionFiles(projectDir).map((f) => {
      // Lightweight scan: just the last line for model + count
      const snapshot = parseSession(f.fullPath, f.sessionId, f.mtimeMs, f.birthtimeMs)
      return {
        sessionId: snapshot.sessionId ?? f.sessionId,
        lastUpdatedMs: snapshot.lastUpdatedMs ?? f.mtimeMs,
        sessionStartedAtMs: snapshot.sessionStartedAtMs ?? f.birthtimeMs,
        modelId: snapshot.modelId,
        requestCount: snapshot.requestCount
      }
    })
  }
}

function encodePath(rootPath: string): string {
  return rootPath.replace(/[:\\/]/g, '-')
}

interface SessionFileInfo {
  fullPath: string
  sessionId: string
  mtimeMs: number
  birthtimeMs: number
}

function listSessionFiles(projectDir: string): SessionFileInfo[] {
  const files: SessionFileInfo[] = []
  for (const name of readdirSync(projectDir)) {
    if (!name.endsWith('.jsonl')) continue
    const fullPath = join(projectDir, name)
    try {
      const stat = statSync(fullPath)
      files.push({
        fullPath,
        sessionId: name.replace(/\.jsonl$/, ''),
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs || stat.ctimeMs
      })
    } catch {
      // skip unreadable
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files
}

function parseSession(filePath: string, sessionId: string, mtimeMs: number, birthtimeMs: number): ContextUsageSnapshot {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)

  let inputTokens = 0
  let cacheCreationTokens = 0
  let cacheReadTokens = 0
  let outputTokens = 0
  let requestCount = 0
  let modelId: string | null = null

  let lastTurnInputTokens = 0
  let lastTurnCacheCreationTokens = 0
  let lastTurnCacheReadTokens = 0
  let lastTurnOutputTokens = 0

  for (const line of lines) {
    let record: ClaudeMessageRecord
    try {
      record = JSON.parse(line) as ClaudeMessageRecord
    } catch {
      continue
    }
    const usage = record.message?.usage
    if (!usage) continue

    const entryInput = usage.input_tokens ?? 0
    const entryCacheCreate = usage.cache_creation_input_tokens ?? 0
    const entryCacheRead = usage.cache_read_input_tokens ?? 0
    const entryOutput = usage.output_tokens ?? 0

    inputTokens += entryInput
    cacheCreationTokens += entryCacheCreate
    cacheReadTokens += entryCacheRead
    outputTokens += entryOutput
    requestCount += 1
    if (record.message?.model) modelId = record.message.model

    lastTurnInputTokens = entryInput
    lastTurnCacheCreationTokens = entryCacheCreate
    lastTurnCacheReadTokens = entryCacheRead
    lastTurnOutputTokens = entryOutput
  }

  return {
    available: requestCount > 0,
    sessionId,
    modelId,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    lastTurnInputTokens,
    lastTurnCacheCreationTokens,
    lastTurnCacheReadTokens,
    lastTurnOutputTokens,
    requestCount,
    estimatedCostUsd: computeCost(modelId, inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens),
    contextLimit: resolveContextLimit(modelId),
    lastUpdatedMs: mtimeMs,
    sessionStartedAtMs: birthtimeMs
  }
}

function resolveContextLimit(modelId: string | null): number {
  if (!modelId) return DEFAULT_CONTEXT_LIMIT
  const exact = CONTEXT_LIMITS[modelId]
  if (exact) return exact
  if (/haiku/i.test(modelId)) return 200_000
  if (/opus|sonnet/i.test(modelId)) return 1_000_000
  return DEFAULT_CONTEXT_LIMIT
}

function computeCost(modelId: string | null, input: number, cacheWrite: number, cacheRead: number, output: number): number {
  const lookup = modelId ? PRICING[modelId] : undefined
  const price = lookup ?? PRICING['claude-opus-4-7']
  const cost =
    (input / 1_000_000) * price.input +
    (cacheWrite / 1_000_000) * (price.cacheWrite ?? price.input * 1.25) +
    (cacheRead / 1_000_000) * (price.cacheRead ?? price.input * 0.1) +
    (output / 1_000_000) * price.output
  return Math.round(cost * 10000) / 10000
}
