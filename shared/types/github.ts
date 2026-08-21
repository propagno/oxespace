export type GitHubPanelTab = 'status' | 'checkpoints' | 'repos' | 'branches' | 'prs' | 'commits' | 'releases' | 'actions' | 'settings'

export interface GitHubWorkspaceInput {
  workspaceId: string
  rootPath: string
}

export interface GitHubCliStatus {
  available: boolean
  authenticated: boolean
  user: string | null
  host: string | null
  message: string | null
  path?: string | null
}

export interface GitHubRepositorySummary {
  owner: string | null
  name: string | null
  fullName: string | null
  url: string | null
  isPrivate: boolean | null
  defaultBranch: string | null
  remoteName: string | null
  remoteUrl: string | null
  detected: boolean
}

export interface GitHubWorkspaceStatus {
  cli: GitHubCliStatus
  repository: GitHubRepositorySummary
  isGitRepository: boolean
  branch: string | null
  lastCommit: string | null
  lastCommitRelative: string | null
  lastPushRelative: string | null
  staged: number
  modified: number
  untracked: number
  ahead: number
  behind: number
  hasUncommittedChanges: boolean
  changes: GitHubFileChange[]
}

export interface GitHubFileChange {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  renamed: boolean
  deleted: boolean
}

export interface GitHubBranch {
  name: string
  current: boolean
  remote: boolean
  sha?: string
  isProtected?: boolean
}

export interface GitHubWorktree {
  /** Absolute filesystem path of the worktree (its `cwd`). */
  path: string
  /** Short branch name checked out, or null when detached HEAD. */
  branch: string | null
  /** Last commit hash on this worktree. */
  head: string | null
  /** True when this is the main worktree (the original clone). */
  isMain: boolean
  /** True when the worktree is locked (git worktree lock). */
  locked: boolean
  /** True when the worktree path no longer exists on disk. */
  prunable: boolean
}

export interface GitHubCreateWorktreeInput {
  rootPath: string
  /** Branch name to check out (existing or new). */
  branch: string
  /** Filesystem path where the worktree should live. If relative, resolved next to rootPath. */
  path: string
  /** When true, creates a new branch with `git worktree add -b`. */
  createBranch?: boolean
  /**
   * Start point for the new branch (`origin/main`, a tag, a SHA). Only used
   * with `createBranch`. Without it git falls back to the main worktree's HEAD,
   * which is whatever branch the user happened to leave checked out — the
   * classic way a hotfix ends up branched off an unrelated feature.
   */
  baseRef?: string
  /**
   * Fetch the remote that owns `baseRef` before creating, so a remote start
   * point means the real remote tip and not a stale local copy of it.
   */
  fetchBase?: boolean
}

/**
 * Where `git worktree add -b` should start from, resolved from the repo itself
 * so the UI can show the user the start point before they commit to it.
 */
export interface GitHubWorktreeBase {
  /** Ref to branch from, e.g. `origin/main`. Never empty — falls back to `HEAD`. */
  baseRef: string
  /** Remote that owns `baseRef`, or null when the base is local-only. */
  remoteName: string | null
  /** True when `baseRef` lives on a remote and is therefore worth fetching. */
  isRemote: boolean
}

export interface GitHubWorktreePathInput {
  /** Main worktree — where git commands are executed from. */
  rootPath: string
  /** The worktree being inspected. */
  path: string
}

/**
 * Just enough state to tell the user what they are about to destroy when they
 * remove a worktree. Deliberately cheap: one `git status --porcelain=v2
 * --branch` per call, no remote round-trip.
 */
export interface GitHubWorktreeStatus {
  path: string
  /** Tracked files with staged or unstaged modifications. */
  dirtyCount: number
  /** Untracked, non-ignored files. */
  untrackedCount: number
  /** Commits ahead of the upstream branch, or 0 when there is no upstream. */
  ahead: number
  /** Commits behind the upstream branch, or 0 when there is no upstream. */
  behind: number
  /** True when the branch has no upstream — nothing has ever been pushed. */
  noUpstream: boolean
}

export interface GitHubRemoveWorktreeInput {
  rootPath: string
  path: string
  force?: boolean
}

export interface GitHubPullRequest {
  number: number
  title: string
  state: string
  author: string | null
  url: string | null
  headRefName: string | null
  baseRefName: string | null
  updatedAt: string | null
  createdAt?: string | null
  body?: string | null
}

