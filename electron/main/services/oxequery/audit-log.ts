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
    const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100) || 100, 500))
    const rows = (options.connectionId
      ? this.db.prepare('SELECT * FROM oxequery_audit WHERE connection_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(options.connectionId, limit)
      : this.db.prepare('SELECT * FROM oxequery_audit ORDER BY ts DESC, id DESC LIMIT ?').all(limit)) as Row[]
    return rows.map(row => ({
      id: row.id, ts: row.ts, actor: row.actor, connectionId: row.connection_id, connectionName: row.connection_name, engine: row.engine, environment: row.environment,
      tool: row.tool, textHash: row.text_hash, text: row.text, decision: row.decision, outcome: row.outcome, rows: row.row_count, durationMs: row.duration_ms, errorCode: row.error_code
    }))
  }

  /** Old entries are the only thing ever deleted. */
  prune(days = AUDIT_RETENTION_DAYS): number {
    try { return this.db.prepare('DELETE FROM oxequery_audit WHERE ts < ?').run(this.now() - days * 86_400_000).changes } catch { return 0 }
  }
}
