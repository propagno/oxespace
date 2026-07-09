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
  type GitHubWorkflowRunDetails,
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
  const terminalData = createPaneSubscriber<TerminalDataEvent>(ipc, IPC_CHANNELS.terminal.onData)
  const terminalExit = createPaneSubscriber<TerminalExitEvent>(ipc, IPC_CHANNELS.terminal.onExit)

  return {
    app: {
      version: packageJson.version,
      getUpdateState: () => ipc.invoke(IPC_CHANNELS.app.getUpdateState) as Promise<import('../../shared/types/updater').AppUpdateState>,
      checkForUpdates: () => ipc.invoke(IPC_CHANNELS.app.checkForUpdates) as Promise<import('../../shared/types/updater').AppUpdateState>,
      quitAndInstall: () => ipc.invoke(IPC_CHANNELS.app.quitAndInstall) as Promise<boolean>,
      onUpdateState: (listener) => subscribe(ipc, IPC_CHANNELS.app.onUpdateState, listener)
    },
    rtk: {
      getStatus: () => ipc.invoke(IPC_CHANNELS.rtk.getStatus) as Promise<import('../../shared/types/updater').RtkUpdateState>,
      checkForUpdate: () => ipc.invoke(IPC_CHANNELS.rtk.checkForUpdate) as Promise<import('../../shared/types/updater').RtkUpdateState>,
      updateToLatest: () => ipc.invoke(IPC_CHANNELS.rtk.updateToLatest) as Promise<import('../../shared/types/updater').RtkUpdateState>
    },
    workspace: {
      list: () => ipc.invoke(IPC_CHANNELS.workspace.list) as Promise<Workspace[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.workspace.create, input) as Promise<Workspace>,
      setActive: (id) => ipc.invoke(IPC_CHANNELS.workspace.setActive, id) as Promise<Workspace>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.workspace.delete, id) as Promise<void>,
      closePane: (id) => ipc.invoke(IPC_CHANNELS.workspace.closePane, id) as Promise<Workspace | null>,
      splitPane: (input) => ipc.invoke(IPC_CHANNELS.workspace.splitPane, input) as Promise<Workspace>,
      updatePaneType: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneType, input) as Promise<Workspace>,
      updatePaneName: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneName, input) as Promise<Workspace>,
      setPaneAgent: (input) => ipc.invoke(IPC_CHANNELS.workspace.setPaneAgent, input) as Promise<Workspace>,
      setPaneRootPath: (input) => ipc.invoke(IPC_CHANNELS.workspace.setPaneRootPath, input) as Promise<Workspace>,
      updateEditorState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateEditorState, input) as Promise<Workspace>,
      updateReviewState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateReviewState, input) as Promise<Workspace>,
      updateGitHubState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateGitHubState, input) as Promise<Workspace>,
      updateBackgroundState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateBackgroundState, input) as Promise<Workspace>,
      updateWorktreeState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateWorktreeState, input) as Promise<Workspace>,
      reorder: (orderedIds) => ipc.invoke(IPC_CHANNELS.workspace.reorder, orderedIds) as Promise<Workspace[]>,
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
      onData: terminalData,
      onExit: terminalExit
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
      getBranch: (input) => ipc.invoke(IPC_CHANNELS.git.getBranch, input) as Promise<import('../../shared/types/git').GitBranchStatus>,
      getDiff: (input) => ipc.invoke(IPC_CHANNELS.git.getDiff, input) as Promise<GitDiff>,
      onDiffUpdate: (listener) => subscribe<GitDiff>(ipc, IPC_CHANNELS.git.onDiffUpdate, listener)
    },
    clipboard: {
      saveImageToTemp: () => ipc.invoke(IPC_CHANNELS.clipboard.saveImageToTemp) as Promise<string | null>,
      readText: () => ipc.invoke(IPC_CHANNELS.clipboard.readText) as Promise<string>,
      writeText: (text) => ipc.invoke(IPC_CHANNELS.clipboard.writeText, text) as Promise<boolean>
    },
    voice: {
      transcribe: (wav, options) =>
        ipc.invoke(IPC_CHANNELS.voice.transcribe, wav, options) as Promise<import('../../shared/types/voice').VoiceTranscribeResult>,
      getModelStatus: (size) =>
        ipc.invoke(IPC_CHANNELS.voice.getModelStatus, size) as Promise<import('../../shared/types/voice').VoiceModelStatus>,
      ensureModel: (size) =>
        ipc.invoke(IPC_CHANNELS.voice.ensureModel, size) as Promise<import('../../shared/types/voice').VoiceModelStatus>,
      onModelProgress: (listener) =>
        subscribe<import('../../shared/types/voice').VoiceModelProgressEvent>(ipc, IPC_CHANNELS.voice.onModelProgress, listener)
    },
    notifications: {
      notify: (payload) => ipc.invoke(IPC_CHANNELS.notifications.notify, payload) as Promise<boolean>,
      onActivate: (listener) =>
        subscribe<{ paneId: string; workspaceId: string }>(ipc, IPC_CHANNELS.notifications.onActivate, listener)
    },
    oxe: {
      detect: (force) => ipc.invoke(IPC_CHANNELS.oxe.detect, force) as Promise<import('../../shared/types/oxe').OxeDetect>,
      status: (rootPath, force) => ipc.invoke(IPC_CHANNELS.oxe.status, rootPath, force) as Promise<import('../../shared/types/oxe').OxeStatusResult>,
      statusSummary: (rootPath, force) => ipc.invoke(IPC_CHANNELS.oxe.statusSummary, rootPath, force) as Promise<import('../../shared/types/oxe').OxeSummaryResult>,
      openDashboard: (rootPath) => ipc.invoke(IPC_CHANNELS.oxe.openDashboard, rootPath) as Promise<{ ok: boolean; error: string | null }>,
      startDashboard: (rootPath) => ipc.invoke(IPC_CHANNELS.oxe.startDashboard, rootPath) as Promise<import('../../shared/types/oxe').OxeDashboardHandle>,
      stopDashboard: (rootPath) => ipc.invoke(IPC_CHANNELS.oxe.stopDashboard, rootPath) as Promise<{ ok: boolean }>,
      watchEvents: (rootPath) => ipc.invoke(IPC_CHANNELS.oxe.watchEvents, rootPath) as Promise<{ ok: boolean }>,
      unwatchEvents: (rootPath) => ipc.invoke(IPC_CHANNELS.oxe.unwatchEvents, rootPath) as Promise<{ ok: boolean }>,
      onEventsChanged: (listener) => subscribe<{ rootPath: string }>(ipc, IPC_CHANNELS.oxe.onEventsChanged, listener)
    },
    copilot: {
      credits: (force) => ipc.invoke(IPC_CHANNELS.copilot.credits, force) as Promise<import('../../shared/types/copilot').CopilotCredits>
    },
    agentCredits: {
      get: (input) => ipc.invoke(IPC_CHANNELS.agentCredits.get, input) as Promise<import('../../shared/types/agentCredits').AgentCreditsSnapshot>
    },
    contextUsage: {
      get: (input) => ipc.invoke(IPC_CHANNELS.contextUsage.get, input) as Promise<import('../../shared/types/contextUsage').ContextUsageChip>
    },
    github: {
      getCliStatus: (input) => ipc.invoke(IPC_CHANNELS.github.getCliStatus, input) as Promise<GitHubCliStatus>,
      getWorkspaceStatus: (input) => ipc.invoke(IPC_CHANNELS.github.getWorkspaceStatus, input) as Promise<GitHubWorkspaceStatus>,
      fetch: (input) => ipc.invoke(IPC_CHANNELS.github.fetch, input) as Promise<GitHubMessageResult>,
      pullFfOnly: (input) => ipc.invoke(IPC_CHANNELS.github.pullFfOnly, input) as Promise<GitHubMessageResult>,
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
      getWorkflowRunDetails: (input) => ipc.invoke(IPC_CHANNELS.github.getWorkflowRunDetails, input) as Promise<GitHubWorkflowRunDetails>,
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
    integration: {
      listGroups: (input) => ipc.invoke(IPC_CHANNELS.integration.listGroups, input ?? {}) as Promise<import('../../shared/types/integration').IntegrationGroup[]>,
      createGroup: (input) => ipc.invoke(IPC_CHANNELS.integration.createGroup, input) as Promise<import('../../shared/types/integration').IntegrationGroup>,
      updateGroup: (input) => ipc.invoke(IPC_CHANNELS.integration.updateGroup, input) as Promise<import('../../shared/types/integration').IntegrationGroup>,
      deleteGroup: (groupId) => ipc.invoke(IPC_CHANNELS.integration.deleteGroup, groupId) as Promise<void>,
      addMember: (input) => ipc.invoke(IPC_CHANNELS.integration.addMember, input) as Promise<import('../../shared/types/integration').IntegrationGroup>,
      updateMember: (input) => ipc.invoke(IPC_CHANNELS.integration.updateMember, input) as Promise<import('../../shared/types/integration').IntegrationGroup>,
      removeMember: (memberId) => ipc.invoke(IPC_CHANNELS.integration.removeMember, memberId) as Promise<import('../../shared/types/integration').IntegrationGroup>,
      attachSession: (input) => ipc.invoke(IPC_CHANNELS.integration.attachSession, input) as Promise<import('../../shared/types/integration').IntegrationSession>,
      listHandoffs: (groupId) => ipc.invoke(IPC_CHANNELS.integration.listHandoffs, groupId) as Promise<import('../../shared/types/integration').IntegrationHandoff[]>,
      createHandoff: (input) => ipc.invoke(IPC_CHANNELS.integration.createHandoff, input) as Promise<import('../../shared/types/integration').IntegrationHandoff>,
      updateHandoff: (input) => ipc.invoke(IPC_CHANNELS.integration.updateHandoff, input) as Promise<import('../../shared/types/integration').IntegrationHandoff>,
      buildContext: (input) => ipc.invoke(IPC_CHANNELS.integration.buildContext, input) as Promise<import('../../shared/types/integration').IntegrationContextResult>
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
      delete: (input) => ipc.invoke(IPC_CHANNELS.session.delete, input) as Promise<boolean>,
      cleanup: (input) => ipc.invoke(IPC_CHANNELS.session.cleanup, input) as Promise<number>
    },
    skill: {
      list: (input) => ipc.invoke(IPC_CHANNELS.skill.list, input ?? {}) as Promise<import('../../shared/types/skill').SkillDefinition[]>,
      get: (name) => ipc.invoke(IPC_CHANNELS.skill.get, name) as Promise<import('../../shared/types/skill').SkillDefinition | null>,
      invoke: (input) => ipc.invoke(IPC_CHANNELS.skill.invoke, input) as Promise<void>,
      create: (input) => ipc.invoke(IPC_CHANNELS.skill.create, input) as Promise<import('../../shared/types/skill').SkillDefinition>,
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
    },
    mcpInternal: {
      getStatus: () => ipc.invoke(IPC_CHANNELS.mcpInternal.getStatus) as Promise<import('../../shared/types/mcp-internal').InternalMcpStatus>,
      regenerateToken: () => ipc.invoke(IPC_CHANNELS.mcpInternal.regenerateToken) as Promise<import('../../shared/types/mcp-internal').InternalMcpStatus>,
      onWebPreview: (listener) => subscribe<import('../../shared/types/mcp-internal').InternalMcpWebPreviewEvent>(ipc, IPC_CHANNELS.mcpInternal.onWebPreview, listener),
      onWorktreeChanged: (listener) => subscribe<import('../../shared/types/mcp-internal').InternalMcpWorktreeChangedEvent>(ipc, IPC_CHANNELS.mcpInternal.onWorktreeChanged, listener)
    },
    oxeContext: {
      buildPaneManifest: (input) => ipc.invoke(IPC_CHANNELS.oxeContext.buildPaneManifest, input) as Promise<string>
    },
    semantic: {
      getStatus: (workspaceId) => ipc.invoke(IPC_CHANNELS.semantic.getStatus, workspaceId) as Promise<import('../../shared/types/ipc').SemanticStatus>,
      setEnabled: (input) => ipc.invoke(IPC_CHANNELS.semantic.setEnabled, input) as Promise<import('../../shared/types/ipc').SemanticStatus>,
      getLogs: () => ipc.invoke(IPC_CHANNELS.semantic.getLogs) as Promise<import('../../shared/types/ipc').SemanticLogEntry[]>,
      onLog: (listener) => subscribe<import('../../shared/types/ipc').SemanticLogEntry>(ipc, IPC_CHANNELS.semantic.onLog, listener)
    }
  }
}

function createPaneSubscriber<TPayload extends { paneId: string }>(
  ipc: PreloadIpc,
  channel: string
): (paneId: string, listener: (event: TPayload) => void) => () => void {
  const listeners = new Map<string, Set<(event: TPayload) => void>>()
  let wrapped: ((event: IpcRendererEvent, payload: unknown) => void) | null = null

  return (paneId, listener) => {
    let paneListeners = listeners.get(paneId)
    if (!paneListeners) {
      paneListeners = new Set()
      listeners.set(paneId, paneListeners)
    }
    paneListeners.add(listener)

    if (!wrapped) {
      wrapped = (_event, payload) => {
        const event = payload as TPayload
        for (const target of listeners.get(event.paneId) ?? []) target(event)
      }
      ipc.on(channel, wrapped)
    }

    return () => {
      const targets = listeners.get(paneId)
      if (!targets) return
      targets.delete(listener)
      if (targets.size === 0) listeners.delete(paneId)
      if (listeners.size === 0 && wrapped) {
        ipc.removeListener(channel, wrapped)
        wrapped = null
      }
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
