import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
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
    timestamp?: string
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
const MAX_META_LINE_BYTES = 256 * 1024
const MAX_DISCOVERY_HEAD_BYTES = 512 * 1024
const MAX_USAGE_TAIL_BYTES = 4 * 1024 * 1024

export class CodexUsageProvider implements UsageProvider {
  readonly provider = 'codex' as const

  constructor(private readonly sessionsRoot: string = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')) {}

  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const files = this.findSessionFilesFor(workspaceRootPath, Boolean(sessionId))
    if (files.length === 0) return EMPTY_CONTEXT_USAGE

    const target = sessionId
      ? files.find((f) => f.sessionId === sessionId) ?? files[0]
      : files[0]
    return parseSession(target.fullPath, target.sessionId, target.mtimeMs, target.birthtimeMs)
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    const indexed = readCodexSessionIndex(dirname(this.sessionsRoot), workspaceRootPath)
    if (indexed !== null) return indexed
    const summaries = readSessionSummaries(dirname(this.sessionsRoot))
    return this.findSessionFilesFor(workspaceRootPath, true).map((f) => {
      const details = readSessionDetails(f.fullPath)
      const snap: ContextUsageSnapshot = {
        ...EMPTY_CONTEXT_USAGE,
        sessionId: f.sessionId,
        modelId: details.modelId,
        requestCount: details.requestCount,
        lastUpdatedMs: f.mtimeMs,
        sessionStartedAtMs: f.birthtimeMs
      }
      return {
        sessionId: f.sessionId,
        lastUpdatedMs: f.mtimeMs,
        sessionStartedAtMs: f.birthtimeMs,
        modelId: details.modelId,
        requestCount: details.requestCount,
        summary: summaries.get(f.sessionId) ?? null,
        snapshot: snap
      }
    })
  }

