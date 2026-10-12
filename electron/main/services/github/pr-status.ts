import type { GitHubCheckState, GitHubPrCheck, GitHubPrStatus } from '../../../../shared/types/github'

const str = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null

function checkState(item: Record<string, unknown>): GitHubCheckState {
  // StatusContext carries `state`; CheckRun carries `status` + `conclusion`.
  const raw = String(item.state ?? (item.status === 'COMPLETED' ? item.conclusion : item.status ?? '')).toUpperCase()
  if (['SUCCESS', 'PASS'].includes(raw)) return 'success'
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED'].includes(raw)) return 'failure'
  if (['NEUTRAL', 'SKIPPED', 'STALE'].includes(raw)) return 'neutral'
  return 'pending'
}

/** Parses `gh pr view --json ...`. Returns null for anything that is not a pull request. */
export function parsePullRequestStatus(raw: string): GitHubPrStatus | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  const number = Number(data.number)
  if (!Number.isInteger(number) || number <= 0) return null
  const rollup = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : []
  const checks: GitHubPrCheck[] = rollup
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => ({
      name: str(item.name) ?? str(item.context) ?? 'Check',
      workflow: str(item.workflowName),
      state: checkState(item),
      url: str(item.detailsUrl) ?? str(item.targetUrl)
    }))
  const state = String(data.state ?? '').toUpperCase()
  return {
    number,
    title: str(data.title) ?? `Pull request #${number}`,
    state: state === 'MERGED' ? 'MERGED' : state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    isDraft: data.isDraft === true,
    url: str(data.url),
    headRefName: str(data.headRefName),
    baseRefName: str(data.baseRefName),
    mergeable: str(data.mergeable),
    reviewDecision: str(data.reviewDecision),
    autoMerge: Boolean(data.autoMergeRequest),
    checks
  }
}

/** Counts used by the status bar summary. */
export function summarizeChecks(checks: GitHubPrCheck[]): { success: number; failure: number; pending: number; neutral: number } {
  const total = { success: 0, failure: 0, pending: 0, neutral: 0 }
  for (const check of checks) total[check.state] += 1
  return total
}
