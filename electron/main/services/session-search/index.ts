/**
 * Full-text index over the native Claude Code and Codex transcripts.
 *
 * It is a cache, not a source of truth: it lives in its own SQLite file, is
 * rebuilt from the transcripts whenever its schema version changes or the file
 * is unreadable, and never modifies a transcript. Indexing is incremental (a
 * file is re-read from its saved byte offset) and time-boxed per call so the
 * first scan of a large history cannot stall the main process.
 */
import Database from 'better-sqlite3'
import type { Database as DatabaseHandle } from 'better-sqlite3'
import { closeSync, fstatSync, openSync, readSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type {
  SessionSearchAgent,
  SessionSearchHit,
  SessionSearchInput,
  SessionSearchResult
} from '../../../../shared/types/session-search'
import { buildMatchLadder, parseSessionQuery } from './query'
import { parseTranscriptLine } from './transcript'

const SCHEMA_VERSION = 1
const CHUNK_BYTES = 8 * 1024 * 1024
const DEFAULT_BUDGET_MS = 4_000
const SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

export interface TranscriptSource {
  agent: SessionSearchAgent
  path: string
}

/** Claude: <root>/<project>/<session>.jsonl (one level; deeper dirs are subagents). Codex: <root>/YYYY/MM/DD/*.jsonl. */
export function discoverTranscripts(
  claudeProjectsRoot: string = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects'),
  codexSessionsRoot: string = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
): TranscriptSource[] {
  const found: TranscriptSource[] = []
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }
  for (const project of list(claudeProjectsRoot)) {
    const dir = join(claudeProjectsRoot, project)
    for (const file of list(dir)) {
      if (file.endsWith('.jsonl')) found.push({ agent: 'claude', path: join(dir, file) })
    }
  }
  for (const year of list(codexSessionsRoot)) {
    for (const month of list(join(codexSessionsRoot, year))) {
      for (const day of list(join(codexSessionsRoot, year, month))) {
        const dir = join(codexSessionsRoot, year, month, day)
        for (const file of list(dir)) {
          if (file.endsWith('.jsonl')) found.push({ agent: 'codex', path: join(dir, file) })
        }
      }
    }
  }
  return found
}

interface FileRow {
  path: string
  size: number
  mtime_ms: number
  byte_offset: number
}

export class SessionSearchIndex {
  private db: DatabaseHandle
  private indexing = false

  /**
   * @param filePath SQLite file, or `:memory:` in tests.
   * @param sources  Transcript discovery, injectable for tests.
   */
  constructor(
    private readonly filePath: string,
    private readonly sources: () => TranscriptSource[] = () => discoverTranscripts()
  ) {
    this.db = this.open()
  }

  private open(): DatabaseHandle {
    const attempt = (): DatabaseHandle => {
      const db = new Database(this.filePath)
      const version = db.pragma('user_version', { simple: true }) as number
      if (version !== SCHEMA_VERSION) {
        if (version !== 0) {
          // Older/other schema: it is only a cache, so start clean.
          db.close()
          throw new SchemaMismatch()
        }
        db.exec(`
          CREATE TABLE files (
            path TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT, title TEXT,
            started_at INTEGER, updated_at INTEGER NOT NULL, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
            byte_offset INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0
          );
          CREATE VIRTUAL TABLE fts USING fts5(
            user_text, assistant_text, path UNINDEXED, ts UNINDEXED,
            tokenize = "unicode61 tokenchars '_.-/+'"
          );
          PRAGMA user_version = ${SCHEMA_VERSION};
        `)
      }
      return db
    }
    try {
      return attempt()
    } catch {
      if (this.filePath !== ':memory:') {
        for (const suffix of ['', '-wal', '-shm']) {
          try { unlinkSync(this.filePath + suffix) } catch { /* absent */ }
        }
      }
      return attempt()
    }
  }

  close(): void {
    this.db.close()
  }

  get indexedSessions(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
  }

