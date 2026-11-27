import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { formatNativeUserText, taskNotification } from '../../../../shared/native-session-text'
import type { ThreadEvent } from '../../../../shared/types/thread'
import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import { safeJoin } from '../../utils/safe-join'
import { readNativeHistoryPage, type NativeHistoryCursor } from '../conversation/native-history-page'
import type { SessionMetadata } from './types'

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_HISTORY_BYTES = 2 * 1024 * 1024
const MAX_METADATA_BYTES = 64 * 1024
const MAX_TRANSCRIPT_HEAD_BYTES = 64 * 1024
const MAX_TRANSCRIPT_TAIL_BYTES = 64 * 1024
const MAX_PREVIEW_CHARS = 120
const MAX_TITLE_CHARS = 80
const MAX_PUBLIC_MESSAGE_CHARS = 256 * 1024
const MAX_HISTORY_EVENTS = 1000

interface SummaryEntry {
  title: string
  preview: string
  stepCount: number
  lastModifiedMs: number | null
  workspacePaths: string[]
  isSubagent: boolean
}

interface HistoryEntry {
  workspacePaths: string[]
  firstDisplay: string | null
  firstTimestampMs: number | null
  lastTimestampMs: number | null
}

interface LocalMetadata {
  workspacePaths: string[]
  title: string | null
  preview: string | null
  modelId: string | null
  startedAtMs: number | null
  updatedAtMs: number | null
}

interface TranscriptBounds {
  workspacePaths: string[]
  startedAtMs: number | null
  lastAtMs: number | null
  modelId: string | null
  requestCount: number
  firstUserPreview: string | null
  mtimeMs: number
  birthtimeMs: number
}

export interface AntigravitySessionHistory {
  events: ThreadEvent[]
  title?: string
  truncated?: boolean
  cursor?: NativeHistoryCursor
}

export function defaultAntigravityHome(): string {
  const configured = process.env.ANTIGRAVITY_HOME?.trim()
  return configured || join(homedir(), '.gemini', 'antigravity-cli')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function uriOrPathToFsPath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed)
    } catch {
      try {
        let stripped = decodeURIComponent(trimmed.replace(/^file:\/\//i, ''))
        if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(stripped)) stripped = stripped.slice(1)
        return stripped || null
      } catch {
        return null
      }
    }
  }
  return trimmed
}

export function parseWorkspaceUris(raw: unknown): string[] {
  const collected: string[] = []
  const pushItem = (item: unknown): void => {
    if (typeof item !== 'string') return
    const converted = uriOrPathToFsPath(item)
    if (converted) collected.push(converted)
  }
  if (Array.isArray(raw)) {
    for (const item of raw) pushItem(item)
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
          for (const item of parsed) pushItem(item)
          return [...new Set(collected)]
        }
      } catch { /* fall through to single string */ }
    }
    pushItem(trimmed)
  }
  return [...new Set(collected)]
}

function normalizeRoot(input: string): string {
  const fsPath = uriOrPathToFsPath(input) ?? input
  const resolved = resolve(fsPath.replace(/^\\\\\?\\/, ''))
  const stripped = resolved.replace(/[\\/]+$/, '')
  const canonical = stripped || resolved
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

export function sameAntigravityRoot(a: string, b: string): boolean {
  return normalizeRoot(a) === normalizeRoot(b)
}

export function parseAntigravityTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('0001-')) return null
  const normalized = trimmed.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/,
    (_match, date: string, time: string, frac?: string, tz?: string) => {
      const ms = frac ? `.${frac.slice(0, 3).padEnd(3, '0')}` : ''
      const offset = tz?.trim() || 'Z'
      return `${date}T${time}${ms}${offset}`
    }
  )
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function stripUserWrapper(text: string): string {
  return text.replace(/<\/?USER_REQUEST>/gi, '')
}

function compactText(value: string | null | undefined, maxChars: number): string | null {
  if (!value) return null
  const cleaned = formatNativeUserText(stripUserWrapper(value)).replace(/\s+/g, ' ').trim()
  if (!cleaned || taskNotification(cleaned)) return null
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned
}

type SqliteConstructor = typeof Database
let sqliteCtor: SqliteConstructor | null | undefined

