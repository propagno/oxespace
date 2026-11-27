import { closeSync, existsSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { defaultClaudeProjectsRoot, encodeClaudeProjectPath } from '../usage/claude-project-path'
import { findRecentAntigravitySessionsSync } from '../usage/antigravity-sessions'
import { agentFromCommand } from './agents'
import { NATIVE_SESSION_ID, type NativeSessionRoots } from './native-session-files'
import { isResumableAgent, type ResumableAgent } from './pane-sessions'

export interface ExtractedLaunchSession {
  agent: ResumableAgent
  sessionId: string
}

export interface DiscoveredPaneSession {
  agent: ResumableAgent
  sessionId: string
  startedAtMs: number
  lastUpdatedMs: number
}

export interface PaneSessionDiscoveryInput {
  paneId: string
  agent: ResumableAgent
  cwd: string
  /** Epoch ms when the pane process started, if currently running. */
  startedAt?: number
  /** Epoch ms of the pane's latest output/activity, if running. */
  lastActivityAt?: number
  /** Lowercase or raw UUIDs actively bound to other panes so two panes never share one session. */
  claimedByOtherPanes?: ReadonlySet<string>
  /** Test seam overriding provider home/session folders. */
  roots?: NativeSessionRoots
  /** Clock-skew tolerance before `startedAt` (default 15s). */
  startSkewMs?: number
  /** Fallback recency window when `startedAt` is omitted (default 15m). */
  recentWindowMs?: number
  now?: () => number
}

interface CandidateSession {
  sessionId: string
  startedAtMs: number
  lastUpdatedMs: number
}

const DEFAULT_START_SKEW_MS = 15_000
const DEFAULT_RECENT_WINDOW_MS = 15 * 60 * 1000
const MAX_TYPED_LINE_CHARS = 2048
const MAX_CODEX_DAYS_SCAN = 7
const MAX_CODEX_FILES_SCAN = 40
const MAX_CODEX_META_BYTES = 256 * 1024

const CODEX_VALUE_FLAGS = new Set([
  '-c', '--config', '-m', '--model', '-p', '--profile', '-C', '--cd',
  '-s', '--sandbox', '-a', '--ask-for-approval', '--add-dir', '-i', '--image'
])

/** Tokenizes a shell command line while preserving quoted arguments and stripping a leading PowerShell `&`. */
export function splitCommandTokens(commandLine: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i]
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  if (tokens[0] === '&' && tokens.length > 1) tokens.shift()
  return tokens
}

/** Identifies a resumable provider CLI (`claude`, `codex`, `antigravity`/`agy`) from a command line. */
export function detectAgentFromCommandLine(commandLine: string | undefined | null): ResumableAgent | null {
  if (!commandLine) return null
  const [first] = splitCommandTokens(commandLine.trim())
  if (!first) return null
  const agent = agentFromCommand(first)
  return isResumableAgent(agent) ? agent : null
}

/**
 * Extracts an explicit provider native session UUID from a launch command/arguments or typed shell command:
 * - Claude: `claude --resume <id>`, `claude -r <id>`, `claude --session-id <id>` (and `=` forms)
 * - Codex: `codex [flags] resume <id>`
 * - Antigravity: `agy --resume <id>`, `agy --conversation <id>`, `agy -r <id>` (and `=` forms)
 */
export function extractSessionFromCommandLine(
  commandLine: string | undefined | null,
  extraArgs: readonly string[] = []
): ExtractedLaunchSession | null {
  const tokens = [...(commandLine ? splitCommandTokens(commandLine.trim()) : []), ...extraArgs]
  if (tokens.length < 2) return null
  const agent = agentFromCommand(tokens[0])
  if (!isResumableAgent(agent)) return null
  const args = tokens.slice(1)

  if (agent === 'claude') {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      const inline = /^(?:-r|--resume|--session-id)=(.+)$/.exec(arg)
      if (inline && NATIVE_SESSION_ID.test(inline[1])) return { agent, sessionId: inline[1] }
      if (/^(?:-r|--resume|--session-id)$/.test(arg)) {
        const next = args[i + 1]
        if (next && NATIVE_SESSION_ID.test(next)) return { agent, sessionId: next }
      }
    }
    return null
  }

  if (agent === 'antigravity') {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      const inline = /^(?:-r|--resume|--conversation)=(.+)$/.exec(arg)
      if (inline && NATIVE_SESSION_ID.test(inline[1])) return { agent, sessionId: inline[1] }
      if (/^(?:-r|--resume|--conversation)$/.test(arg)) {
        const next = args[i + 1]
        if (next && NATIVE_SESSION_ID.test(next)) return { agent, sessionId: next }
      }
    }
    return null
  }

  // Codex: `codex [global flags] resume [flags] <uuid>`
  let resumeIndex = -1
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (CODEX_VALUE_FLAGS.has(arg)) { i += 1; continue }
    if (arg.startsWith('-')) continue
    if (arg === 'resume') resumeIndex = i
    break
  }
  if (resumeIndex < 0) return null
  for (let i = resumeIndex + 1; i < args.length; i++) {
    const arg = args[i]
    if (CODEX_VALUE_FLAGS.has(arg)) { i += 1; continue }
    if (arg.startsWith('-')) continue
    return NATIVE_SESSION_ID.test(arg) ? { agent, sessionId: arg } : null
  }
  return null
}

