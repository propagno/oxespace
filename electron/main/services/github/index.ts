/**
 * GitHubService — the façade the rest of the app still talks to.
 *
 * The 37 methods behind it used to be one 1124-line class covering four things
 * that change for four different reasons: the working tree, code review,
 * Actions, and local checkpoints. They are now four collaborators over one
 * shared execution kernel.
 *
 * The façade is not ceremony. Six call sites outside the IPC layer type this
 * class (linear, oxe-context, the internal MCP bootstrap and registry, and both
 * halves of the RPC server), and the IPC adapter binds 35 channels to it by
 * name. Keeping the surface identical is what let the split happen without
 * touching any of them — and what lets the existing github.service.test.ts pass
 * unchanged, which is the only real proof the four parts still add up to the
 * whole.
 */
import type { AppDatabase } from '../../db/index'
import type {
  GitHubBranch,
  GitHubCheckpoint,
  GitHubCliStatus,
  GitHubCommit,
  GitHubCommitDetails,
  GitHubCommitInput,
  GitHubConnectRepositoryInput,
  GitHubConnectedRepository,
  GitHubCreateBranchInput,
  GitHubCreateCheckpointInput,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubCreateWorktreeInput,
  GitHubFileInput,
  GitHubMessageResult,
  GitHubPullRequest,
  GitHubPullRequestListInput,
  GitHubRelease,
  GitHubRemoveWorktreeInput,
  GitHubRestoreCheckpointInput,
  GitHubWorkflow,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetails,
  GitHubWorkflowRunInput,
  GitHubWorkspaceInput,
  GitHubWorkspaceStatus,
  GitHubWorktree,
  GitHubWorktreeBase,
  GitHubWorktreePathInput,
  GitHubWorktreeStatus
} from '../../../../shared/types/github'
import { GhExec, type SpawnAsyncFn } from './gh-exec'
import { GitHubRepositoryService } from './repository.service'
import { GitHubReviewService } from './review.service'
import { GitHubActionsService } from './actions.service'
import { GitHubCheckpointService } from './checkpoints.service'

export { GhExec } from './gh-exec'
export type { SpawnAsyncFn, SpawnAsyncOptions, SpawnResult } from './gh-exec'
export { GitHubRepositoryService } from './repository.service'
export { GitHubReviewService } from './review.service'
export { GitHubActionsService } from './actions.service'
export { GitHubCheckpointService } from './checkpoints.service'

export class GitHubService {
  private readonly gh: GhExec
  private readonly repository: GitHubRepositoryService
  private readonly review: GitHubReviewService
  private readonly actions: GitHubActionsService
  private readonly checkpoints: GitHubCheckpointService

  constructor(db: AppDatabase, options: { spawnCommand?: SpawnAsyncFn; now?: () => number } = {}) {
    // One kernel, four collaborators. The CLI and repository caches live here,
    // so a detectCli paid by the status tab is not paid again by Actions.
    this.gh = new GhExec(options)
    this.repository = new GitHubRepositoryService(this.gh)
    this.review = new GitHubReviewService(this.gh)
    this.actions = new GitHubActionsService(this.gh)
    this.checkpoints = new GitHubCheckpointService(db, this.gh)
  }

  invalidateCaches(cwd: string): void {
    this.gh.invalidateCaches(cwd)
  }

