import type { AppDatabase } from '../../db'
import type { OxeQueryAuditEntry } from '../../../../shared/types/oxequery'

export const AUDIT_RETENTION_DAYS = 90

export interface AuditRecord {
  actor: string
  connectionId?: string
  connectionName?: string
  engine?: string
  environment?: string
  tool: string
  textHash?: string
  /** Already redacted by the caller. */
  text?: string
  decision: 'auto' | 'approved' | 'approved-session' | 'denied' | 'refused' | 'pending'
  outcome: 'ok' | 'error' | 'skipped'
  rows?: number
  durationMs?: number
  errorCode?: string
}

interface Row {
  id: number; ts: number; actor: string; connection_id: string | null; connection_name: string | null; engine: string | null; environment: string | null
  tool: string; text_hash: string | null; text: string | null; decision: string; outcome: string; row_count: number | null; duration_ms: number | null; error_code: string | null
}

/** Where a page of the audit ends: the next page starts strictly older than this (ts, then id). */
export interface AuditPosition { ts: number; id: number }

/**
 * Who acted, by name: main sets `resolve` at startup (conversation titles, pane names). The service uses it when it
 * was not given its own `actorLabel` option.
 */
export const auditActorNames: { resolve?: (actor: string) => string | null | undefined } = {}

const clampLimit = (limit: number | undefined): number => Math.max(1, Math.min(Math.trunc(limit ?? 100) || 100, 500))

/** Append-only. Writing must never break the operation being recorded. */
export class AuditLog {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  record(entry: AuditRecord): void {
    try {
      this.db.prepare(`INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text_hash, text, decision, outcome, row_count, duration_ms, error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        this.now(), entry.actor.slice(0, 200), entry.connectionId ?? null, entry.connectionName?.slice(0, 200) ?? null, entry.engine ?? null, entry.environment ?? null,
        entry.tool, entry.textHash ?? null, entry.text?.slice(0, 2000) ?? null, entry.decision, entry.outcome, entry.rows ?? null, entry.durationMs ?? null, entry.errorCode ?? null)
    } catch { /* the trail is best effort; the operation has already been decided */ }
  }

  list(options: { connectionId?: string; limit?: number } = {}): OxeQueryAuditEntry[] {
    return this.select(options, clampLimit(options.limit)).map(row => this.entry(row))
  }

  /** Newest first, `limit` at a time; `next` is where the following page starts, null when nothing older is left. */
  page(options: { connectionId?: string; limit?: number; before?: AuditPosition } = {}): { entries: OxeQueryAuditEntry[]; next: AuditPosition | null } {
    const limit = clampLimit(options.limit)
    const rows = this.select(options, limit + 1)
    const kept = rows.slice(0, limit)
    const last = kept.at(-1)
    return { entries: kept.map(row => this.entry(row)), next: rows.length > limit && last ? { ts: last.ts, id: last.id } : null }
  }

  private select(options: { connectionId?: string; before?: AuditPosition }, limit: number): Row[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (options.connectionId) { where.push('connection_id = ?'); params.push(options.connectionId) }
    if (options.before) { where.push('(ts < ? OR (ts = ? AND id < ?))'); params.push(options.before.ts, options.before.ts, options.before.id) }
    const sql = `SELECT * FROM oxequery_audit${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, id DESC LIMIT ?`
    return this.db.prepare(sql).all(...params, limit) as Row[]
  }

  private entry(row: Row): OxeQueryAuditEntry {
    return ({
      id: row.id, ts: row.ts, actor: row.actor, connectionId: row.connection_id, connectionName: row.connection_name, engine: row.engine, environment: row.environment,
      tool: row.tool, textHash: row.text_hash, text: row.text, decision: row.decision, outcome: row.outcome, rows: row.row_count, durationMs: row.duration_ms, errorCode: row.error_code
    })
  }

  /** Old entries are the only thing ever deleted. */
  prune(days = AUDIT_RETENTION_DAYS): number {
    try { return this.db.prepare('DELETE FROM oxequery_audit WHERE ts < ?').run(this.now() - days * 86_400_000).changes } catch { return 0 }
  }
}

/** PQ-07·16: names who acted from the app's own database, a conversation by its title and a pane by its name. */
export function wireAuditActorNames(db: { prepare(sql: string): { get(...params: unknown[]): unknown } }): void {
  const threadTitle = db.prepare("SELECT json_extract(data_json, '$.title') AS title FROM conversation_threads WHERE id = ?")
  const paneName = db.prepare('SELECT display_name, agent_name FROM panes WHERE id = ?')
  auditActorNames.resolve = actor => {
    const colon = actor.indexOf(':')
    const kind = actor.slice(0, colon), id = actor.slice(colon + 1)
    if (!id) return null
    if (kind === 'thread') {
      const title = (threadTitle.get(id) as { title: unknown } | undefined)?.title
      return typeof title === 'string' ? title : null
    }
    if (kind === 'pane') {
      const pane = paneName.get(id) as { display_name: string | null; agent_name: string | null } | undefined
      return pane ? pane.display_name || pane.agent_name || null : null
    }
    return null
  }
}
