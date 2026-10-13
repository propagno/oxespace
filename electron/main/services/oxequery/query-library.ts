import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { QueryHistoryItem, SavedQuery } from '../../../../shared/types/oxequery'

export const HISTORY_LIMIT = 200
export const HISTORY_DAYS = 90
const MAX_HISTORY_SQL = 20_000
const MAX_SAVED_SQL = 100_000
const MAX_SAVED = 500

export class LibraryInputError extends Error {}

interface SavedRow { id: string; connection_id: string; name: string; sql: string; created_at: number; updated_at: number }
interface HistoryRow { id: number; sql: string; ran_at: number; duration_ms: number | null; row_count: number | null; ok: number }

/** Saved queries and run history, kept in the app database next to the connections. */
export class QueryLibrary {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  list(connectionId: string): { saved: SavedQuery[]; history: QueryHistoryItem[] } {
    const saved = this.db.prepare('SELECT * FROM oxequery_saved_queries WHERE connection_id = ? ORDER BY name COLLATE NOCASE').all(connectionId) as SavedRow[]
    const history = this.db.prepare('SELECT id, sql, ran_at, duration_ms, row_count, ok FROM oxequery_query_history WHERE connection_id = ? ORDER BY ran_at DESC, id DESC LIMIT ?').all(connectionId, HISTORY_LIMIT) as HistoryRow[]
    return {
      saved: saved.map(row => ({ id: row.id, connectionId: row.connection_id, name: row.name, sql: row.sql, createdAt: row.created_at, updatedAt: row.updated_at })),
      history: history.map(row => ({ id: row.id, sql: row.sql, ranAt: row.ran_at, durationMs: row.duration_ms, rows: row.row_count, ok: row.ok === 1 }))
    }
  }

  save(input: { connectionId: string; id?: string; name: string; sql: string }): SavedQuery {
    const name = input.name.trim()
    if (!name || name.length > 120) throw new LibraryInputError('Give the query a name of up to 120 characters.')
    if (!input.sql.trim() || input.sql.length > MAX_SAVED_SQL) throw new LibraryInputError('The query is empty or too large to save.')
    const now = this.now()
    if (input.id) {
      const result = this.db.prepare('UPDATE oxequery_saved_queries SET name = ?, sql = ?, updated_at = ? WHERE id = ? AND connection_id = ?').run(name, input.sql, now, input.id, input.connectionId)
      if (result.changes === 0) throw new LibraryInputError('That saved query no longer exists.')
      const row = this.db.prepare('SELECT * FROM oxequery_saved_queries WHERE id = ?').get(input.id) as SavedRow
      return { id: row.id, connectionId: row.connection_id, name: row.name, sql: row.sql, createdAt: row.created_at, updatedAt: row.updated_at }
    }
    const count = (this.db.prepare('SELECT count(*) AS n FROM oxequery_saved_queries WHERE connection_id = ?').get(input.connectionId) as { n: number }).n
    if (count >= MAX_SAVED) throw new LibraryInputError(`A connection can keep up to ${MAX_SAVED} saved queries.`)
    const id = randomUUID()
    this.db.prepare('INSERT INTO oxequery_saved_queries (id, connection_id, name, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.connectionId, name, input.sql, now, now)
    return { id, connectionId: input.connectionId, name, sql: input.sql, createdAt: now, updatedAt: now }
  }

  remove(connectionId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM oxequery_saved_queries WHERE id = ? AND connection_id = ?').run(id, connectionId).changes > 0
  }

  /** One row per distinct statement; the newest run replaces the older one. Never throws: history must not break a query. */
  record(connectionId: string, entry: { sql: string; durationMs: number | null; rows: number | null; ok: boolean }): void {
    const sql = entry.sql.trim()
    if (!sql || sql.length > MAX_HISTORY_SQL) return
    try {
      const now = this.now()
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM oxequery_query_history WHERE connection_id = ? AND sql = ?').run(connectionId, sql)
        this.db.prepare('INSERT INTO oxequery_query_history (connection_id, sql, ran_at, duration_ms, row_count, ok) VALUES (?, ?, ?, ?, ?, ?)')
          .run(connectionId, sql, now, entry.durationMs, entry.rows, entry.ok ? 1 : 0)
        this.db.prepare('DELETE FROM oxequery_query_history WHERE connection_id = ? AND ran_at < ?').run(connectionId, now - HISTORY_DAYS * 86_400_000)
        this.db.prepare(`DELETE FROM oxequery_query_history WHERE connection_id = ? AND id NOT IN
          (SELECT id FROM oxequery_query_history WHERE connection_id = ? ORDER BY ran_at DESC, id DESC LIMIT ?)`).run(connectionId, connectionId, HISTORY_LIMIT)
      })()
    } catch { /* history is a convenience */ }
  }

  clearHistory(connectionId: string): number {
    return this.db.prepare('DELETE FROM oxequery_query_history WHERE connection_id = ?').run(connectionId).changes
  }
}