/** Load better-sqlite3 lazily so standalone worker bundles (native-history-worker) never fail at module load. */
function loadSqlite(): SqliteConstructor | null {
  if (sqliteCtor !== undefined) return sqliteCtor
  try {
    const req = createRequire(import.meta.url)
    const mod = req('better-sqlite3') as SqliteConstructor | { default?: SqliteConstructor }
    sqliteCtor = typeof mod === 'function' ? mod : mod?.default ?? null
  } catch {
    sqliteCtor = null
  }
  return sqliteCtor
}

function readSummariesIndex(antigravityHome: string): Map<string, SummaryEntry> {
  const result = new Map<string, SummaryEntry>()
  const dbPath = join(antigravityHome, 'conversation_summaries.db')
  if (!existsSync(dbPath)) return result
  const Sqlite = loadSqlite()
  if (!Sqlite) return result
  let db: Database.Database | undefined
  try {
    db = new Sqlite(dbPath, { readonly: true, fileMustExist: true })
    const cols = new Set((db.prepare('PRAGMA table_info(conversation_summaries)').all() as Array<{ name: string }>).map(row => row.name))
    if (!cols.has('conversation_id')) return result
    const col = (name: string, fallback: string) => cols.has(name) ? name : fallback
    const rows = db.prepare(`SELECT
      conversation_id AS id,
      ${col('title', "''")} AS title,
      ${col('preview', "''")} AS preview,
      ${col('step_count', '0')} AS stepCount,
      ${col('last_modified_time', "''")} AS lastModifiedTime,
      ${col('workspace_uris', "''")} AS workspaceUris,
      ${col('parent_conversation_id', "''")} AS parentId,
      ${col('nesting_depth', '0')} AS nestingDepth
      FROM conversation_summaries`).all() as Array<{
      id: string
      title: string
      preview: string
      stepCount: number
      lastModifiedTime: unknown
      workspaceUris: unknown
      parentId: string
      nestingDepth: number
    }>
    for (const row of rows) {
      if (typeof row.id !== 'string' || !SESSION_ID_PATTERN.test(row.id)) continue
      result.set(row.id.toLowerCase(), {
        title: typeof row.title === 'string' ? row.title : '',
        preview: typeof row.preview === 'string' ? row.preview : '',
        stepCount: typeof row.stepCount === 'number' && Number.isFinite(row.stepCount) ? row.stepCount : 0,
        lastModifiedMs: parseAntigravityTimestamp(row.lastModifiedTime),
        workspacePaths: parseWorkspaceUris(row.workspaceUris),
        isSubagent: (typeof row.nestingDepth === 'number' && row.nestingDepth > 0) || Boolean(typeof row.parentId === 'string' && row.parentId.trim())
      })
    }
  } catch {
    return result
  } finally {
    db?.close()
  }
  return result
}

function parseHistoryBuffer(raw: string, dropFirstLine: boolean): Map<string, HistoryEntry> {
  const map = new Map<string, HistoryEntry>()
  const text = dropFirstLine ? raw.slice(Math.max(0, raw.indexOf('\n') + 1)) : raw
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try { obj = asRecord(JSON.parse(line)) } catch { continue }
    const id = typeof obj.conversationId === 'string' ? obj.conversationId : ''
    if (!SESSION_ID_PATTERN.test(id)) continue
    const key = id.toLowerCase()
    const entry = map.get(key) ?? { workspacePaths: [], firstDisplay: null, firstTimestampMs: null, lastTimestampMs: null }
    for (const ws of parseWorkspaceUris(obj.workspace)) {
      if (!entry.workspacePaths.includes(ws)) entry.workspacePaths.push(ws)
    }
    const ts = parseAntigravityTimestamp(obj.timestamp)
    if (ts !== null) {
      entry.firstTimestampMs = entry.firstTimestampMs === null ? ts : Math.min(entry.firstTimestampMs, ts)
      entry.lastTimestampMs = entry.lastTimestampMs === null ? ts : Math.max(entry.lastTimestampMs, ts)
    }
    const display = typeof obj.display === 'string' ? compactText(obj.display, MAX_PREVIEW_CHARS) : null
    if (display && (!entry.firstDisplay || entry.firstDisplay.toLowerCase() === 'exit')) {
      entry.firstDisplay = display
    }
    map.set(key, entry)
  }
  return map
}

