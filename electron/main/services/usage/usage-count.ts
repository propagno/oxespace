import { writeFileSync } from 'node:fs'
import {
  isFeatureUsageKey,
  type FeatureUsageExport,
  type FeatureUsageKey,
  type FeatureUsageRow,
  type FeatureUsageStatus
} from '../../../../shared/feature-usage'
import type { AppDatabase } from '../../db'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30

export interface UsageCountOptions {
  now?: () => number
}

interface SettingsRow {
  enabled: number
  since: number | null
}

interface AggregatedRow {
  feature: string
  uses: number
  lastUsed: number
}

/**
 * Local-only feature usage counter (1.5.0 A65 / N7).
 * Off by default on fresh and upgraded profiles; counts only keys in FEATURE_USAGE_KEYS per UTC day
 * over a rolling 30-day window; exports JSON to a user-chosen path; never makes network calls.
 */
export class UsageCount {
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly db: AppDatabase,
    options: UsageCountOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now())
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  status(): FeatureUsageStatus {
    const settings = this.readSettings()
    if (!settings || settings.enabled !== 1) {
      return { enabled: false, since: null, rows: [] }
    }
    const cutoffDay = this.dayOf(this.now()) - (WINDOW_DAYS - 1)
    const rawRows = this.db
      .prepare(
        `SELECT feature, SUM(uses) AS uses, MAX(last_used) AS lastUsed
         FROM feature_usage_days
         WHERE day >= ?
         GROUP BY feature
         ORDER BY uses DESC, lastUsed DESC, feature ASC`
      )
      .all(cutoffDay) as AggregatedRow[]

    const rows: FeatureUsageRow[] = []
    for (const row of rawRows) {
      if (isFeatureUsageKey(row.feature)) {
        rows.push({
          feature: row.feature,
          uses: Number(row.uses),
          lastUsed: Number(row.lastUsed)
        })
      }
    }
    return {
      enabled: true,
      since: settings.since ?? this.now(),
      rows
    }
  }

  setEnabled(on: boolean, options?: { clear?: boolean }): FeatureUsageStatus {
    const timestamp = this.now()
    const clearRows = Boolean(options?.clear)
    this.db.transaction(() => {
      const existing = this.readSettings()
      if (on) {
        const since = clearRows ? timestamp : (existing?.since ?? timestamp)
        if (clearRows) {
          this.db.prepare('DELETE FROM feature_usage_days').run()
        }
        this.db
          .prepare(
            `INSERT INTO feature_usage_settings (id, enabled, since)
             VALUES (1, 1, ?)
             ON CONFLICT(id) DO UPDATE SET enabled = 1, since = excluded.since`
          )
          .run(since)
      } else {
        if (clearRows) {
          this.db.prepare('DELETE FROM feature_usage_days').run()
        }
        const since = clearRows ? null : (existing?.since ?? null)
        this.db
          .prepare(
            `INSERT INTO feature_usage_settings (id, enabled, since)
             VALUES (1, 0, ?)
             ON CONFLICT(id) DO UPDATE SET enabled = 0, since = excluded.since`
          )
          .run(since)
      }
    })()
    this.emitChanged()
    return this.status()
  }

  record(feature: FeatureUsageKey): void {
    if (!isFeatureUsageKey(feature)) return
    const settings = this.readSettings()
    if (!settings || settings.enabled !== 1) return

    const timestamp = this.now()
    const day = this.dayOf(timestamp)
    const pruneBefore = day - WINDOW_DAYS
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO feature_usage_days (feature, day, uses, last_used)
           VALUES (?, ?, 1, ?)
           ON CONFLICT(feature, day) DO UPDATE SET
             uses = uses + 1,
             last_used = MAX(last_used, excluded.last_used)`
        )
        .run(feature, day, timestamp)
      this.db.prepare('DELETE FROM feature_usage_days WHERE day < ?').run(pruneBefore)
    })()
    this.emitChanged()
  }

  export(filePath: string): string {
    const current = this.status()
    const payload: FeatureUsageExport = {
      exportedAt: this.now(),
      since: current.since,
      rows: current.rows
    }
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return filePath
  }

  clear(): FeatureUsageStatus {
    const timestamp = this.now()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM feature_usage_days').run()
      const existing = this.readSettings()
      if (existing && existing.enabled === 1) {
        this.db.prepare('UPDATE feature_usage_settings SET since = ? WHERE id = 1').run(timestamp)
      } else if (existing) {
        this.db.prepare('UPDATE feature_usage_settings SET since = NULL WHERE id = 1').run()
      }
    })()
    this.emitChanged()
    return this.status()
  }

  private readSettings(): SettingsRow | undefined {
    return this.db
      .prepare('SELECT enabled, since FROM feature_usage_settings WHERE id = 1')
      .get() as SettingsRow | undefined
  }

  private dayOf(timestamp: number): number {
    return Math.floor(timestamp / DAY_MS)
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