export interface GitHubCommit {
  oid: string
  shortOid: string
  message: string
  author: string | null
  committedDate: string | null
  url: string | null
}

export interface GitHubCommitFile {
  path: string
  additions: number
  deletions: number
  binary: boolean
}

export interface GitHubCommitDetails extends GitHubCommit {
  body: string | null
  files: GitHubCommitFile[]
  additions: number
  deletions: number
}

export interface GitHubRelease {
  tagName: string
  name: string | null
  isDraft: boolean
  isPrerelease: boolean
  publishedAt: string | null
  url: string | null
}

export interface GitHubWorkflow {
  id: number
  name: string
  path: string
  state: string
}

export interface GitHubWorkflowRun {
  databaseId: number
  name: string | null
  displayTitle: string | null
  status: string
  conclusion: string | null
  event: string | null
  branch: string | null
  actor: string | null
  url: string | null
  createdAt: string | null
}

export interface GitHubWorkflowStep {
  number: number | null
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface GitHubWorkflowJob {
  databaseId: number | null
  name: string
  status: string
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  steps: GitHubWorkflowStep[]
}

export interface GitHubWorkflowRunDetails extends GitHubWorkflowRun {
  jobs: GitHubWorkflowJob[]
}

export interface GitHubCheckpoint {
  id: string
  workspaceId: string
  name: string
  description: string | null
  branch: string | null
  baseCommit: string | null
  patch: string
  untrackedFiles: string[]
  createdAt: number
}

export interface GitHubConnectedRepository {
  id: string
  workspaceId: string
  fullName: string
  url: string | null
  createdAt: number
}

export interface GitHubMessageResult {
  ok: boolean
  message: string
}

export interface GitHubCommitInput extends GitHubWorkspaceInput {
  message: string
}

export interface GitHubFileInput extends GitHubWorkspaceInput {
  path: string
}

export interface GitHubCommitDetailsInput extends GitHubWorkspaceInput {
  oid: string
}

export interface GitHubCreateBranchInput extends GitHubWorkspaceInput {
  name: string
  checkout?: boolean
}

export interface GitHubCheckoutBranchInput extends GitHubWorkspaceInput {
  name: string
  force?: boolean
}

export interface GitHubPullRequestListInput extends GitHubWorkspaceInput {
  state: 'open' | 'closed' | 'all'
}

export interface GitHubCreatePullRequestInput extends GitHubWorkspaceInput {
  title: string
  body: string
  base?: string
  head?: string
  draft?: boolean
}

export interface GitHubCreateReleaseInput extends GitHubWorkspaceInput {
  tagName: string
  title?: string
  notes?: string
  generateNotes?: boolean
  prerelease?: boolean
  draft?: boolean
}

export interface GitHubWorkflowRunInput extends GitHubWorkspaceInput {
  workflowId: string
  ref?: string
  fields?: Record<string, string>
}

export interface GitHubCreateCheckpointInput extends GitHubWorkspaceInput {
  name: string
  description?: string
}

export interface GitHubRestoreCheckpointInput extends GitHubWorkspaceInput {
  checkpointId: string
}

export interface GitHubDeleteCheckpointInput {
  checkpointId: string
}

export interface GitHubConnectRepositoryInput extends GitHubWorkspaceInput {
  fullName: string
  url?: string | null
}

/**
 * The slice of GitHubService that everything outside the GitHub feature uses.
 *
 * Linear, oxe-context, the internal MCP bootstrap and registry, and both halves
 * of the RPC server all typed the full 37-method class while calling exactly
 * these four. Depending on the narrow contract means a change to pull requests,
 * releases or Actions cannot reach any of them — and it documents what the
 * worktree feature actually needs from GitHub.
 */
export interface GitHubWorktreeApi {
  listBranches(input: GitHubWorkspaceInput): Promise<GitHubBranch[]>
  listWorktrees(input: GitHubWorkspaceInput): Promise<GitHubWorktree[]>
  createWorktree(input: GitHubCreateWorktreeInput): Promise<GitHubMessageResult>
  removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult>
  /**
   * Part of the contract because every caller that creates a branch needs it:
   * omitting a start point silently branches off the main worktree's HEAD.
   */
  resolveWorktreeBase(input: GitHubWorkspaceInput): Promise<GitHubWorktreeBase>
}