/**
 * Passive per-pane line tracker for bytes written to a shell PTY: detects when a person types
 * `agy`, `claude`, or `codex` (and any explicit `--resume` / `--conversation` / `resume <uuid>`).
 */
export class TerminalTypedCommandTracker {
  private buffer = ''
  private inEscape = false

  push(data: string): Array<{ agent: ResumableAgent; sessionId?: string }> {
    const found: Array<{ agent: ResumableAgent; sessionId?: string }> = []
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      if (this.inEscape) {
        if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '~') this.inEscape = false
        continue
      }
      if (ch === '\x1b') {
        this.inEscape = true
        continue
      }
      if (ch === '\x03') {
        this.buffer = ''
        continue
      }
      if (ch === '\b' || ch === '\x7f') {
        this.buffer = this.buffer.slice(0, -1)
        continue
      }
      if (ch === '\r' || ch === '\n') {
        const line = this.buffer.trim()
        this.buffer = ''
        if (!line) continue
        const explicit = extractSessionFromCommandLine(line)
        if (explicit) {
          found.push(explicit)
          continue
        }
        const agent = detectAgentFromCommandLine(line)
        if (agent) found.push({ agent })
        continue
      }
      if (ch >= ' ' && this.buffer.length < MAX_TYPED_LINE_CHARS) {
        this.buffer += ch
      }
    }
    return found
  }

  reset(): void {
    this.buffer = ''
    this.inEscape = false
  }
}

/**
 * Automatically correlates an active/recent native provider session on disk to a pane's
 * agent and working directory. Read-only, bounded, symlink-safe, and multi-pane aware.
 */
export function discoverPaneProviderSession(input: PaneSessionDiscoveryInput): DiscoveredPaneSession | null {
  if (!input.cwd?.trim()) return null
  const candidates = readProviderCandidatesSync(input.agent, input.cwd, input.roots)
  if (!candidates.length) return null

  const claimed = new Set<string>()
  if (input.claimedByOtherPanes) {
    for (const id of input.claimedByOtherPanes) claimed.add(id.toLowerCase())
  }
  const available = candidates.filter(c => !claimed.has(c.sessionId.toLowerCase()))
  if (!available.length) return null

  if (typeof input.startedAt === 'number' && Number.isFinite(input.startedAt)) {
    const skew = input.startSkewMs ?? DEFAULT_START_SKEW_MS
    const cutoff = input.startedAt - skew
    const active = available.filter(c => c.lastUpdatedMs >= cutoff)
    if (!active.length) return null

    const bornForPane = active.filter(c => c.startedAtMs >= cutoff)
    const pool = bornForPane.length ? bornForPane : active
    pool.sort((a, b) =>
      b.lastUpdatedMs - a.lastUpdatedMs ||
      Math.abs(a.startedAtMs - input.startedAt!) - Math.abs(b.startedAtMs - input.startedAt!) ||
      a.sessionId.localeCompare(b.sessionId)
    )
    return { agent: input.agent, ...pool[0] }
  }

  const now = (input.now ?? Date.now)()
  const cutoff = now - (input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS)
  const recent = available.filter(c => c.lastUpdatedMs >= cutoff)
  if (!recent.length) return null
  recent.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs || a.sessionId.localeCompare(b.sessionId))
  return { agent: input.agent, ...recent[0] }
}

function readProviderCandidatesSync(
  agent: ResumableAgent,
  cwd: string,
  roots?: NativeSessionRoots
): CandidateSession[] {
  if (agent === 'antigravity') {
    return findRecentAntigravitySessionsSync(cwd, { antigravityHome: roots?.antigravityHome })
  }
  if (agent === 'claude') {
    return findRecentClaudeSessionsSync(cwd, roots?.claudeProjects)
  }
  return findRecentCodexSessionsSync(cwd, roots?.codexSessions)
}

