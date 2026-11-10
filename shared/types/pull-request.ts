/**
 * A60 (1.5.0, F4): the Pull request tab reads one shape for a GitHub remote and an Azure DevOps (cloud) remote.
 * Votes and check states are values; the window words them per provider.
 */
export type PrProviderKind = 'github' | 'azure' | 'none'
export type PrCliState = 'ok' | 'missing' | 'signed-out'
export type PrState = 'open' | 'merged' | 'closed'
export type PrCheckState = 'pass' | 'running' | 'fail' | 'skipped'
/** GitHub: approved, changes-requested, commented, review-requested. Azure: approved, approved-with-suggestions, no-vote, waiting-for-author, rejected. */
export type PrVote =
  | 'approved' | 'changes-requested' | 'commented' | 'review-requested'
  | 'approved-with-suggestions' | 'no-vote' | 'waiting-for-author' | 'rejected'

export interface PullRequestCheck {
  name: string
  state: PrCheckState
  /** Seconds, or null while it runs or when the provider gives no times. */
  duration: number | null
}

export interface PullRequestReviewer { name: string; vote: PrVote }
export interface PullRequestWorkItem { id: number; url: string }

export interface PullRequestInfo {
  number: number
  title: string
  state: PrState
  draft: boolean
  head: string
  base: string
  url: string
  workItems: PullRequestWorkItem[]
  checks: PullRequestCheck[]
  reviewers: PullRequestReviewer[]
}

export interface PullRequestState {
  provider: PrProviderKind
  cli: PrCliState
  /** null: the CLI works and the branch has no pull request. Absent: the provider is none or the CLI cannot answer. */
  pr?: PullRequestInfo | null
}

export interface PullRequestStateInput { rootPath: string; branch: string }
export interface PullRequestMergedInput { rootPath: string; branch: string; base: string }

/** Merged by the provider first (a squash merge counts); `git` is only the fallback and cannot see squash merges. */
export interface PullRequestMerged { by: 'provider' | 'git'; value: boolean; prNumber?: number }

export interface PullRequestApi {
  state(input: PullRequestStateInput): Promise<PullRequestState>
}