async function readBoundedTailAsync(filePath: string, maxBytes: number): Promise<{ text: string; truncatedStart: boolean } | null> {
  try {
    const handle = await open(filePath, 'r')
    try {
      const { size } = await handle.stat()
      if (size <= 0) return { text: '', truncatedStart: false }
      const start = Math.max(0, size - maxBytes)
      const buf = Buffer.allocUnsafe(size - start)
      const { bytesRead } = await handle.read(buf, 0, buf.length, start)
      return { text: buf.subarray(0, bytesRead).toString('utf8'), truncatedStart: start > 0 }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function readBoundedTailSync(filePath: string, maxBytes: number): { text: string; truncatedStart: boolean } | null {
  try {
    const { size } = statSync(filePath)
    if (size <= 0) return { text: '', truncatedStart: false }
    const start = Math.max(0, size - maxBytes)
    const fd = openSync(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(size - start)
      const bytesRead = readSync(fd, buf, 0, buf.length, start)
      return { text: buf.subarray(0, bytesRead).toString('utf8'), truncatedStart: start > 0 }
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}

async function readHistoryIndexAsync(antigravityHome: string): Promise<Map<string, HistoryEntry>> {
  const chunk = await readBoundedTailAsync(join(antigravityHome, 'history.jsonl'), MAX_HISTORY_BYTES)
  return chunk ? parseHistoryBuffer(chunk.text, chunk.truncatedStart) : new Map()
}

function readHistoryIndexSync(antigravityHome: string): Map<string, HistoryEntry> {
  const chunk = readBoundedTailSync(join(antigravityHome, 'history.jsonl'), MAX_HISTORY_BYTES)
  return chunk ? parseHistoryBuffer(chunk.text, chunk.truncatedStart) : new Map()
}

function parseMetadataJson(raw: string): LocalMetadata | null {
  try {
    const obj = asRecord(JSON.parse(raw))
    const workspacePaths = [
      ...parseWorkspaceUris(obj.workspace_uris),
      ...parseWorkspaceUris(obj.workspaceUris),
      ...parseWorkspaceUris(obj.workspace),
      ...parseWorkspaceUris(obj.workspaceRootPath),
      ...parseWorkspaceUris(obj.cwd)
    ]
    return {
      workspacePaths: [...new Set(workspacePaths)],
      title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : null,
      preview: typeof obj.preview === 'string' && obj.preview.trim() ? obj.preview : null,
      modelId: typeof obj.modelId === 'string' && obj.modelId.trim() ? obj.modelId : typeof obj.model === 'string' && obj.model.trim() ? obj.model : null,
      startedAtMs: parseAntigravityTimestamp(obj.startedAt ?? obj.createdAt ?? obj.sessionStartedAtMs),
      updatedAtMs: parseAntigravityTimestamp(obj.updatedAt ?? obj.lastModifiedAt ?? obj.lastUpdatedMs)
    }
  } catch {
    return null
  }
}

async function readMetadataAsync(sessionDir: string): Promise<LocalMetadata | null> {
  for (const name of ['metadata.json', 'session.json']) {
    const path = safeJoin(sessionDir, name)
    const chunk = await readBoundedTailAsync(path, MAX_METADATA_BYTES)
    if (chunk && !chunk.truncatedStart) {
      const parsed = parseMetadataJson(chunk.text)
      if (parsed) return parsed
    }
  }
  return null
}

function readMetadataSync(sessionDir: string): LocalMetadata | null {
  for (const name of ['metadata.json', 'session.json']) {
    const path = safeJoin(sessionDir, name)
    const chunk = readBoundedTailSync(path, MAX_METADATA_BYTES)
    if (chunk && !chunk.truncatedStart) {
      const parsed = parseMetadataJson(chunk.text)
      if (parsed) return parsed
    }
  }
  return null
}

function findTranscriptPath(sessionDir: string): string | null {
  const primary = safeJoin(sessionDir, '.system_generated', 'logs', 'transcript.jsonl')
  if (existsSync(primary)) return primary
  const fallback = safeJoin(sessionDir, 'transcript.jsonl')
  return existsSync(fallback) ? fallback : null
}

function foldTranscriptChunk(text: string, state: Omit<TranscriptBounds, 'mtimeMs' | 'birthtimeMs'>, dropFirst: boolean, dropLast: boolean): void {
  const lines = text.split('\n')
  const start = dropFirst && lines.length > 1 ? 1 : 0
  const end = dropLast && lines.length > 1 ? lines.length - 1 : lines.length
  for (let i = start; i < end; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    let obj: Record<string, unknown>
    try { obj = asRecord(JSON.parse(line)) } catch { continue }
    for (const key of ['workspace_uris', 'workspaceUris', 'workspace', 'workspaceRootPath', 'cwd']) {
      for (const ws of parseWorkspaceUris(obj[key])) {
        if (!state.workspacePaths.includes(ws)) state.workspacePaths.push(ws)
      }
    }
    const ts = parseAntigravityTimestamp(obj.created_at ?? obj.timestamp)
    if (ts !== null) {
      state.startedAtMs = state.startedAtMs === null ? ts : Math.min(state.startedAtMs, ts)
      state.lastAtMs = state.lastAtMs === null ? ts : Math.max(state.lastAtMs, ts)
    }
    if (obj.type === 'PLANNER_RESPONSE') {
      state.requestCount += 1
      if (typeof obj.model === 'string' && obj.model.trim()) state.modelId = obj.model.trim()
    } else if (obj.type === 'USER_INPUT' && obj.source !== 'SYSTEM' && typeof obj.content === 'string' && !state.firstUserPreview) {
      state.firstUserPreview = compactText(obj.content, MAX_PREVIEW_CHARS)
    }
  }
}

async function scanTranscriptBoundsAsync(transcriptPath: string): Promise<TranscriptBounds | null> {
  try {
    const handle = await open(transcriptPath, 'r')
    try {
      const info = await handle.stat()
      const state: Omit<TranscriptBounds, 'mtimeMs' | 'birthtimeMs'> = {
        workspacePaths: [], startedAtMs: null, lastAtMs: null, modelId: null, requestCount: 0, firstUserPreview: null
      }
      const headLen = Math.min(info.size, MAX_TRANSCRIPT_HEAD_BYTES)
      if (headLen > 0) {
        const headBuf = Buffer.allocUnsafe(headLen)
        const { bytesRead } = await handle.read(headBuf, 0, headLen, 0)
        foldTranscriptChunk(headBuf.subarray(0, bytesRead).toString('utf8'), state, false, info.size > MAX_TRANSCRIPT_HEAD_BYTES)
      }
      if (info.size > MAX_TRANSCRIPT_HEAD_BYTES) {
        const tailStart = Math.max(MAX_TRANSCRIPT_HEAD_BYTES, info.size - MAX_TRANSCRIPT_TAIL_BYTES)
        const tailLen = info.size - tailStart
        const tailBuf = Buffer.allocUnsafe(tailLen)
        const { bytesRead } = await handle.read(tailBuf, 0, tailLen, tailStart)
        foldTranscriptChunk(tailBuf.subarray(0, bytesRead).toString('utf8'), state, true, false)
      }
      return { ...state, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs || info.ctimeMs }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

function scanTranscriptBoundsSync(transcriptPath: string): TranscriptBounds | null {
  try {
    const info = statSync(transcriptPath)
    const state: Omit<TranscriptBounds, 'mtimeMs' | 'birthtimeMs'> = {
      workspacePaths: [], startedAtMs: null, lastAtMs: null, modelId: null, requestCount: 0, firstUserPreview: null
    }
    const fd = openSync(transcriptPath, 'r')
    try {
      const headLen = Math.min(info.size, MAX_TRANSCRIPT_HEAD_BYTES)
      if (headLen > 0) {
        const headBuf = Buffer.allocUnsafe(headLen)
        const bytesRead = readSync(fd, headBuf, 0, headLen, 0)
        foldTranscriptChunk(headBuf.subarray(0, bytesRead).toString('utf8'), state, false, info.size > MAX_TRANSCRIPT_HEAD_BYTES)
      }
      if (info.size > MAX_TRANSCRIPT_HEAD_BYTES) {
        const tailStart = Math.max(MAX_TRANSCRIPT_HEAD_BYTES, info.size - MAX_TRANSCRIPT_TAIL_BYTES)
        const tailLen = info.size - tailStart
        const tailBuf = Buffer.allocUnsafe(tailLen)
        const bytesRead = readSync(fd, tailBuf, 0, tailLen, tailStart)
        foldTranscriptChunk(tailBuf.subarray(0, bytesRead).toString('utf8'), state, true, false)
      }
    } finally {
      closeSync(fd)
    }
    return { ...state, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs || info.ctimeMs }
  } catch {
    return null
  }
}

function isContainedRealPath(realRoot: string, realTarget: string): boolean {
  const rel = relative(realRoot, realTarget)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function resolveContainedBrainDirAsync(brainRoot: string, sessionId: string, strict: boolean): Promise<{ dir: string; mtimeMs: number; birthtimeMs: number } | null> {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw Error('Invalid native session identifier')
  const candidate = safeJoin(brainRoot, sessionId)
  let entryStat
  try {
    entryStat = await lstat(candidate)
  } catch {
    if (strict) throw Error('Antigravity native session was not found')
    return null
  }
  if (entryStat.isSymbolicLink()) {
    if (strict) throw Error('Antigravity session path escapes brain directory (symlink rejected)')
    return null
  }
  if (!entryStat.isDirectory()) {
    if (strict) throw Error('Antigravity native session was not found')
    return null
  }
  const [realBrain, realCandidate] = await Promise.all([realpath(brainRoot), realpath(candidate)])
  if (!isContainedRealPath(realBrain, realCandidate)) {
    if (strict) throw Error('Antigravity session path escapes brain directory')
    return null
  }
  return { dir: candidate, mtimeMs: entryStat.mtimeMs, birthtimeMs: entryStat.birthtimeMs || entryStat.ctimeMs }
}

function resolveContainedBrainDirSync(brainRoot: string, sessionId: string): { dir: string; mtimeMs: number; birthtimeMs: number } | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null
  const candidate = safeJoin(brainRoot, sessionId)
  try {
    const entryStat = lstatSync(candidate)
    if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) return null
    if (!isContainedRealPath(realpathSync(brainRoot), realpathSync(candidate))) return null
    return { dir: candidate, mtimeMs: entryStat.mtimeMs, birthtimeMs: entryStat.birthtimeMs || entryStat.ctimeMs }
  } catch {
    return null
  }
}

function buildSessionMetadata(
  sessionId: string,
  workspaceRootPath: string,
  dirInfo: { mtimeMs: number; birthtimeMs: number },
  summary: SummaryEntry | undefined,
  history: HistoryEntry | undefined,
  meta: LocalMetadata | null,
  transcript: TranscriptBounds | null
): SessionMetadata {
  const lastUpdatedMs = summary?.lastModifiedMs ?? meta?.updatedAtMs ?? transcript?.lastAtMs ?? history?.lastTimestampMs ?? transcript?.mtimeMs ?? dirInfo.mtimeMs
  const sessionStartedAtMs = transcript?.startedAtMs ?? meta?.startedAtMs ?? history?.firstTimestampMs ?? transcript?.birthtimeMs ?? dirInfo.birthtimeMs ?? lastUpdatedMs
  const modelId = transcript?.modelId ?? meta?.modelId ?? null
  const requestCount = transcript?.requestCount ?? 0
  const firstMessagePreview =
    compactText(summary?.title, MAX_PREVIEW_CHARS) ??
    compactText(summary?.preview, MAX_PREVIEW_CHARS) ??
    compactText(meta?.title, MAX_PREVIEW_CHARS) ??
    compactText(meta?.preview, MAX_PREVIEW_CHARS) ??
    transcript?.firstUserPreview ??
    history?.firstDisplay ??
    null
  const snapshot: ContextUsageSnapshot = {
    ...EMPTY_CONTEXT_USAGE,
    sessionId,
    modelId,
    requestCount,
    lastUpdatedMs,
    sessionStartedAtMs
  }
  return {
    sessionId,
    lastUpdatedMs,
    sessionStartedAtMs,
    modelId,
    requestCount,
    firstMessagePreview,
    summary: firstMessagePreview,
    workspaceRootPath,
    snapshot
  }
}

function sortSessions(sessions: SessionMetadata[]): SessionMetadata[] {
  return sessions.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs || a.sessionId.localeCompare(b.sessionId))
}

export async function listAntigravitySessions(
  workspaceRootPath: string,
  options: { antigravityHome?: string; onPartial?: (sessions: SessionMetadata[]) => void } = {}
): Promise<SessionMetadata[]> {
  const home = options.antigravityHome ?? defaultAntigravityHome()
  const brainRoot = join(home, 'brain')
  let entries
  try {
    entries = await readdir(brainRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const summaries = readSummariesIndex(home)
  const historyMap = await readHistoryIndexAsync(home)

  const candidates: Array<{ id: string; sortHint: number }> = []
  for (const entry of entries) {
    if (!SESSION_ID_PATTERN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
    const key = entry.name.toLowerCase()
    const summary = summaries.get(key)
    if (summary?.isSubagent) continue
    if (summary && summary.workspacePaths.length > 0 && !summary.workspacePaths.some(p => sameAntigravityRoot(p, workspaceRootPath))) continue
    const hist = historyMap.get(key)
    let hint = summary?.lastModifiedMs ?? hist?.lastTimestampMs ?? 0
    if (!hint) {
      try { hint = (await stat(safeJoin(brainRoot, entry.name))).mtimeMs } catch { continue }
    }
    candidates.push({ id: entry.name, sortHint: hint })
  }
  candidates.sort((a, b) => b.sortHint - a.sortHint || a.id.localeCompare(b.id))

  const sessions: SessionMetadata[] = []
  for (const candidate of candidates) {
    const dirInfo = await resolveContainedBrainDirAsync(brainRoot, candidate.id, false)
    if (!dirInfo) continue
    const key = candidate.id.toLowerCase()
    const summary = summaries.get(key)
    const hist = historyMap.get(key)
    const meta = await readMetadataAsync(dirInfo.dir)
    const transcriptPath = findTranscriptPath(dirInfo.dir)
    const transcript = transcriptPath ? await scanTranscriptBoundsAsync(transcriptPath) : null
    const workspacePaths = [
      ...(summary?.workspacePaths ?? []),
      ...(hist?.workspacePaths ?? []),
      ...(meta?.workspacePaths ?? []),
      ...(transcript?.workspacePaths ?? [])
    ]
    if (!workspacePaths.some(p => sameAntigravityRoot(p, workspaceRootPath))) continue
    sessions.push(buildSessionMetadata(candidate.id, workspaceRootPath, dirInfo, summary, hist, meta, transcript))
    sortSessions(sessions)
    options.onPartial?.(sessions.slice())
  }
  return sortSessions(sessions)
}

export function listAntigravitySessionsSync(workspaceRootPath: string, antigravityHome?: string): SessionMetadata[] {
  const home = antigravityHome ?? defaultAntigravityHome()
  const brainRoot = join(home, 'brain')
  if (!existsSync(brainRoot)) return []
  let entries
  try {
    entries = readdirSync(brainRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const summaries = readSummariesIndex(home)
  const historyMap = readHistoryIndexSync(home)
  const sessions: SessionMetadata[] = []

  for (const entry of entries) {
    if (!SESSION_ID_PATTERN.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) continue
    const key = entry.name.toLowerCase()
    const summary = summaries.get(key)
    if (summary?.isSubagent) continue
    if (summary && summary.workspacePaths.length > 0 && !summary.workspacePaths.some(p => sameAntigravityRoot(p, workspaceRootPath))) continue
    const dirInfo = resolveContainedBrainDirSync(brainRoot, entry.name)
    if (!dirInfo) continue
    const hist = historyMap.get(key)
    const meta = readMetadataSync(dirInfo.dir)
    const transcriptPath = findTranscriptPath(dirInfo.dir)
    const transcript = transcriptPath ? scanTranscriptBoundsSync(transcriptPath) : null
    const workspacePaths = [
      ...(summary?.workspacePaths ?? []),
      ...(hist?.workspacePaths ?? []),
      ...(meta?.workspacePaths ?? []),
      ...(transcript?.workspacePaths ?? [])
    ]
    if (!workspacePaths.some(p => sameAntigravityRoot(p, workspaceRootPath))) continue
    sessions.push(buildSessionMetadata(entry.name, workspaceRootPath, dirInfo, summary, hist, meta, transcript))
  }
  return sortSessions(sessions)
}

function acceptPublicAntigravityEvent(value: Record<string, unknown>, offset: number): ThreadEvent | undefined {
  const id = typeof value.step_index === 'number' && Number.isFinite(value.step_index)
    ? `native:step-${value.step_index}`
    : `native:byte-${offset}`
  if (value.type === 'USER_INPUT' && value.source !== 'SYSTEM' && typeof value.content === 'string') {
    const text = formatNativeUserText(stripUserWrapper(value.content))
    if (!text || text.length > MAX_PUBLIC_MESSAGE_CHARS) return undefined
    return { type: 'message', id, role: 'user', text }
  }
  if (value.type === 'PLANNER_RESPONSE' && typeof value.content === 'string') {
    const text = value.content.trim()
    if (!text || text.length > MAX_PUBLIC_MESSAGE_CHARS) return undefined
    return { type: 'message', id, role: 'assistant', text }
  }
  return undefined
}

export async function verifyAndReadAntigravitySession(
  workspaceRootPath: string,
  sessionId: string,
  options: { antigravityHome?: string; cursor?: NativeHistoryCursor } = {}
): Promise<AntigravitySessionHistory> {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw Error('Invalid native session identifier')
  const home = options.antigravityHome ?? defaultAntigravityHome()
  const brainRoot = join(home, 'brain')
  const canonicalId = existsSync(safeJoin(brainRoot, sessionId)) ? sessionId : sessionId.toLowerCase()
  const dirInfo = await resolveContainedBrainDirAsync(brainRoot, canonicalId, true)
  if (!dirInfo) throw Error('Antigravity native session was not found')

  const key = canonicalId.toLowerCase()
  const summary = readSummariesIndex(home).get(key)
  const hist = (await readHistoryIndexAsync(home)).get(key)
  const meta = await readMetadataAsync(dirInfo.dir)
  const transcriptPath = findTranscriptPath(dirInfo.dir)
  const bounds = transcriptPath ? await scanTranscriptBoundsAsync(transcriptPath) : null

  const workspacePaths = [
    ...(summary?.workspacePaths ?? []),
    ...(hist?.workspacePaths ?? []),
    ...(meta?.workspacePaths ?? []),
    ...(bounds?.workspacePaths ?? [])
  ]
  if (workspacePaths.length === 0) throw Error('Native session project could not be verified')
  if (!workspacePaths.some(p => sameAntigravityRoot(p, workspaceRootPath))) {
    throw Error('Native session belongs to a different project')
  }

  let title =
    compactText(summary?.title, MAX_TITLE_CHARS) ??
    compactText(meta?.title, MAX_TITLE_CHARS) ??
    compactText(summary?.preview, MAX_TITLE_CHARS) ??
    compactText(meta?.preview, MAX_TITLE_CHARS) ??
    compactText(hist?.firstDisplay, MAX_TITLE_CHARS) ??
    undefined

  if (!transcriptPath) {
    return { events: [], ...(title ? { title } : {}) }
  }

  const page = await readNativeHistoryPage<ThreadEvent>(transcriptPath, acceptPublicAntigravityEvent, options.cursor, MAX_HISTORY_EVENTS)
  if (!title) {
    const firstUser = page.items.find(event => event.type === 'message' && event.role === 'user' && !taskNotification(event.text))
    if (firstUser?.type === 'message') title = compactText(firstUser.text, MAX_TITLE_CHARS) ?? undefined
  }
  return {
    events: page.items,
    ...(title ? { title } : {}),
    ...(page.cursor ? { truncated: true, cursor: page.cursor } : {})
  }
}