  /**
   * Brings the index up to date, stopping when the time budget is spent (the
   * remainder is picked up by the next call). Returns true when fully current.
   */
  refresh(budgetMs: number = DEFAULT_BUDGET_MS): boolean {
    if (this.indexing) return false
    this.indexing = true
    const deadline = Date.now() + budgetMs
    try {
      const present = new Set<string>()
      const known = new Map<string, FileRow>()
      for (const row of this.db.prepare('SELECT path, size, mtime_ms, byte_offset FROM files').all() as FileRow[]) known.set(row.path, row)

      const sources = this.sources()
      // Newest first so recent sessions become searchable before old ones.
      const stamped = sources
        .map((source) => {
          try {
            const s = statSync(source.path)
            return { source, size: s.size, mtimeMs: s.mtimeMs }
          } catch {
            return null
          }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)

      let complete = true
      for (const { source, size, mtimeMs } of stamped) {
        present.add(source.path)
        const row = known.get(source.path)
        if (row && row.size === size && Math.floor(row.mtime_ms) === Math.floor(mtimeMs) && row.byte_offset >= size) continue
        if (Date.now() > deadline) {
          complete = false
          continue
        }
        this.indexFile(source, size, mtimeMs, row)
      }

      // Transcripts that disappeared: drop their rows.
      for (const path of known.keys()) {
        if (present.has(path)) continue
        this.db.transaction(() => {
          this.db.prepare('DELETE FROM fts WHERE path = ?').run(path)
          this.db.prepare('DELETE FROM files WHERE path = ?').run(path)
        })()
      }
      return complete
    } finally {
      this.indexing = false
    }
  }

  private indexFile(source: TranscriptSource, size: number, mtimeMs: number, row: FileRow | undefined): void {
    // A file that shrank was rewritten (compaction, fork copy): start over.
    const restart = !row || size < row.byte_offset
    let offset = restart ? 0 : row.byte_offset

    let fd: number
    try {
      fd = openSync(source.path, 'r')
    } catch {
      return
    }
    try {
      const length = Math.min(fstatSync(fd).size - offset, CHUNK_BYTES)
      if (length <= 0 && !restart) return
      const buffer = Buffer.alloc(Math.max(0, length))
      const read = length > 0 ? readSync(fd, buffer, 0, length, offset) : 0
      // Only complete lines: a trailing partial write is picked up next time.
      const end = buffer.subarray(0, read).lastIndexOf(0x0a)
      const usable = end === -1 ? 0 : end + 1
      const text = buffer.subarray(0, usable).toString('utf8')

      const insert = this.db.prepare('INSERT INTO fts (user_text, assistant_text, path, ts) VALUES (?, ?, ?, ?)')
      let sessionId = row ? (this.db.prepare('SELECT session_id FROM files WHERE path = ?').get(source.path) as { session_id: string }).session_id : null
      let cwd: string | null = null
      let title: string | null = null
      let startedAt: number | null = null
      let added = 0
      if (row) {
        const prev = this.db.prepare('SELECT cwd, title, started_at FROM files WHERE path = ?').get(source.path) as {
          cwd: string | null; title: string | null; started_at: number | null
        }
        cwd = prev.cwd
        title = prev.title
        startedAt = prev.started_at
      }

      this.db.transaction(() => {
        if (restart) this.db.prepare('DELETE FROM fts WHERE path = ?').run(source.path)
        for (const line of text.split('\n')) {
          const parsed = parseTranscriptLine(source.agent, line)
          if (!parsed) continue
          sessionId ??= parsed.sessionId
          cwd ??= parsed.cwd
          const message = parsed.message
          if (!message) continue
          if (message.role === 'user') title ??= message.text.replace(/\s+/g, ' ').slice(0, 120)
          startedAt ??= message.at
          insert.run(message.role === 'user' ? message.text : null, message.role === 'assistant' ? message.text : null, source.path, message.at ?? mtimeMs)
          added += 1
        }
        offset += usable
        const idFromName = basename(source.path).match(SESSION_ID)?.[1] ?? basename(source.path, '.jsonl')
        this.db
          .prepare(
            `INSERT INTO files (path, agent, session_id, cwd, title, started_at, updated_at, size, mtime_ms, byte_offset, messages)
             VALUES (@path, @agent, @sessionId, @cwd, @title, @startedAt, @updatedAt, @size, @mtimeMs, @offset, @added)
             ON CONFLICT(path) DO UPDATE SET session_id = excluded.session_id, cwd = excluded.cwd, title = excluded.title,
               started_at = excluded.started_at, updated_at = excluded.updated_at, size = excluded.size,
               mtime_ms = excluded.mtime_ms, byte_offset = excluded.byte_offset,
               messages = ${restart ? 'excluded.messages' : 'files.messages + excluded.messages'}`
          )
          .run({
            path: source.path,
            agent: source.agent,
            sessionId: sessionId ?? idFromName,
            cwd,
            title,
            startedAt,
            updatedAt: Math.floor(mtimeMs),
            size,
            mtimeMs,
            offset,
            added
          })
      })()
    } finally {
      closeSync(fd)
    }
  }

  search(input: SessionSearchInput): SessionSearchResult {
    const parsed = parseSessionQuery(input.query)
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
    const empty: SessionSearchResult = { hits: [], mode: 'none', indexedSessions: this.indexedSessions, indexing: this.indexing }
    if (parsed.terms.length === 0) return empty

    const cwdPrefix = input.cwd ? resolve(input.cwd).replace(/\\/g, '/').toLowerCase() : null
    const select = this.db.prepare(
      `SELECT f.agent AS agent, f.session_id AS sessionId, f.title AS title, f.cwd AS cwd,
              f.updated_at AS updatedAt, f.messages AS messages,
              snippet(fts, -1, '[', ']', '…', 14) AS snippet,
              CASE WHEN fts.user_text IS NOT NULL THEN 'user' ELSE 'assistant' END AS role,
              bm25(fts, 3.0, 2.0) AS rank
         FROM fts JOIN files f ON f.path = fts.path
        WHERE fts MATCH ? ${input.agent ? 'AND f.agent = @agent' : ''}
        ORDER BY rank LIMIT 300`
    )

    for (const { mode, match } of buildMatchLadder(parsed.terms)) {
      let rows: Array<Omit<SessionSearchHit, 'resumeCommand' | 'messageCount'> & { messages: number; rank: number }>
      try {
        rows = (input.agent ? select.all(match, { agent: input.agent }) : select.all(match)) as typeof rows
      } catch {
        continue
      }
      const seen = new Set<string>()
      const hits: SessionSearchHit[] = []
      for (const row of rows) {
        const key = `${row.agent}:${row.sessionId}`
        if (seen.has(key)) continue
        const cwd = row.cwd ? row.cwd.replace(/\\/g, '/').toLowerCase() : ''
        if (cwdPrefix && !(cwd === cwdPrefix || cwd.startsWith(cwdPrefix + '/'))) continue
        if (parsed.scopes.some((s) => !cwd.includes(s.replace(/\\/g, '/').toLowerCase()))) continue
        seen.add(key)
        hits.push({
          agent: row.agent,
          sessionId: row.sessionId,
          title: row.title,
          cwd: row.cwd,
          updatedAt: row.updatedAt,
          messageCount: row.messages,
          snippet: row.snippet,
          role: row.role,
          resumeCommand: row.agent === 'claude' ? `claude --resume ${row.sessionId}` : `codex resume ${row.sessionId}`
        })
        if (hits.length >= limit) break
      }
      if (hits.length > 0) return { hits, mode, indexedSessions: this.indexedSessions, indexing: this.indexing }
    }
    return empty
  }
}

class SchemaMismatch extends Error {}

/**
 * Keeps an index current without ever blocking the main process for long: work
 * is done in short slices separated by timer turns, and a completed scan is
 * not repeated more often than `minIntervalMs`.
 */
export class SessionSearchService {
  private running = false
  private lastCompleteAt = 0

  constructor(
    private readonly index: SessionSearchIndex,
    private readonly options: { sliceMs?: number; minIntervalMs?: number } = {}
  ) {}

  search(input: SessionSearchInput): SessionSearchResult {
    this.kick()
    const result = this.index.search(input)
    return { ...result, indexing: this.running }
  }

  /** Runs one slice now and schedules the rest; safe to call at any rate. */
  kick(): void {
    const minInterval = this.options.minIntervalMs ?? 15_000
    if (this.running || Date.now() - this.lastCompleteAt < minInterval) return
    this.running = true
    const step = (): void => {
      let done = true
      try {
        done = this.index.refresh(this.options.sliceMs ?? 250)
      } catch {
        done = true
      }
      if (done) {
        this.running = false
        this.lastCompleteAt = Date.now()
      } else {
        setTimeout(step, 10).unref?.()
      }
    }
    setTimeout(step, 0).unref?.()
  }

  close(): void {
    this.index.close()
  }
}
