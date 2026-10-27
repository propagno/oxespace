/**
 * Usage ledger: one row per finished provider turn, so spending survives a
 * deleted conversation and can be summed per day, model, conversation and
 * project. Claude reports an API-equivalent cost; Codex reports tokens only.
 */
import type { AppDatabase } from '../../db'
import type { ThreadProvider, ThreadSnapshot, ThreadTurnUsage, ThreadUsageBucket, ThreadUsageSummary } from '../../../../shared/types/thread'
import type { TurnCost } from './thread-cost'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 366
const MAX_THREADS = 50
const MAX_TURNS = 30

export interface TurnUsageEntry extends TurnCost {
  threadId: string
  projectRoot: string
  provider: ThreadProvider
  model?: string
  at: number
  turnId?: string
  steps?: number
}

/**
 * The turn a cost report belongs to, and the tool calls it made so far: the distinct tools after the message that
 * opened it. (A tool event's own `turnId` is the provider's, not this turn's.)
 */
export function turnSteps(snapshot: ThreadSnapshot): { turnId?: string; steps?: number } {
  const turn = snapshot.turns?.at(-1)
  if (!turn) return {}
  const start = snapshot.events.findIndex(event => event.type === 'message' && event.id === turn.id)
  if (start < 0) return { turnId: turn.id }
  const tools = new Set(snapshot.events.slice(start + 1).flatMap(event => event.type === 'tool' ? [event.id] : []))
  return { turnId: turn.id, steps: tools.size }
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
    this.db.prepare(`INSERT INTO turn_usage (thread_id, project_root, provider, model, at, usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, turn_id, steps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(entry.threadId, entry.projectRoot, entry.provider, entry.model?.slice(0, 200) ?? null, entry.at,
      entry.usd ?? null, count(entry.inputTokens), count(entry.outputTokens), count(entry.cacheReadTokens), count(entry.cacheCreationTokens),
      entry.turnId?.slice(0, 200) ?? null, count(entry.steps))
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
      ...(options.scope === 'thread' ? { turns: this.turns(options.threadId ?? '', since) } : {}),
      byDay: byDay.map(row => bucket(row, 'unknown')),
      byModel: byModel.map(row => bucket(row, 'unknown')),
      byThread: byThread.map(row => ({ ...bucket(row, 'unknown'), label: row.label || 'Deleted conversation' }))
    }
  }

  /** The conversation's latest turns, newest first. */
  private turns(threadId: string, since: number): ThreadTurnUsage[] {
    const rows = this.db.prepare(`SELECT at, model, usd, steps, COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0) AS context,
      COALESCE(output_tokens, 0) AS output FROM turn_usage WHERE thread_id = ? AND at >= ? ORDER BY at DESC, id DESC LIMIT ${MAX_TURNS}`).all(threadId, since) as
      { at: number; model: string | null; usd: number | null; steps: number | null; context: number; output: number }[]
    return rows.map(row => ({ at: row.at, contextTokens: row.context, outputTokens: row.output,
      ...(row.model ? { model: row.model } : {}), ...(row.steps !== null ? { steps: row.steps } : {}), ...(row.usd !== null ? { usd: row.usd } : {}) }))
  }
}