function canonicalRootsSync(cwd: string): string[] {
  const roots = [cwd]
  try {
    const real = realpathSync.native ? realpathSync.native(cwd) : realpathSync(cwd)
    if (real && !roots.some(existing => normalizeFsPath(existing) === normalizeFsPath(real))) {
      roots.push(real)
    }
  } catch { /* directory may be virtual in unit tests */ }
  return roots
}

function normalizeFsPath(input: string): string {
  const resolved = resolve(input.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isContainedRealPath(realRoot: string, realTarget: string): boolean {
  const rel = relative(realRoot, realTarget)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function findRecentClaudeSessionsSync(cwd: string, claudeProjectsRoot?: string): CandidateSession[] {
  const projectsRoot = claudeProjectsRoot ?? defaultClaudeProjectsRoot()
  if (!existsSync(projectsRoot)) return []
  let projectsReal: string
  try {
    projectsReal = realpathSync(projectsRoot)
  } catch {
    return []
  }

  const windows = process.platform === 'win32'
  const fold = (name: string): string => windows ? name.toLowerCase() : name
  const wanted = new Set(canonicalRootsSync(cwd).map(root => fold(encodeClaudeProjectPath(root))))

  let folderNames: string[]
  try {
    folderNames = readdirSync(projectsRoot)
  } catch {
    return []
  }

  const results: CandidateSession[] = []
  for (const folder of folderNames) {
    if (!wanted.has(fold(folder))) continue
    const projectDir = join(projectsRoot, folder)
    try {
      const dirStat = lstatSync(projectDir)
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) continue
      if (!isContainedRealPath(projectsReal, realpathSync(projectDir))) continue
    } catch {
      continue
    }
    let files: string[]
    try {
      files = readdirSync(projectDir)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const sessionId = file.slice(0, -6)
      if (!NATIVE_SESSION_ID.test(sessionId)) continue
      const fullPath = join(projectDir, file)
      try {
        const info = lstatSync(fullPath)
        if (info.isSymbolicLink() || !info.isFile()) continue
        results.push({
          sessionId,
          startedAtMs: info.birthtimeMs || info.ctimeMs || info.mtimeMs,
          lastUpdatedMs: info.mtimeMs
        })
      } catch { /* unreadable file */ }
    }
  }
  return results.sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs || a.sessionId.localeCompare(b.sessionId))
}

type SqliteConstructor = typeof Database
let sqliteCtor: SqliteConstructor | null | undefined

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

function findRecentCodexSessionsSync(cwd: string, codexSessionsRoot?: string): CandidateSession[] {
  const sessionsRoot = codexSessionsRoot ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const codexHome = dirname(sessionsRoot)
  const targetRoots = new Set(canonicalRootsSync(cwd).map(normalizeFsPath))
  const byId = new Map<string, CandidateSession>()

  const merge = (candidate: CandidateSession): void => {
    const key = candidate.sessionId.toLowerCase()
    const existing = byId.get(key)
    if (!existing) {
      byId.set(key, candidate)
      return
    }
    byId.set(key, {
      sessionId: existing.sessionId,
      startedAtMs: Math.min(existing.startedAtMs, candidate.startedAtMs),
      lastUpdatedMs: Math.max(existing.lastUpdatedMs, candidate.lastUpdatedMs)
    })
  }

  for (const item of readCodexSqliteCandidates(codexHome, targetRoots)) merge(item)
  for (const item of readCodexRolloutCandidates(sessionsRoot, targetRoots)) merge(item)
  return [...byId.values()].sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs || a.sessionId.localeCompare(b.sessionId))
}

