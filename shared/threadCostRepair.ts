import type { ThreadCostReport } from './types/thread'

/**
 * Before 0.17.2 a Claude conversation's cost was the sum of every turn's `total_cost_usd`, a
 * running total for the whole process, so it grew quadratically (US$ 25 935 on one
 * conversation). What the last turn recorded (`lastTurnUsd`) is that running total, which is what
 * the process had really cost by then: a floor for the conversation's cost, and far closer to the
 * truth than the sum. Reports written by the fixed code carry the `claude-result-step` source and
 * are left alone.
 */
export function repairLegacyCost(report: ThreadCostReport | undefined): ThreadCostReport | undefined {
  if (!report || report.source !== 'claude-result') return report
  const floor = report.lastTurnUsd
  if (floor === undefined || !(floor >= 0) || report.totalUsd <= floor) return { ...report, source: 'claude-result-step' }
  return { ...report, totalUsd: floor, source: 'claude-result-step' }
}