  // --- repository ---------------------------------------------------------
  getCliStatus(input: GitHubWorkspaceInput): Promise<GitHubCliStatus> {
    return this.repository.getCliStatus(input)
  }
  getWorkspaceStatus(input: GitHubWorkspaceInput): Promise<GitHubWorkspaceStatus> {
    return this.repository.getWorkspaceStatus(input)
  }
  fetch(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    return this.repository.fetch(input)
  }
  pullFfOnly(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    return this.repository.pullFfOnly(input)
  }
  stageAll(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    return this.repository.stageAll(input)
  }
  stageFile(input: GitHubFileInput): Promise<GitHubMessageResult> {
    return this.repository.stageFile(input)
  }
  unstageFile(input: GitHubFileInput): Promise<GitHubMessageResult> {
    return this.repository.unstageFile(input)
  }
  commit(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    return this.repository.commit(input)
  }
  generateCommitMessage(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    return this.repository.generateCommitMessage(input)
  }
  push(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    return this.repository.push(input)
  }
  commitAndPush(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    return this.repository.commitAndPush(input)
  }
  listBranches(input: GitHubWorkspaceInput): Promise<GitHubBranch[]> {
    return this.repository.listBranches(input)
  }
  createBranch(input: GitHubCreateBranchInput): Promise<GitHubMessageResult> {
    return this.repository.createBranch(input)
  }
  checkoutBranch(input: { rootPath: string; name: string; force?: boolean }): Promise<GitHubMessageResult> {
    return this.repository.checkoutBranch(input)
  }
  listWorktrees(input: GitHubWorkspaceInput): Promise<GitHubWorktree[]> {
    return this.repository.listWorktrees(input)
  }
  createWorktree(input: GitHubCreateWorktreeInput): Promise<GitHubMessageResult> {
    return this.repository.createWorktree(input)
  }
  removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult> {
    return this.repository.removeWorktree(input)
  }
  resolveWorktreeBase(input: GitHubWorkspaceInput): Promise<GitHubWorktreeBase> {
    return this.repository.resolveWorktreeBase(input)
  }
  getWorktreeStatus(input: GitHubWorktreePathInput): Promise<GitHubWorktreeStatus> {
    return this.repository.getWorktreeStatus(input)
  }

  // --- review -------------------------------------------------------------
  listPullRequests(input: GitHubPullRequestListInput): Promise<GitHubPullRequest[]> {
    return this.review.listPullRequests(input)
  }
  createPullRequest(input: GitHubCreatePullRequestInput): Promise<GitHubMessageResult> {
    return this.review.createPullRequest(input)
  }
  listCommits(input: GitHubWorkspaceInput): Promise<GitHubCommit[]> {
    return this.review.listCommits(input)
  }
  getCommitDetails(input: { rootPath: string; oid: string }): Promise<GitHubCommitDetails> {
    return this.review.getCommitDetails(input)
  }
  listReleases(input: GitHubWorkspaceInput): Promise<GitHubRelease[]> {
    return this.review.listReleases(input)
  }
  createRelease(input: GitHubCreateReleaseInput): Promise<GitHubMessageResult> {
    return this.review.createRelease(input)
  }

  // --- actions ------------------------------------------------------------
  listWorkflows(input: GitHubWorkspaceInput): Promise<GitHubWorkflow[]> {
    return this.actions.listWorkflows(input)
  }
  listWorkflowRuns(input: GitHubWorkspaceInput): Promise<GitHubWorkflowRun[]> {
    return this.actions.listWorkflowRuns(input)
  }
  getWorkflowRunDetails(input: { rootPath: string; runId: number }): Promise<GitHubWorkflowRunDetails> {
    return this.actions.getWorkflowRunDetails(input)
  }
  runWorkflow(input: GitHubWorkflowRunInput): Promise<GitHubMessageResult> {
    return this.actions.runWorkflow(input)
  }
  rerunRun(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<GitHubMessageResult> {
    return this.actions.rerunRun(input)
  }
  getRunLogs(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<{ logs: string; truncated: boolean; bytes: number }> {
    return this.actions.getRunLogs(input)
  }

  // --- checkpoints --------------------------------------------------------
  listCheckpoints(input: GitHubWorkspaceInput): GitHubCheckpoint[] {
    return this.checkpoints.listCheckpoints(input)
  }
  createCheckpoint(input: GitHubCreateCheckpointInput): Promise<GitHubCheckpoint> {
    return this.checkpoints.createCheckpoint(input)
  }
  restoreCheckpoint(input: GitHubRestoreCheckpointInput): Promise<GitHubMessageResult> {
    return this.checkpoints.restoreCheckpoint(input)
  }
  deleteCheckpoint(input: { checkpointId: string }): GitHubMessageResult {
    return this.checkpoints.deleteCheckpoint(input)
  }
  listConnectedRepositories(input: GitHubWorkspaceInput): GitHubConnectedRepository[] {
    return this.checkpoints.listConnectedRepositories(input)
  }
  connectRepository(input: GitHubConnectRepositoryInput): GitHubConnectedRepository {
    return this.checkpoints.connectRepository(input)
  }
}