function readCodexSqliteCandidates(codexHome: string, targetRoots: ReadonlySet<string>): CandidateSession[] {
  let statePath: string | null
  try {
    const candidates = readdirSync(codexHome)
      .filter(name => /^state(?:_\d+)?\.sqlite$/i.test(name))
      .sort((a, b) => Number(b.match(/_(\d+)\.sqlite$/i)?.[1] ?? 0) - Number(a.match(/_(\d+)\.sqlite$/i)?.[1] ?? 0))
    statePath = candidates.length ? join(codexHome, candidates[0]) : null
  } catch {
    return []
  }
  if (!statePath) return []
  const Sqlite = loadSqlite()
  if (!Sqlite) return []

  let db: Database.Database | undefined
  try {
    db = new Sqlite(statePath, { readonly: true, fileMustExist: true })
    const columns = new Set((db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>).map(row => row.name))
    if (!columns.has('id') || !columns.has('cwd')) return []
    const col = (name: string, fallback: string) => columns.has(name) ? name : fallback
    const rows = db.prepare(`SELECT
      id, cwd,
      ${col('created_at', '0')} AS createdAt,
      ${col('created_at_ms', '0')} AS createdAtMs,
      ${col('updated_at', '0')} AS updatedAt,
      ${col('updated_at_ms', '0')} AS updatedAtMs
      FROM threads ${columns.has('archived') ? 'WHERE archived = 0' : ''}
      ORDER BY ${col('updated_at_ms', col('updated_at', 'rowid'))} DESC
      LIMIT 64`).all() as Array<{
      id: string
      cwd: string
      createdAt: number
      createdAtMs: number
      updatedAt: number
      updatedAtMs: number
    }>
    const results: CandidateSession[] = []
    for (const row of rows) {
      if (typeof row.id !== 'string' || !NATIVE_SESSION_ID.test(row.id) || typeof row.cwd !== 'string') continue
      if (!targetRoots.has(normalizeFsPath(row.cwd))) continue
      const startedAtMs = row.createdAtMs || row.createdAt * 1000
      const lastUpdatedMs = row.updatedAtMs || row.updatedAt * 1000 || startedAtMs
      if (lastUpdatedMs > 0) results.push({ sessionId: row.id, startedAtMs: startedAtMs || lastUpdatedMs, lastUpdatedMs })
    }
    return results
  } catch {
    return []
  } finally {
    db?.close()
  }
}

function readCodexRolloutCandidates(sessionsRoot: string, targetRoots: ReadonlySet<string>): CandidateSession[] {
  if (!existsSync(sessionsRoot)) return []
  const numericDirsDesc = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && /^\d+$/.test(entry.name))
        .map(entry => entry.name)
        .sort()
        .reverse()
    } catch {
      return []
    }
  }

  const results: CandidateSession[] = []
  let scannedDays = 0
  let scannedFiles = 0
  for (const year of numericDirsDesc(sessionsRoot)) {
    for (const month of numericDirsDesc(join(sessionsRoot, year))) {
      for (const day of numericDirsDesc(join(sessionsRoot, year, month))) {
        if (++scannedDays > MAX_CODEX_DAYS_SCAN) return results
        const dayDir = join(sessionsRoot, year, month, day)
        let files: string[]
        try { files = readdirSync(dayDir) } catch { continue }
        const jsonlFiles = files.filter(name => name.endsWith('.jsonl')).sort().reverse()
        for (const file of jsonlFiles) {
          if (++scannedFiles > MAX_CODEX_FILES_SCAN) return results
          const fullPath = join(dayDir, file)
          try {
            const info = lstatSync(fullPath)
            if (info.isSymbolicLink() || !info.isFile()) continue
            const meta = readCodexFirstLineMeta(fullPath)
            if (!meta?.cwd || !targetRoots.has(normalizeFsPath(meta.cwd))) continue
            const filenameId = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1] ?? null
            const sessionId = meta.id && NATIVE_SESSION_ID.test(meta.id) ? meta.id : filenameId
            if (!sessionId || !NATIVE_SESSION_ID.test(sessionId)) continue
            results.push({
              sessionId,
              startedAtMs: meta.startedAtMs ?? (info.birthtimeMs || info.ctimeMs || info.mtimeMs),
              lastUpdatedMs: info.mtimeMs
            })
          } catch { /* skip unreadable rollout */ }
        }
      }
    }
  }
  return results
}

function readCodexFirstLineMeta(filePath: string): { cwd: string | null; id: string | null; startedAtMs: number | null } | null {
  try {
    const fd = openSync(filePath, 'r')
    try {
      const size = Math.min(statSync(filePath).size, MAX_CODEX_META_BYTES)
      if (size <= 0) return null
      const buf = Buffer.allocUnsafe(size)
      const bytesRead = readSync(fd, buf, 0, size, 0)
      const firstLine = buf.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0]
      const record = JSON.parse(firstLine) as {
        type?: string
        timestamp?: string
        payload?: { cwd?: string; id?: string; timestamp?: string }
      }
      if (record.type !== 'session_meta') return null
      const ts = record.payload?.timestamp ?? record.timestamp
      const parsedTs = ts ? Date.parse(ts) : NaN
      return {
        cwd: typeof record.payload?.cwd === 'string' ? record.payload.cwd : null,
        id: typeof record.payload?.id === 'string' ? record.payload.id : null,
        startedAtMs: Number.isFinite(parsedTs) ? parsedTs : null
      }
    } finally {
      closeSync(fd)
    }
  } catch {
    return null
  }
}
