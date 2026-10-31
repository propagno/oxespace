import type { AppDatabase } from '../../db'
import { AGENTS_LIMITS } from '../../../../shared/types/ipc/agents'

/**
 * S7.1 · When the person last looked at each agent (§3.4), in the app database (`agent_seen`). One row per agent key;
 * a mark never moves backwards (`max`). A source that is gone takes its mark with it, and the table keeps at most
 * `AGENTS_LIMITS.seenKeys` rows, the least recently marked going first.
 */
export class AgentSeenStore {
  constructor(private readonly db: AppDatabase, private readonly limit: number = AGENTS_LIMITS.seenKeys) {}

  /** Every stored mark, for the first read. */
  all(): Map<string, number> {
    const rows = this.db.prepare('SELECT agent_key, seen_at FROM agent_seen').all() as { agent_key: string; seen_at: number }[]
    return new Map(rows.map(row => [row.agent_key, row.seen_at]))
  }

  get(key: string): number | null {
    const row = this.db.prepare('SELECT seen_at FROM agent_seen WHERE agent_key = ?').get(key) as { seen_at: number } | undefined
    return row ? row.seen_at : null
  }

  /** Stores the newer of the two times and returns what is stored. */
  mark(key: string, seenAt: number): number {
    return this.db.transaction((): number => {
      this.db.prepare('INSERT INTO agent_seen (agent_key, seen_at) VALUES (?, ?) ON CONFLICT(agent_key) DO UPDATE SET seen_at = max(seen_at, excluded.seen_at)').run(key, seenAt)
      const count = (this.db.prepare('SELECT COUNT(*) AS value FROM agent_seen').get() as { value: number }).value
      if (count > this.limit) {
        this.db.prepare('DELETE FROM agent_seen WHERE agent_key IN (SELECT agent_key FROM agent_seen WHERE agent_key <> ? ORDER BY seen_at, agent_key LIMIT ?)').run(key, count - this.limit)
      }
      return this.get(key)!
    }).immediate()
  }

  /** The source is gone: its mark goes too. */
  delete(key: string): void {
    this.db.prepare('DELETE FROM agent_seen WHERE agent_key = ?').run(key)
  }
}
