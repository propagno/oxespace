import type { AppDatabase } from '../db'
import { activityRefusal, mergeActivityEntries, normalizeActivityEntries, normalizeActivityKey, normalizeActivitySeen } from '../../../shared/activity'
import type { ActivityEntry, ActivityRecent, ActivityRecordResult, ActivityResolveResult, ActivitySeenResult, ActivityTarget } from '../../../shared/types/activity'

interface Row { source: ActivityEntry['source']; id: string; kind: ActivityEntry['kind']; target_json: string; title: string; detail: string | null; at: number }

/**
 * F30 · The activity center's entries and the time the person last looked at them, in the app database.
 * Every input goes through the shared validator (shared/activity.ts) first; a refused call changes nothing,
 * and an accepted one rewrites the whole list (at most 200 rows) in one transaction.
 */
export class ActivityStore {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  recent(): ActivityRecent {
    return { entries: this.entries(), lastSeenAt: this.lastSeenAt() }
  }

  record(input: unknown): ActivityRecordResult {
    const checked = normalizeActivityEntries(input, this.now())
    if (!checked.ok) return checked
    return this.db.transaction((): ActivityRecordResult => {
      const merged = mergeActivityEntries(this.entries(), checked.entries)
      if (merged.recorded > 0) {
        this.db.prepare('DELETE FROM activity_entries').run()
        const insert = this.db.prepare('INSERT INTO activity_entries (source, id, kind, target_json, title, detail, at, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        merged.entries.forEach((item, position) => insert.run(item.source, item.id, item.kind, JSON.stringify(item.target), item.title, item.detail ?? null, item.at, position))
      }
      return { ok: true, recorded: merged.recorded, ignored: merged.ignored }
    }).immediate()
  }

  /** Drops one entry by its key; the others keep their order. Removing one that is not there is not an error. */
  resolve(input: unknown): ActivityResolveResult {
    const checked = normalizeActivityKey(input)
    if (!checked.ok) return checked
    const { source, id, kind } = checked.key
    return this.db.transaction((): ActivityResolveResult => ({
      ok: true, removed: this.db.prepare('DELETE FROM activity_entries WHERE source = ? AND id = ? AND kind = ?').run(source, id, kind).changes > 0
    })).immediate()
  }

  seen(input: unknown): ActivitySeenResult {
    const checked = normalizeActivitySeen(input, this.now())
    if (!checked.ok) return checked
    return this.db.transaction((): ActivitySeenResult => {
      this.db.prepare('INSERT INTO activity_state (singleton, last_seen_at) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET last_seen_at = max(last_seen_at, excluded.last_seen_at)').run(checked.at)
      const lastSeenAt = this.lastSeenAt()
      return lastSeenAt === null ? activityRefusal('invalid') : { ok: true, lastSeenAt }
    }).immediate()
  }

  private lastSeenAt(): number | null {
    return (this.db.prepare('SELECT last_seen_at FROM activity_state WHERE singleton = 1').get() as { last_seen_at: number } | undefined)?.last_seen_at ?? null
  }

  /** Newest first. Only the validator writes these rows; one that no longer parses is left out rather than sent. */
  private entries(): ActivityEntry[] {
    const rows = this.db.prepare('SELECT source, id, kind, target_json, title, detail, at FROM activity_entries ORDER BY position').all() as Row[]
    return rows.flatMap((row): ActivityEntry[] => {
      let target: ActivityTarget
      try { target = JSON.parse(row.target_json) as ActivityTarget } catch { return [] }
      return [{ source: row.source, id: row.id, kind: row.kind, target, title: row.title, ...(row.detail === null ? {} : { detail: row.detail }), at: row.at }]
    })
  }
}
