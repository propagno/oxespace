import type { AppDatabase } from '../../db'
import type { AgentKey, AgentKind } from '../../../../shared/types/agents'

/** At most this many marks are kept; the oldest go first (CCR #513). */
export const AGENT_SEEN_LIMIT = 2000

const SOURCE_TABLES: Partial<Record<AgentKind, string>> = {
  thread: 'SELECT id FROM conversation_threads',
  delegation: 'SELECT id FROM delegations',
  work: 'SELECT id FROM work_runs'
}

const key = (kind: AgentKind, id: string) => `${kind}\u0000${id}`

/**
 * S7.1 · When the person last looked at each agent (spec §3.4, migration 091), so "finished" means "finished since you
 * looked" and survives a restart. A mark leaves with its source; a pane's mark stays, since pane ids outlive its agent.
 */
export class AgentSeenStore {
  constructor(private readonly db: AppDatabase) {
    this.forgetGone()
  }

  all(): Map<string, number> {
    const rows = this.db.prepare('SELECT kind, id, seen_at FROM agent_seen').all() as { kind: AgentKind; id: string; seen_at: number }[]
    return new Map(rows.map(row => [key(row.kind, row.id), row.seen_at]))
  }

  mark(agent: AgentKey, at: number): void {
    this.db.prepare('INSERT INTO agent_seen (kind, id, seen_at) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)')
      .run(agent.kind, agent.id, at)
    this.db.prepare('DELETE FROM agent_seen WHERE rowid IN (SELECT rowid FROM agent_seen ORDER BY seen_at DESC LIMIT -1 OFFSET ?)').run(AGENT_SEEN_LIMIT)
  }

  /** Marks whose conversation, delegation or work run no longer exists. */
  forgetGone(): void {
    for (const [kind, ids] of Object.entries(SOURCE_TABLES)) {
      this.db.prepare(`DELETE FROM agent_seen WHERE kind = ? AND id NOT IN (${ids})`).run(kind)
    }
  }

  static key = key
}
