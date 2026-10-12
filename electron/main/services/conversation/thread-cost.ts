/**
 * Per-turn cost reported by Claude in its `result` frame (`total_cost_usd` and
 * `usage`). For a subscription account the figure is the API-equivalent value,
 * not money charged, so it is presented as an estimate. Codex reports tokens
 * only and is not covered here.
 */
import type { ThreadCostReport } from '../../../../shared/types/thread'

export interface TurnCost {
  usd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

const amount = (value: unknown, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined

/** Null when the frame carries nothing worth recording. */
export function readClaudeResultCost(event: Record<string, unknown>): TurnCost | null {
  const usage = event.usage && typeof event.usage === 'object' ? (event.usage as Record<string, unknown>) : {}
  const cost: TurnCost = {
    usd: amount(event.total_cost_usd, 10_000),
    inputTokens: amount(usage.input_tokens, 1e9),
    outputTokens: amount(usage.output_tokens, 1e9),
    cacheReadTokens: amount(usage.cache_read_input_tokens, 1e9),
    cacheCreationTokens: amount(usage.cache_creation_input_tokens, 1e9)
  }
  return Object.values(cost).some(value => value !== undefined) ? cost : null
}

const sum = (previous: number | undefined, delta: number | undefined): number | undefined =>
  previous === undefined && delta === undefined ? undefined : (previous ?? 0) + (delta ?? 0)

/**
 * `usd` from the CLI is cumulative for the *process* in some versions and per
 * turn in others; it is treated as per-turn here, which is what `result`
 * documents. A turn without a cost still counts as a turn.
 */
export function addTurnCost(previous: ThreadCostReport | undefined, turn: TurnCost, now: number): ThreadCostReport {
  return {
    totalUsd: (previous?.totalUsd ?? 0) + (turn.usd ?? 0),
    turns: (previous?.turns ?? 0) + 1,
    ...(turn.usd !== undefined ? { lastTurnUsd: turn.usd } : previous?.lastTurnUsd !== undefined ? { lastTurnUsd: previous.lastTurnUsd } : {}),
    ...(sum(previous?.inputTokens, turn.inputTokens) !== undefined ? { inputTokens: sum(previous?.inputTokens, turn.inputTokens) } : {}),
    ...(sum(previous?.outputTokens, turn.outputTokens) !== undefined ? { outputTokens: sum(previous?.outputTokens, turn.outputTokens) } : {}),
    ...(sum(previous?.cacheReadTokens, turn.cacheReadTokens) !== undefined ? { cacheReadTokens: sum(previous?.cacheReadTokens, turn.cacheReadTokens) } : {}),
    updatedAt: now,
    source: 'claude-result'
  }
}
