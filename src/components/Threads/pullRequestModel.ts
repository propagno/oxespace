import type { PrCheckState, PrProviderKind, PrVote, PullRequestCheck, PullRequestInfo } from '../../../shared/types/pull-request'

/**
 * FE-P9 (DESIGN U4.6): main sends values (votes, states, check results); the window words them per provider.
 * Pure helpers, so the tab only renders.
 */
export type PrProvider = Exclude<PrProviderKind, 'none'>

/** window.oxe.thread.agentSummary(threadId): null is a source main could not read, listed in failedSources. */
export interface AgentSummary {
  files: number | null
  databases: number | null
  http: number | null
  httpProduction: number | null
  containers: number | null
  approvals: number | null
  failedSources: string[]
}

export type VoteKey = 'approved' | 'changesRequested' | 'commented' | 'reviewRequested' | 'approvedWithSuggestions' | 'noVote' | 'waitingForAuthor' | 'rejected'
export type PrStateKey = 'open' | 'draft' | 'merged' | 'closed' | 'completed' | 'abandoned'
export type CheckStateKey = Exclude<PrCheckState, 'skipped'> | 'skipped' | 'notApplicable'

export const VOTE_KEY: Record<PrVote, VoteKey> = {
  approved: 'approved',
  'changes-requested': 'changesRequested',
  commented: 'commented',
  'review-requested': 'reviewRequested',
  'approved-with-suggestions': 'approvedWithSuggestions',
  'no-vote': 'noVote',
  'waiting-for-author': 'waitingForAuthor',
  rejected: 'rejected'
}

/** GitHub: Open, Draft, Merged, Closed. Azure DevOps: Open, Draft, Completed, Abandoned. */
export function prStateKey(provider: PrProvider, pr: Pick<PullRequestInfo, 'state' | 'draft'>): PrStateKey {
  if (pr.state === 'merged') return provider === 'azure' ? 'completed' : 'merged'
  if (pr.state === 'closed') return provider === 'azure' ? 'abandoned' : 'closed'
  return pr.draft ? 'draft' : 'open'
}

/** A skipped check reads Skipped on GitHub and Not applicable on Azure DevOps. */
export function checkStateKey(provider: PrProvider, state: PrCheckState): CheckStateKey {
  if (state === 'skipped') return provider === 'azure' ? 'notApplicable' : 'skipped'
  return state
}

/** 'N of M passed' leaves skipped checks out of both numbers. */
export function checkTally(checks: PullRequestCheck[]): { passed: number; total: number } {
  const counted = checks.filter(check => check.state !== 'skipped')
  return { passed: counted.filter(check => check.state === 'pass').length, total: counted.length }
}

/** Where the CLI is installed from, and the command that signs it in. Commands, not interface text. */
export const INSTALL_URL: Record<PrProvider, string> = {
  github: 'https://cli.github.com/',
  azure: 'https://learn.microsoft.com/cli/azure/install-azure-cli'
}
export const LOGIN_COMMAND: Record<PrProvider, string> = { github: 'gh auth login', azure: 'az login' }

export function workItemLabel(id: number): string {
  return `AB#${id}`
}

export function prNumberLabel(provider: PrProvider, number: number): string {
  return provider === 'azure' ? `!${number}` : `#${number}`
}

export function splitDuration(seconds: number): { minutes: number; seconds: number } {
  const whole = Math.max(0, Math.round(seconds))
  return { minutes: Math.floor(whole / 60), seconds: whole % 60 }
}

export interface SummaryLine { key: 'files' | 'databases' | 'http' | 'httpProduction' | 'containers' | 'approvals'; count: number; production?: number }

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** The counts in order, without zeros and without the sources main could not read. */
export function summaryLines(summary: AgentSummary | null | undefined): SummaryLine[] {
  if (!summary) return []
  const lines: SummaryLine[] = []
  if (positive(summary.files)) lines.push({ key: 'files', count: summary.files })
  if (positive(summary.databases)) lines.push({ key: 'databases', count: summary.databases })
  if (positive(summary.http)) {
    lines.push(positive(summary.httpProduction) ? { key: 'httpProduction', count: summary.http, production: summary.httpProduction } : { key: 'http', count: summary.http })
  }
  if (positive(summary.containers)) lines.push({ key: 'containers', count: summary.containers })
  if (positive(summary.approvals)) lines.push({ key: 'approvals', count: summary.approvals })
  return lines
}

/** Appends the block once: a description that already holds it is returned as it is. */
export function appendOnce(value: string, block: string): string {
  if (!block || value.includes(block)) return value
  const head = value.trimEnd()
  return head ? `${head}\n\n${block}` : block
}