  /**
   * Scan JSONL files whose `session_meta.cwd` matches `workspaceRootPath`.
   * Live usage reads recent files; the resume chooser searches the full history.
   */
  private findSessionFilesFor(workspaceRootPath: string, includeHistory = false): SessionFileInfo[] {
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
              if (!includeHistory && stat.mtimeMs < cutoffMs) continue
              const meta = readSessionMeta(fullPath)
              if (!meta?.cwd || normalizePath(meta.cwd) !== normalizedTarget) continue
              results.push({
                fullPath,
                sessionId: meta.id && SESSION_ID_PATTERN.test(meta.id) ? meta.id : extractSessionId(file),
                mtimeMs: stat.mtimeMs,
                birthtimeMs: meta.startedAtMs ?? (stat.birthtimeMs || stat.ctimeMs)
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

interface CodexIndexRow {
  id: string
  cwd: string
  title: string
  firstMessage: string
  preview: string
  name: string
  model: string | null
  createdAt: number
  createdAtMs: number
  updatedAt: number
  updatedAtMs: number
}

/**
 * Modern Codex builds keep the exact `/resume` picker catalog in a SQLite index.
 * Prefer it over rollout discovery: it includes sessions whose active JSONL file is
 * temporarily locked and already applies Codex's archived/empty-session semantics.
 * Schema probing keeps older Codex installations on the JSONL fallback.
 */
function readCodexSessionIndex(codexHome: string, workspaceRootPath: string): SessionMetadata[] | null {
  const statePath = findCodexStateDatabase(codexHome)
  if (!statePath) return null
  let database: Database.Database | undefined
  try {
    database = new Database(statePath, { readonly: true, fileMustExist: true })
    const columns = new Set((database.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map(row => row.name))
    if (!columns.has('id') || !columns.has('cwd')) return null
    const value = (name: string, fallback: string) => columns.has(name) ? name : fallback
    const rows = database.prepare(`SELECT id, cwd,
      ${value('title', "''")} AS title,
      ${value('first_user_message', "''")} AS firstMessage,
      ${value('preview', "''")} AS preview,
      ${value('name', "''")} AS name,
      ${value('model', 'NULL')} AS model,
      ${value('created_at', '0')} AS createdAt,
      ${value('created_at_ms', '0')} AS createdAtMs,
      ${value('updated_at', '0')} AS updatedAt,
      ${value('updated_at_ms', '0')} AS updatedAtMs
      FROM threads ${columns.has('archived') ? 'WHERE archived = 0' : ''}
      ORDER BY ${value('updated_at_ms', value('updated_at', 'rowid'))} DESC`).all() as CodexIndexRow[]
    const target = normalizePath(workspaceRootPath)
    return rows.flatMap(row => {
      if (!SESSION_ID_PATTERN.test(row.id) || normalizePath(row.cwd) !== target) return []
      const summary = [row.name, row.title, row.firstMessage, row.preview].find(text => typeof text === 'string' && text.trim())
      if (!summary) return []
      const startedAt = row.createdAtMs || row.createdAt * 1000
      const updatedAt = row.updatedAtMs || row.updatedAt * 1000 || startedAt
      const snapshot: ContextUsageSnapshot = { ...EMPTY_CONTEXT_USAGE, sessionId: row.id, modelId: row.model || null,
        lastUpdatedMs: updatedAt, sessionStartedAtMs: startedAt }
      return [{ sessionId: row.id, lastUpdatedMs: updatedAt, sessionStartedAtMs: startedAt,
        modelId: row.model || null, requestCount: 0, summary: compactSummary(summary), snapshot,
        workspaceRootPath: row.cwd }]
    })
  } catch {
    return null
  } finally { database?.close() }
}

function findCodexStateDatabase(codexHome: string): string | null {
  const candidates = safeReaddir(codexHome).filter(name => /^state(?:_\d+)?\.sqlite$/i.test(name)).sort((a, b) => {
    const version = (name: string) => Number(name.match(/_(\d+)\.sqlite$/i)?.[1] ?? 0)
    return version(b) - version(a)
  })
  return candidates.length ? join(codexHome, candidates[0]) : null
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
  const normalized = resolve(p.replace(/^\\\\\?\\/, '')).replace(/[/\\]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function extractSessionId(filename: string): string {
  // rollout-2026-02-14T00-48-11-019c5a43-627a-7e52-a42a-8245975bfa19.jsonl
  // Take the UUID portion at the end.
  const match = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)
  return match ? match[1] : filename.replace(/\.jsonl$/, '')
}

/** Read the complete session_meta line. Current Codex builds can exceed 20 KB. */
function readSessionMeta(filePath: string): { cwd: string | null; id: string | null; startedAtMs: number | null } | null {
  try {
    const firstLine = readHead(filePath, MAX_META_LINE_BYTES).split('\n', 1)[0]
    const record = JSON.parse(firstLine) as CodexRecord
    if (record.type !== 'session_meta') return null
    const timestamp = record.payload?.timestamp ?? record.timestamp
    const startedAt = timestamp ? Date.parse(timestamp) : NaN
    return { cwd: record.payload?.cwd ?? null, id: record.payload?.id ?? null, startedAtMs: Number.isFinite(startedAt) ? startedAt : null }
  } catch {
    return null
  }
}

function readHead(filePath: string, limit: number): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(limit)
    const bytesRead = readSync(fd, buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { closeSync(fd) }
}

function readTail(filePath: string, limit: number): string {
  const size = statSync(filePath).size
  const start = Math.max(0, size - limit)
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(Math.min(limit, size))
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start)
    let text = buffer.subarray(0, bytesRead).toString('utf8')
    if (start > 0) {
      const newline = text.indexOf('\n')
      text = newline < 0 ? '' : text.slice(newline + 1)
    }
    return text
  } finally { closeSync(fd) }
}

function readSessionDetails(filePath: string): { modelId: string | null; requestCount: number } {
  let modelId: string | null = null
  let requestCount = 0
  try {
    const head = readHead(filePath, MAX_DISCOVERY_HEAD_BYTES)
    const complete = statSync(filePath).size <= MAX_DISCOVERY_HEAD_BYTES ? head : head.slice(0, Math.max(0, head.lastIndexOf('\n')))
    for (const line of complete.split('\n')) {
      let record: CodexRecord
      try { record = JSON.parse(line) as CodexRecord } catch { continue }
      if (record.payload?.model) modelId = record.payload.model
      if (record.type === 'turn_context') requestCount += 1
    }
  } catch { /* unreadable sessions remain resumable by ID */ }
  return { modelId, requestCount }
}

function readSessionSummaries(codexHome: string): Map<string, string> {
  const summaries = new Map<string, string>()
  try {
    const history = readFileSync(join(codexHome, 'history.jsonl'), 'utf8')
    for (const line of history.split('\n')) {
      try {
        const value = JSON.parse(line) as { session_id?: unknown; text?: unknown }
        if (typeof value.session_id === 'string' && typeof value.text === 'string' && value.text.trim() && !summaries.has(value.session_id)) {
          summaries.set(value.session_id, compactSummary(value.text))
        }
      } catch { /* skip a partially written line */ }
    }
  } catch { /* history is optional */ }
  try {
    const index = readFileSync(join(codexHome, 'session_index.jsonl'), 'utf8')
    for (const line of index.split('\n')) {
      try {
        const value = JSON.parse(line) as { id?: unknown; thread_name?: unknown }
        if (typeof value.id === 'string' && typeof value.thread_name === 'string' && value.thread_name.trim()) summaries.set(value.id, compactSummary(value.thread_name))
      } catch { /* skip a partially written line */ }
    }
  } catch { /* custom titles are optional */ }
  return summaries
}

function compactSummary(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

function parseSession(filePath: string, sessionId: string, mtimeMs: number, birthtimeMs: number): ContextUsageSnapshot {
  const raw = readTail(filePath, MAX_USAGE_TAIL_BYTES)
  const lines = raw.split('\n').filter((line) => line.length > 0)

  let modelId: string | null = null
  let contextWindow: number | null = null
  let total: CodexTokenUsage = {}
  let last: CodexTokenUsage = {}
  let requestCount = 0

  for (const line of lines) {
    let record: CodexRecord
    try { record = JSON.parse(line) as CodexRecord } catch { continue }

    if ((record.type === 'session_meta' || record.type === 'turn_context') && record.payload?.model) {
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
