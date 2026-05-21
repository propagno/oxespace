import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { GitHubService } from '../services/github.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  parseGitHubCheckoutBranchInput,
  parseGitHubCommitDetailsInput,
  parseGitHubCommitInput,
  parseGitHubConnectRepositoryInput,
  parseGitHubCreateBranchInput,
  parseGitHubCreateCheckpointInput,
  parseGitHubCreatePullRequestInput,
  parseGitHubCreateReleaseInput,
  parseGitHubCreateWorktreeInput,
  parseGitHubDeleteCheckpointInput,
  parseGitHubPullRequestListInput,
  parseGitHubRemoveWorktreeInput,
  parseGitHubRestoreCheckpointInput,
  parseGitHubWorkflowRunInput,
  parseGitHubWorkspaceInput
} from './validation'

export function registerGitHubIpc(db: AppDatabase, service = new GitHubService(db)): GitHubService {
  ipcMain.handle(IPC_CHANNELS.github.getCliStatus, (_event, input: unknown) =>
    service.getCliStatus(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.getWorkspaceStatus, (_event, input: unknown) =>
    service.getWorkspaceStatus(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.fetch, (_event, input: unknown) =>
    service.fetch(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.stageAll, (_event, input: unknown) =>
    service.stageAll(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.commit, (_event, input: unknown) =>
    service.commit(parseGitHubCommitInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.generateCommitMessage, (_event, input: unknown) =>
    service.generateCommitMessage(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.push, (_event, input: unknown) =>
    service.push(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.commitAndPush, (_event, input: unknown) =>
    service.commitAndPush(parseGitHubCommitInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listBranches, (_event, input: unknown) =>
    service.listBranches(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.createBranch, (_event, input: unknown) =>
    service.createBranch(parseGitHubCreateBranchInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.checkoutBranch, (_event, input: unknown) =>
    service.checkoutBranch(parseGitHubCheckoutBranchInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listWorktrees, (_event, input: unknown) =>
    service.listWorktrees(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.createWorktree, (_event, input: unknown) =>
    service.createWorktree(parseGitHubCreateWorktreeInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.removeWorktree, (_event, input: unknown) =>
    service.removeWorktree(parseGitHubRemoveWorktreeInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listPullRequests, (_event, input: unknown) =>
    service.listPullRequests(parseGitHubPullRequestListInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.createPullRequest, (_event, input: unknown) =>
    service.createPullRequest(parseGitHubCreatePullRequestInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listCommits, (_event, input: unknown) =>
    service.listCommits(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.getCommitDetails, (_event, input: unknown) =>
    service.getCommitDetails(parseGitHubCommitDetailsInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listReleases, (_event, input: unknown) =>
    service.listReleases(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.createRelease, (_event, input: unknown) =>
    service.createRelease(parseGitHubCreateReleaseInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listWorkflows, (_event, input: unknown) =>
    service.listWorkflows(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listWorkflowRuns, (_event, input: unknown) =>
    service.listWorkflowRuns(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.getWorkflowRunDetails, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid workflow run details input')
    const { rootPath, runId } = input as { rootPath?: unknown; runId?: unknown }
    if (typeof rootPath !== 'string' || !rootPath) throw new Error('rootPath is required')
    if (typeof runId !== 'number' || !Number.isFinite(runId)) throw new Error('runId must be a number')
    return service.getWorkflowRunDetails({ rootPath, runId })
  })
  ipcMain.handle(IPC_CHANNELS.github.runWorkflow, (_event, input: unknown) =>
    service.runWorkflow(parseGitHubWorkflowRunInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.rerunRun, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid rerun input')
    const { rootPath, runId, failedOnly } = input as { rootPath?: unknown; runId?: unknown; failedOnly?: unknown }
    if (typeof rootPath !== 'string' || !rootPath) throw new Error('rootPath is required')
    if (typeof runId !== 'number' || !Number.isFinite(runId)) throw new Error('runId must be a number')
    return service.rerunRun({ rootPath, runId, failedOnly: failedOnly === true })
  })
  ipcMain.handle(IPC_CHANNELS.github.getRunLogs, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid run-logs input')
    const { rootPath, runId, failedOnly } = input as { rootPath?: unknown; runId?: unknown; failedOnly?: unknown }
    if (typeof rootPath !== 'string' || !rootPath) throw new Error('rootPath is required')
    if (typeof runId !== 'number' || !Number.isFinite(runId)) throw new Error('runId must be a number')
    return service.getRunLogs({ rootPath, runId, failedOnly: failedOnly === true })
  })
  ipcMain.handle(IPC_CHANNELS.github.listCheckpoints, (_event, input: unknown) =>
    service.listCheckpoints(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.createCheckpoint, (_event, input: unknown) =>
    service.createCheckpoint(parseGitHubCreateCheckpointInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.restoreCheckpoint, (_event, input: unknown) =>
    service.restoreCheckpoint(parseGitHubRestoreCheckpointInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.deleteCheckpoint, (_event, input: unknown) =>
    service.deleteCheckpoint(parseGitHubDeleteCheckpointInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.listConnectedRepositories, (_event, input: unknown) =>
    service.listConnectedRepositories(parseGitHubWorkspaceInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.github.connectRepository, (_event, input: unknown) =>
    service.connectRepository(parseGitHubConnectRepositoryInput(input))
  )

  return service
}
