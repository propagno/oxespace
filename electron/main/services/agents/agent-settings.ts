import type { AppDatabase } from '../../db'
import { AGENT_NUDGE_DEFAULT_MS, readNudgeChoice, type AgentNudgeChoice } from '../../../../shared/agents/agentTimers'

/**
 * S7.1 · The needs-you nudge delay (§5.10), kept by main in `agent_settings`. Reading never fails: a missing or foreign
 * value is the 2 min default. Writing takes only one of `AGENT_NUDGE_CHOICES_MS` and throws on anything else, storing
 * nothing (as the other per-feature settings do).
 */
const KEY = 'nudge_after_ms'

export class AgentSettingsStore {
  constructor(private readonly db: AppDatabase) {}

  nudgeAfterMs(): AgentNudgeChoice {
    try {
      const row = this.db.prepare('SELECT value FROM agent_settings WHERE key = ?').get(KEY) as { value: string } | undefined
      if (!row) return AGENT_NUDGE_DEFAULT_MS
      const read = readNudgeChoice(row.value === 'off' ? null : Number(row.value))
      return read.ok ? read.afterMs : AGENT_NUDGE_DEFAULT_MS
    } catch { return AGENT_NUDGE_DEFAULT_MS }
  }

  setNudgeAfterMs(value: unknown): AgentNudgeChoice {
    const read = readNudgeChoice(value)
    if (!read.ok) throw new Error('Choose off, 1, 2 or 5 minutes')
    this.db.prepare('INSERT INTO agent_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(KEY, read.afterMs === null ? 'off' : String(read.afterMs), Date.now())
    return read.afterMs
  }
}
