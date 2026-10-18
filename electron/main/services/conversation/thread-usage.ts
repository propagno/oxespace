/**
 * Usage ledger: one row per finished provider turn, so spending survives a
 * deleted conversation and can be summed per day, model, conversation and
 * project. Claude reports an API-equivalent cost; Codex reports tokens only.
 */
import type { AppDatabase } from '../../db'
import type { ThreadProvider, ThreadUsageBucket, ThreadUsageSummary } from '../../../../shared/types/thread'
import type { TurnCost } from './thread-cost'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 366
const MAX_THREADS = 50

export interface TurnUsageEntry extends TurnCost {
  threadId: string
  projectRoot: string
  provider: ThreadProvider
  model?: string
  at: number
}

interface BucketRow { key: string | null; label: string | null; turns: number; priced: number; usd: number | null; input: number | null; output: number | null; cache: number | null }

const count = (value: number | undefined): number | null => value === undefined ? null : Math.round(value)
const bucket = (row: BucketRow, fallback: string): ThreadUsageBucket => ({
  key: row.key ?? fallback, label: row.label || row.key || fallback, turns: row.turns, pricedTurns: row.priced,
  usd: row.usd ?? 0, inputTokens: row.input ?? 0, outputTokens: row.output ?? 0, cacheReadTokens: row.cache ?? 0
})
const SUMS = 'COUNT(*) AS turns, COUNT(u.usd) AS priced, SUM(u.usd) AS usd, SUM(u.input_tokens) AS input, SUM(u.output_tokens) AS output, SUM(u.cache_read_tokens) AS cache'

export class ThreadUsageLedger {
  constructor(private readonly db: AppDatabase) {}

  record(entry: TurnUsageEntry): void {
    this.db.prepare(`INSERT INTO turn_usage (thread_id, project_root, provider, model, at, usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.threadId, entry.projectRoot, entry.provider, entry.model?.slice(0, 200) ?? null, entry.at,
      entry.usd ?? null, count(entry.inputTokens), count(entry.outputTokens), count(entry.cacheReadTokens), count(entry.cacheCreationTokens))
  }

  /** Spending since `days` ago (local days), for one conversation, one project or everything. */
  summary(options: { scope: 'thread' | 'project' | 'all'; threadId?: string; projectRoot?: string; days?: number; now?: number }): ThreadUsageSummary {
    const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(options.days ?? 30)))
    const now = options.now ?? Date.now()
    const start = new Date(now - (days - 1) * DAY_MS); start.setHours(0, 0, 0, 0)
    const since = start.getTime()
    const filter = options.scope === 'thread' ? 'AND u.thread_id = @threadId' : options.scope === 'project' ? 'AND u.project_root = @projectRoot' : ''
    const params = { since, threadId: options.threadId ?? '', projectRoot: options.projectRoot ?? '' }
    const where = `FROM turn_usage u WHERE u.at >= @since ${filter}`
    const total = this.db.prepare(`SELECT 'total' AS key, 'Total' AS label, ${SUMS} ${where}`).get(params) as BucketRow
    const byDay = this.db.prepare(`SELECT date(u.at / 1000, 'unixepoch', 'localtime') AS key, NULL AS label, ${SUMS} ${where} GROUP BY key ORDER BY key DESC`).all(params) as BucketRow[]
    const byModel = this.db.prepare(`SELECT u.provider || ':' || COALESCE(u.model, '') AS key, u.provider || COALESCE(' · ' || u.model, '') AS label, ${SUMS} ${where} GROUP BY u.provider, u.model ORDER BY usd DESC, turns DESC`).all(params) as BucketRow[]
    const byThread = this.db.prepare(`SELECT u.thread_id AS key, json_extract(t.data_json, '$.title') AS label, ${SUMS} ${where.replace('FROM turn_usage u', 'FROM turn_usage u LEFT JOIN conversation_threads t ON t.id = u.thread_id')} GROUP BY u.thread_id ORDER BY usd DESC, turns DESC LIMIT ${MAX_THREADS}`).all(params) as BucketRow[]
    return {
      scope: options.scope, since, total: bucket(total, 'total'),
      byDay: byDay.map(row => bucket(row, 'unknown')),
      byModel: byModel.map(row => bucket(row, 'unknown')),
      byThread: byThread.map(row => ({ ...bucket(row, 'unknown'), label: row.label || 'Deleted conversation' }))
    }
  }
}
