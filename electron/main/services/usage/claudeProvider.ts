import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'
import { defaultClaudeProjectsRoot, encodeClaudeProjectPath } from './claude-project-path'

/**
 * Claude Code persists each conversation to `~/.claude/projects/<encoded_path>/<sessionId>.jsonl`.
 * Path encoding: `C:\Users\dudu-\Estudos\oxespace` → `C--Users-dudu--Estudos-oxespace`.
 * Claude replaces every non-ASCII-alphanumeric character with a dash, including
 * separators, dots and `@` in Linux account paths.
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

  constructor(private readonly projectsRoot: string = defaultClaudeProjectsRoot()) {}

  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const projectDir = join(this.projectsRoot, encodeClaudeProjectPath(workspaceRootPath))
    if (!existsSync(projectDir)) return EMPTY_CONTEXT_USAGE

    const sessions = listSessionFiles(projectDir)
    const target = sessionId
      ? sessions.find((s) => s.sessionId === sessionId) ?? sessions[0]
      : sessions[0]
    if (!target) return EMPTY_CONTEXT_USAGE

    return parseSession(target.fullPath, target.sessionId, target.mtimeMs, target.birthtimeMs)
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    const projectDir = join(this.projectsRoot, encodeClaudeProjectPath(workspaceRootPath))
    if (!existsSync(projectDir)) return []

    return listSessionFiles(projectDir).map((f) => {
      // Each transcript is read once, then only what was appended (readTranscript).
      const snapshot = parseSession(f.fullPath, f.sessionId, f.mtimeMs, f.birthtimeMs)
      return {
        sessionId: snapshot.sessionId ?? f.sessionId,
        lastUpdatedMs: snapshot.lastUpdatedMs ?? f.mtimeMs,
        sessionStartedAtMs: snapshot.sessionStartedAtMs ?? f.birthtimeMs,
        modelId: snapshot.modelId,
        requestCount: snapshot.requestCount,
        snapshot
      }
    })
  }
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

/** What one transcript adds up to so far. */
interface Tally {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  requestCount: number
  modelId: string | null
  lastTurnInputTokens: number
  lastTurnCacheCreationTokens: number
  lastTurnCacheReadTokens: number
  lastTurnOutputTokens: number
}

/** A transcript read up to `size` bytes; `carry` holds the bytes of a last line not ended yet. */
interface TranscriptRead { size: number; carry: Buffer; tally: Tally }

const emptyTally = (): Tally => ({
  inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requestCount: 0, modelId: null,
  lastTurnInputTokens: 0, lastTurnCacheCreationTokens: 0, lastTurnCacheReadTokens: 0, lastTurnOutputTokens: 0
})

/**
 * Transcripts only grow at the end, so each one is read once and then only what was appended since (1.5.2). Reading
 * them whole on every context refresh and every /resume froze the main process: one session here is 214 MB, the
 * project's 37 sessions 1.9 GB. A file that got shorter (rewritten) is read again from the start.
 */
const transcripts = new Map<string, TranscriptRead>()
const TRANSCRIPT_CACHE_MAX = 256
const READ_CHUNK = 4 * 1024 * 1024
const NEWLINE = 0x0a

function foldLine(tally: Tally, line: string): void {
  // Most bytes are tool output; only a line that mentions usage can carry a token block, so the rest is not parsed.
  if (!line.includes('"usage"')) return
  let record: ClaudeMessageRecord
  try {
    record = JSON.parse(line) as ClaudeMessageRecord
  } catch {
    return
  }
  const usage = record.message?.usage
  if (!usage) return
  const entryInput = usage.input_tokens ?? 0
  const entryCacheCreate = usage.cache_creation_input_tokens ?? 0
  const entryCacheRead = usage.cache_read_input_tokens ?? 0
  const entryOutput = usage.output_tokens ?? 0
  tally.inputTokens += entryInput
  tally.cacheCreationTokens += entryCacheCreate
  tally.cacheReadTokens += entryCacheRead
  tally.outputTokens += entryOutput
  tally.requestCount += 1
  if (record.message?.model) tally.modelId = record.message.model
  tally.lastTurnInputTokens = entryInput
  tally.lastTurnCacheCreationTokens = entryCacheCreate
  tally.lastTurnCacheReadTokens = entryCacheRead
  tally.lastTurnOutputTokens = entryOutput
}

/** Reads the bytes appended since the last call, in chunks, and folds every complete line into the tally. */
export function readTranscript(filePath: string): Tally {
  const size = statSync(filePath).size
  let read = transcripts.get(filePath)
  if (!read || size < read.size) read = { size: 0, carry: Buffer.alloc(0), tally: emptyTally() }
  if (size > read.size) {
    const fd = openSync(filePath, 'r')
    try {
      const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK, size - read.size))
      let position = read.size
      let carry = read.carry
      while (position < size) {
        const count = readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position)
        if (count <= 0) break
        position += count
        // A newline byte never sits inside a multi-byte character, so splitting on it keeps every line whole.
        const bytes = carry.length ? Buffer.concat([carry, chunk.subarray(0, count)]) : chunk.subarray(0, count)
        const lastNewline = bytes.lastIndexOf(NEWLINE)
        if (lastNewline < 0) { carry = Buffer.from(bytes); continue }
        for (const line of bytes.toString('utf8', 0, lastNewline).split('\n')) if (line) foldLine(read.tally, line)
        carry = Buffer.from(bytes.subarray(lastNewline + 1))
      }
      read = { size: position, carry, tally: read.tally }
    } finally {
      closeSync(fd)
    }
  }
  transcripts.delete(filePath)
  transcripts.set(filePath, read)
  if (transcripts.size > TRANSCRIPT_CACHE_MAX) transcripts.delete(transcripts.keys().next().value as string)
  // An unterminated last line is still counted when it parses: the writer may not have added its newline yet.
  if (read.carry.length) {
    const tally = { ...read.tally }
    foldLine(tally, read.carry.toString('utf8'))
    return tally
  }
  return read.tally
}

/** Forgets what was read (tests). */
export function forgetTranscripts(): void {
  transcripts.clear()
}

function parseSession(filePath: string, sessionId: string, mtimeMs: number, birthtimeMs: number): ContextUsageSnapshot {
  const tally = readTranscript(filePath)
  return {
    available: tally.requestCount > 0,
    sessionId,
    modelId: tally.modelId,
    inputTokens: tally.inputTokens,
    cacheCreationTokens: tally.cacheCreationTokens,
    cacheReadTokens: tally.cacheReadTokens,
    outputTokens: tally.outputTokens,
    lastTurnInputTokens: tally.lastTurnInputTokens,
    lastTurnCacheCreationTokens: tally.lastTurnCacheCreationTokens,
    lastTurnCacheReadTokens: tally.lastTurnCacheReadTokens,
    lastTurnOutputTokens: tally.lastTurnOutputTokens,
    requestCount: tally.requestCount,
    estimatedCostUsd: computeCost(tally.modelId, tally.inputTokens, tally.cacheCreationTokens, tally.cacheReadTokens, tally.outputTokens),
    contextLimit: resolveContextLimit(tally.modelId),
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
