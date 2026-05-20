import type { IpcRendererEvent } from 'electron'
import packageJson from '../../package.json'
import {
  IPC_CHANNELS,
  type AgentProfile,
  type AgentReadiness,
  type FileSystemFileChangedEvent,
  type FileSystemReadFileResult,
  type FileSystemWatchFileResult,
  type FileSystemWriteFileResult,
  type FileTreeNode,
  type GitHubBranch,
  type GitHubCheckpoint,
  type GitHubCliStatus,
  type GitHubCommit,
  type GitHubCommitDetails,
  type GitHubConnectedRepository,
  type GitHubMessageResult,
  type GitHubPullRequest,
  type GitHubRelease,
  type GitHubWorkflow,
  type GitHubWorkflowRun,
  type GitHubWorkspaceStatus,
  type OxeApi,
  type ShellProfile,
  type Task,
  type TaskExecution,
  type TaskVerifyOutputEvent,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type Workspace
} from '../../shared/types/ipc'
import type { GitDiff } from '../../shared/types/git'

export interface PreloadIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
}

export function createOxeApi(ipc: PreloadIpc): OxeApi {
  return {
    app: {
      version: packageJson.version
    },
    workspace: {
      list: () => ipc.invoke(IPC_CHANNELS.workspace.list) as Promise<Workspace[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.workspace.create, input) as Promise<Workspace>,
      setActive: (id) => ipc.invoke(IPC_CHANNELS.workspace.setActive, id) as Promise<Workspace>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.workspace.delete, id) as Promise<void>,
      closePane: (id) => ipc.invoke(IPC_CHANNELS.workspace.closePane, id) as Promise<void>,
      splitPane: (input) => ipc.invoke(IPC_CHANNELS.workspace.splitPane, input) as Promise<Workspace>,
      updatePaneType: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneType, input) as Promise<Workspace>,
      updatePaneName: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneName, input) as Promise<Workspace>,
      setPaneAgent: (input) => ipc.invoke(IPC_CHANNELS.workspace.setPaneAgent, input) as Promise<Workspace>,
      setPaneRootPath: (input) => ipc.invoke(IPC_CHANNELS.workspace.setPaneRootPath, input) as Promise<Workspace>,
      updateEditorState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateEditorState, input) as Promise<Workspace>,
      updateReviewState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateReviewState, input) as Promise<Workspace>,
      updateGitHubState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateGitHubState, input) as Promise<Workspace>,
      updateBackgroundState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateBackgroundState, input) as Promise<Workspace>,
      updateSettings: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateSettings, input) as Promise<Workspace>,
      pickFolder: () => ipc.invoke(IPC_CHANNELS.workspace.pickFolder) as Promise<string | null>,
      shellProfiles: () => ipc.invoke(IPC_CHANNELS.workspace.shellProfiles) as Promise<ShellProfile[]>,
      createGitHubTerminalPane: (workspaceId) =>
        ipc.invoke(IPC_CHANNELS.workspace.createGitHubTerminalPane, workspaceId) as Promise<{ id: string }>
    },
    terminal: {
      start: (input) => ipc.invoke(IPC_CHANNELS.terminal.start, input) as Promise<void>,
      write: (input) => ipc.invoke(IPC_CHANNELS.terminal.write, input) as Promise<void>,
      resize: (input) => ipc.invoke(IPC_CHANNELS.terminal.resize, input) as Promise<void>,
      stop: (input) => ipc.invoke(IPC_CHANNELS.terminal.stop, input) as Promise<void>,
      restart: (input) => ipc.invoke(IPC_CHANNELS.terminal.restart, input) as Promise<void>,
      onData: (listener) => subscribe<TerminalDataEvent>(ipc, IPC_CHANNELS.terminal.onData, listener),
      onExit: (listener) => subscribe<TerminalExitEvent>(ipc, IPC_CHANNELS.terminal.onExit, listener)
    },
    agent: {
      list: () => ipc.invoke(IPC_CHANNELS.agent.list) as Promise<AgentProfile[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.agent.create, input) as Promise<AgentProfile>,
      update: (id, input) => ipc.invoke(IPC_CHANNELS.agent.update, id, input) as Promise<AgentProfile>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.agent.delete, id) as Promise<void>,
      discover: (forceRefresh) => ipc.invoke(IPC_CHANNELS.agent.discover, forceRefresh) as Promise<AgentReadiness[]>,
      getReadiness: () => ipc.invoke(IPC_CHANNELS.agent.getReadiness) as Promise<AgentReadiness[]>
    },
    tasks: {
      list: (workspaceId) => ipc.invoke(IPC_CHANNELS.tasks.list, workspaceId) as Promise<Task[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.tasks.create, input) as Promise<Task>,
      update: (id, input) => ipc.invoke(IPC_CHANNELS.tasks.update, id, input) as Promise<Task>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.tasks.delete, id) as Promise<void>,
      reorder: (input) => ipc.invoke(IPC_CHANNELS.tasks.reorder, input) as Promise<Task[]>,
      run: (input) => ipc.invoke(IPC_CHANNELS.tasks.run, input) as Promise<Task>,
      verify: (input) => ipc.invoke(IPC_CHANNELS.tasks.verify, input) as Promise<Task>,
      executions: (taskId) => ipc.invoke(IPC_CHANNELS.tasks.executions, taskId) as Promise<TaskExecution[]>,
      onVerifyOutput: (listener) => subscribe<TaskVerifyOutputEvent>(ipc, IPC_CHANNELS.tasks.onVerifyOutput, listener),
      addDependency: (input) => ipc.invoke(IPC_CHANNELS.tasks.addDependency, input) as Promise<Task>,
      removeDependency: (input) => ipc.invoke(IPC_CHANNELS.tasks.removeDependency, input) as Promise<Task>,
      getReady: (workspaceId) => ipc.invoke(IPC_CHANNELS.tasks.getReady, workspaceId) as Promise<string[]>
    },
    fs: {
      listTree: (input) => ipc.invoke(IPC_CHANNELS.fs.listTree, input) as Promise<FileTreeNode[]>,
      readFile: (input) => ipc.invoke(IPC_CHANNELS.fs.readFile, input) as Promise<FileSystemReadFileResult>,
      writeFile: (input) => ipc.invoke(IPC_CHANNELS.fs.writeFile, input) as Promise<FileSystemWriteFileResult>,
      watchFile: (input) => ipc.invoke(IPC_CHANNELS.fs.watchFile, input) as Promise<FileSystemWatchFileResult>,
      unwatchFile: (input) => ipc.invoke(IPC_CHANNELS.fs.unwatchFile, input) as Promise<void>,
      onFileChanged: (listener) => subscribe<FileSystemFileChangedEvent>(ipc, IPC_CHANNELS.fs.onFileChanged, listener)
    },
    git: {
      getDiff: (input) => ipc.invoke(IPC_CHANNELS.git.getDiff, input) as Promise<GitDiff>,
      onDiffUpdate: (listener) => subscribe<GitDiff>(ipc, IPC_CHANNELS.git.onDiffUpdate, listener)
    },
    clipboard: {
      saveImageToTemp: () => ipc.invoke(IPC_CHANNELS.clipboard.saveImageToTemp) as Promise<string | null>
    },
    github: {
      getCliStatus: (input) => ipc.invoke(IPC_CHANNELS.github.getCliStatus, input) as Promise<GitHubCliStatus>,
      getWorkspaceStatus: (input) => ipc.invoke(IPC_CHANNELS.github.getWorkspaceStatus, input) as Promise<GitHubWorkspaceStatus>,
      fetch: (input) => ipc.invoke(IPC_CHANNELS.github.fetch, input) as Promise<GitHubMessageResult>,
      stageAll: (input) => ipc.invoke(IPC_CHANNELS.github.stageAll, input) as Promise<GitHubMessageResult>,
      commit: (input) => ipc.invoke(IPC_CHANNELS.github.commit, input) as Promise<GitHubMessageResult>,
      generateCommitMessage: (input) => ipc.invoke(IPC_CHANNELS.github.generateCommitMessage, input) as Promise<GitHubMessageResult>,
      push: (input) => ipc.invoke(IPC_CHANNELS.github.push, input) as Promise<GitHubMessageResult>,
      commitAndPush: (input) => ipc.invoke(IPC_CHANNELS.github.commitAndPush, input) as Promise<GitHubMessageResult>,
      listBranches: (input) => ipc.invoke(IPC_CHANNELS.github.listBranches, input) as Promise<GitHubBranch[]>,
      createBranch: (input) => ipc.invoke(IPC_CHANNELS.github.createBranch, input) as Promise<GitHubMessageResult>,
      checkoutBranch: (input) => ipc.invoke(IPC_CHANNELS.github.checkoutBranch, input) as Promise<GitHubMessageResult>,
      listWorktrees: (input) => ipc.invoke(IPC_CHANNELS.github.listWorktrees, input) as Promise<import('../../shared/types/github').GitHubWorktree[]>,
      createWorktree: (input) => ipc.invoke(IPC_CHANNELS.github.createWorktree, input) as Promise<GitHubMessageResult>,
      removeWorktree: (input) => ipc.invoke(IPC_CHANNELS.github.removeWorktree, input) as Promise<GitHubMessageResult>,
      listPullRequests: (input) => ipc.invoke(IPC_CHANNELS.github.listPullRequests, input) as Promise<GitHubPullRequest[]>,
      createPullRequest: (input) => ipc.invoke(IPC_CHANNELS.github.createPullRequest, input) as Promise<GitHubMessageResult>,
      listCommits: (input) => ipc.invoke(IPC_CHANNELS.github.listCommits, input) as Promise<GitHubCommit[]>,
      getCommitDetails: (input) => ipc.invoke(IPC_CHANNELS.github.getCommitDetails, input) as Promise<GitHubCommitDetails>,
      listReleases: (input) => ipc.invoke(IPC_CHANNELS.github.listReleases, input) as Promise<GitHubRelease[]>,
      createRelease: (input) => ipc.invoke(IPC_CHANNELS.github.createRelease, input) as Promise<GitHubMessageResult>,
      listWorkflows: (input) => ipc.invoke(IPC_CHANNELS.github.listWorkflows, input) as Promise<GitHubWorkflow[]>,
      listWorkflowRuns: (input) => ipc.invoke(IPC_CHANNELS.github.listWorkflowRuns, input) as Promise<GitHubWorkflowRun[]>,
      runWorkflow: (input) => ipc.invoke(IPC_CHANNELS.github.runWorkflow, input) as Promise<GitHubMessageResult>,
      rerunRun: (input) => ipc.invoke(IPC_CHANNELS.github.rerunRun, input) as Promise<GitHubMessageResult>,
      getRunLogs: (input) => ipc.invoke(IPC_CHANNELS.github.getRunLogs, input) as Promise<{ logs: string; truncated: boolean; bytes: number }>,
      listCheckpoints: (input) => ipc.invoke(IPC_CHANNELS.github.listCheckpoints, input) as Promise<GitHubCheckpoint[]>,
      createCheckpoint: (input) => ipc.invoke(IPC_CHANNELS.github.createCheckpoint, input) as Promise<GitHubCheckpoint>,
      restoreCheckpoint: (input) => ipc.invoke(IPC_CHANNELS.github.restoreCheckpoint, input) as Promise<GitHubMessageResult>,
      deleteCheckpoint: (input) => ipc.invoke(IPC_CHANNELS.github.deleteCheckpoint, input) as Promise<GitHubMessageResult>,
      listConnectedRepositories: (input) => ipc.invoke(IPC_CHANNELS.github.listConnectedRepositories, input) as Promise<GitHubConnectedRepository[]>,
      connectRepository: (input) => ipc.invoke(IPC_CHANNELS.github.connectRepository, input) as Promise<GitHubConnectedRepository>
    },
    usage: {
      getContextUsage: (input) => ipc.invoke(IPC_CHANNELS.usage.getContextUsage, input) as Promise<import('../../shared/types/usage').ContextUsageSnapshot>,
      getSnapshotFor: (input) => ipc.invoke(IPC_CHANNELS.usage.getSnapshotFor, input) as Promise<import('../../shared/types/usage').ContextUsageSnapshot>,
      listSessions: (input) => ipc.invoke(IPC_CHANNELS.usage.listSessions, input) as Promise<import('../../shared/types/usage/sessions').UsageSessionMetadata[]>,
      supportedProviders: () => ipc.invoke(IPC_CHANNELS.usage.supportedProviders) as Promise<import('../../shared/types/agent').AgentProvider[]>
    },
    background: {
      list: (workspaceId) => ipc.invoke(IPC_CHANNELS.background.list, workspaceId) as Promise<import('../../shared/types/background').BackgroundJob[]>,
      start: (input) => ipc.invoke(IPC_CHANNELS.background.start, input) as Promise<import('../../shared/types/background').BackgroundJob>,
      stop: (jobId) => ipc.invoke(IPC_CHANNELS.background.stop, jobId) as Promise<void>,
      remove: (jobId) => ipc.invoke(IPC_CHANNELS.background.remove, jobId) as Promise<void>,
      getOutput: (jobId) => ipc.invoke(IPC_CHANNELS.background.getOutput, jobId) as Promise<import('../../shared/types/background').BackgroundJobOutputChunk>,
      onOutput: (listener) => subscribe<import('../../shared/types/background').BackgroundJobOutputEvent>(ipc, IPC_CHANNELS.background.onOutput, listener),
      onUpdate: (listener) => subscribe<import('../../shared/types/background').BackgroundJobUpdateEvent>(ipc, IPC_CHANNELS.background.onUpdate, listener)
    },
    session: {
      list: (input) => ipc.invoke(IPC_CHANNELS.session.list, input) as Promise<import('../../shared/types/session').SessionSummary[]>,
      fork: (input) => ipc.invoke(IPC_CHANNELS.session.fork, input) as Promise<import('../../shared/types/session').ForkSessionResult>,
      delete: (input) => ipc.invoke(IPC_CHANNELS.session.delete, input) as Promise<boolean>
    },
    skill: {
      list: (input) => ipc.invoke(IPC_CHANNELS.skill.list, input ?? {}) as Promise<import('../../shared/types/skill').SkillDefinition[]>,
      get: (name) => ipc.invoke(IPC_CHANNELS.skill.get, name) as Promise<import('../../shared/types/skill').SkillDefinition | null>,
      invoke: (input) => ipc.invoke(IPC_CHANNELS.skill.invoke, input) as Promise<void>,
      onChange: (listener) => subscribe<void>(ipc, IPC_CHANNELS.skill.onChange, () => listener())
    },
    mcp: {
      list: (workspaceId) => ipc.invoke(IPC_CHANNELS.mcp.list, workspaceId) as Promise<import('../../shared/types/mcp').McpServer[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.mcp.create, input) as Promise<import('../../shared/types/mcp').McpServer>,
      update: (input) => ipc.invoke(IPC_CHANNELS.mcp.update, input) as Promise<import('../../shared/types/mcp').McpServer>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.mcp.delete, id) as Promise<void>,
      start: (id) => ipc.invoke(IPC_CHANNELS.mcp.start, id) as Promise<import('../../shared/types/mcp').McpToolDescriptor[]>,
      stop: (id) => ipc.invoke(IPC_CHANNELS.mcp.stop, id) as Promise<void>,
      callTool: (input) => ipc.invoke(IPC_CHANNELS.mcp.callTool, input) as Promise<import('../../shared/types/mcp').McpCallToolResult>,
      onHealth: (listener) => subscribe<import('../../shared/types/mcp').McpServerHealthEvent>(ipc, IPC_CHANNELS.mcp.onHealth, listener)
    }
  }
}

function subscribe<TPayload>(
  ipc: PreloadIpc,
  channel: string,
  listener: (event: TPayload) => void
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as TPayload)
  }

  ipc.on(channel, wrapped)
  return () => ipc.removeListener(channel, wrapped)
}
