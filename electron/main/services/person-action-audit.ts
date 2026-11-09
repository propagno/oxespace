import type { AppDatabase } from '../db'

export type PersonAction = 'place-read' | 'place-switch-back' | 'place-undo' | 'place-restore' | 'place-discard' | 'worktree-remove' | 'branch-delete'
export type PersonActionOutcome = 'ok' | 'refused' | 'error'
export interface PersonActionRecord {
  action: PersonAction
  threadId?: string
  placeId?: string
  /** A path or a branch name: never file content. */
  target: string
  outcome: PersonActionOutcome
  code?: string
}
export interface PersonActionEntry extends PersonActionRecord { id: number; ts: number; actor: string }

/**
 * SECURITY S5: the append-only trail of what a person did from the window (migration 095). Auditing never
 * interrupts the action it describes, so a failed write is dropped.
 */
export class PersonActionAudit {
  constructor(private readonly db: AppDatabase) {}

  record(entry: PersonActionRecord): void {
    try {
      this.db.prepare(`INSERT INTO person_action_audit (ts, actor, action, thread_id, place_id, target, outcome, code)
        VALUES (?, 'person', ?, ?, ?, ?, ?, ?)`)
        .run(Date.now(), entry.action, entry.threadId ?? null, entry.placeId ?? null, entry.target.slice(0, 4096), entry.outcome, entry.code?.slice(0, 120) ?? null)
    } catch { /* best effort */ }
  }

  list(options: { limit?: number } = {}): PersonActionEntry[] {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000))
    const rows = this.db.prepare('SELECT id, ts, actor, action, thread_id, place_id, target, outcome, code FROM person_action_audit ORDER BY id DESC LIMIT ?').all(limit) as Array<{ id: number; ts: number; actor: string; action: PersonAction; thread_id: string | null; place_id: string | null; target: string; outcome: PersonActionOutcome; code: string | null }>
    return rows.map(row => ({ id: row.id, ts: row.ts, actor: row.actor, action: row.action, target: row.target, outcome: row.outcome,
      ...(row.thread_id ? { threadId: row.thread_id } : {}), ...(row.place_id ? { placeId: row.place_id } : {}), ...(row.code ? { code: row.code } : {}) }))
  }
}
