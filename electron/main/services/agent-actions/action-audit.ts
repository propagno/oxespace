import type { AppDatabase } from '../../db'

export const ACTION_AUDIT_RETENTION_DAYS = 90

export type ActionLevel = 'read' | 'write' | 'confirm'

export interface ActionAuditRecord {
  actor: string
  workspaceId?: string | null
  tool: string
  action: string
  level: ActionLevel
  textHash?: string
  /** What the person saw or what was asked, already free of secrets. */
  text?: string
  decision: 'auto' | 'approved' | 'denied' | 'refused' | 'pending'
  outcome: 'ok' | 'error' | 'skipped'
  durationMs?: number
  errorCode?: string
}

export interface ActionAuditEntry extends ActionAuditRecord { id: number; ts: number }

interface Row {
  id: number; ts: number; actor: string; workspace_id: string | null; tool: string; action: string; level: string
  text_hash: string | null; text: string | null; decision: string; outcome: string; duration_ms: number | null; error_code: string | null
}

/** Append-only. Writing must never break the operation being recorded. */
export class ActionAudit {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  record(entry: ActionAuditRecord): void {
    try {
      this.db.prepare(`INSERT INTO agent_action_audit (ts, actor, workspace_id, tool, action, level, text_hash, text, decision, outcome, duration_ms, error_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        this.now(), entry.actor.slice(0, 200), entry.workspaceId ?? null, entry.tool, entry.action.slice(0, 64), entry.level,
        entry.textHash ?? null, entry.text?.slice(0, 2000) ?? null, entry.decision, entry.outcome, entry.durationMs ?? null, entry.errorCode ?? null)
    } catch { /* the trail is best effort; the operation has already been decided */ }
  }

  list(options: { limit?: number } = {}): ActionAuditEntry[] {
    const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100) || 100, 500))
    const rows = this.db.prepare('SELECT * FROM agent_action_audit ORDER BY ts DESC, id DESC LIMIT ?').all(limit) as Row[]
    return rows.map(row => ({
      id: row.id, ts: row.ts, actor: row.actor, workspaceId: row.workspace_id, tool: row.tool, action: row.action, level: row.level as ActionLevel,
      textHash: row.text_hash ?? undefined, text: row.text ?? undefined, decision: row.decision as ActionAuditRecord['decision'],
      outcome: row.outcome as ActionAuditRecord['outcome'], durationMs: row.duration_ms ?? undefined, errorCode: row.error_code ?? undefined
    }))
  }

  /** Old entries are the only thing ever deleted. */
  prune(days = ACTION_AUDIT_RETENTION_DAYS): number {
    try { return this.db.prepare('DELETE FROM agent_action_audit WHERE ts < ?').run(this.now() - days * 86_400_000).changes } catch { return 0 }
  }
}
