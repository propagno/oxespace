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
