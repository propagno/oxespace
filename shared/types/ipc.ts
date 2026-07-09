import type { CreateWorkspaceInput, PaneType, ShellProfile, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, Workspace } from './workspace'
import type { AgentProfile, AgentReadiness, CreateAgentProfileInput, UpdateAgentProfileInput } from './agent'
import type {
  CreateTaskInput,
  ReorderTasksInput,
  RunTaskInput,
  Task,
  TaskExecution,
  TaskVerifyOutputEvent,
  UpdateTaskInput,
  VerifyTaskInput
} from './task'
import type {
  GitHubBranch,
  GitHubCheckoutBranchInput,
  GitHubCheckpoint,
  GitHubCliStatus,
  GitHubCommit,
  GitHubCommitDetails,
  GitHubCommitDetailsInput,
  GitHubCommitInput,
  GitHubConnectRepositoryInput,
  GitHubConnectedRepository,
  GitHubCreateBranchInput,
  GitHubCreateCheckpointInput,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubDeleteCheckpointInput,
  GitHubMessageResult,
  GitHubPullRequest,
  GitHubPullRequestListInput,
  GitHubRelease,
  GitHubRepositorySummary,
  GitHubRestoreCheckpointInput,
  GitHubWorkflow,
  GitHubWorkflowRunDetails,
  GitHubWorkflowRun,
  GitHubWorkflowRunInput,
  GitHubWorkspaceInput,
  GitHubWorkspaceStatus
} from './github'
import type {
  AddIntegrationMemberInput,
  AttachIntegrationSessionInput,
  CreateIntegrationGroupInput,
  CreateIntegrationHandoffInput,
  IntegrationContextInput,
  IntegrationContextResult,
  IntegrationGroup,
  IntegrationHandoff,
  IntegrationSession,
  UpdateIntegrationGroupInput,
  UpdateIntegrationMemberInput
} from './integration'

export type { ShellProfile, Workspace, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, AgentProfile, AgentReadiness }
export type { Task, TaskExecution, TaskVerifyOutputEvent }
export type { GitBranchInput, GitBranchStatus, GitDiff, GitDiffFile, GitDiffHunk, GitDiffLine, GitDiffInput, GitLineType } from './git'
export type { GitHubBranch, GitHubCheckpoint, GitHubCliStatus, GitHubCommit, GitHubCommitDetails, GitHubConnectedRepository, GitHubMessageResult, GitHubPanelTab, GitHubPullRequest, GitHubRelease, GitHubRepositorySummary, GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowRunDetails, GitHubWorkspaceStatus } from './github'
export type { IntegrationGroup, IntegrationMember, IntegrationHandoff, IntegrationRole, IntegrationSession, IntegrationStatus } from './integration'

export type FileTreeNodeType = 'file' | 'directory'

export interface FileTreeNode {
  name: string
  relativePath: string
  type: FileTreeNodeType
  size: number | null
  children?: FileTreeNode[]
}

export interface FileSystemListTreeInput {
  workspaceId: string
  rootPath: string
  relativePath?: string
}

export interface FileSystemReadFileInput {
  workspaceId: string
  rootPath: string
  relativePath: string
}

export interface FileSystemReadFileResult {
  relativePath: string
  content: string
  size: number
  mtimeMs: number
}

export interface FileSystemWriteFileInput {
  workspaceId: string
  rootPath: string
  relativePath: string
  content: string
}

export interface FileSystemWriteFileResult {
  relativePath: string
  size: number
  mtimeMs: number
}

export interface FileSystemWatchFileInput {
  workspaceId: string
  rootPath: string
  relativePath: string
}

export interface FileSystemUnwatchFileInput {
  watchId: string
}

export interface FileSystemWatchFileResult {
  watchId: string
}

export interface FileSystemFileChangedEvent {
  watchId: string
  workspaceId: string
  relativePath: string
  content: string
  size: number
  mtimeMs: number
}

export interface FileSystemApi {
  listTree(input: FileSystemListTreeInput): Promise<FileTreeNode[]>
  readFile(input: FileSystemReadFileInput): Promise<FileSystemReadFileResult>
  writeFile(input: FileSystemWriteFileInput): Promise<FileSystemWriteFileResult>
  watchFile(input: FileSystemWatchFileInput): Promise<FileSystemWatchFileResult>
  unwatchFile(input: FileSystemUnwatchFileInput): Promise<void>
  onFileChanged(listener: (event: FileSystemFileChangedEvent) => void): () => void
}

export const IPC_CHANNELS = {
  app: {
    getUpdateState: 'app:get-update-state',
    checkForUpdates: 'app:check-for-updates',
    quitAndInstall: 'app:quit-and-install',
    onUpdateState: 'app:update-state'
  },
  rtk: {
    getStatus: 'rtk:get-status',
    checkForUpdate: 'rtk:check-for-update',
    updateToLatest: 'rtk:update-to-latest'
  },
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    setActive: 'workspace:set-active',
    delete: 'workspace:delete',
    closePane: 'workspace:close-pane',
    splitPane: 'workspace:split-pane',
    updatePaneType: 'workspace:update-pane-type',
    updatePaneName: 'workspace:update-pane-name',
    setPaneAgent: 'workspace:set-pane-agent',
    setPaneRootPath: 'workspace:set-pane-root-path',
    updateEditorState: 'workspace:update-editor-state',
    updateReviewState: 'workspace:update-review-state',
    updateBackgroundState: 'workspace:update-background-state',
    updateWorktreeState: 'workspace:update-worktree-state',
    reorder: 'workspace:reorder',
    updateGitHubState: 'workspace:update-github-state',
    updateSettings: 'workspace:update-settings',
    pickFolder: 'workspace:pick-folder',
    shellProfiles: 'workspace:shell-profiles',
    createGitHubTerminalPane: 'workspace:create-github-terminal-pane'
  },
  terminal: {
    start: 'terminal:start',
    write: 'terminal:write',
    resize: 'terminal:resize',
    stop: 'terminal:stop',
    restart: 'terminal:restart',
    onData: 'terminal:data',
    onExit: 'terminal:exit'
  },
  agent: {
    list:        'agent:list',
    create:      'agent:create',
    update:      'agent:update',
    delete:      'agent:delete',
    discover:    'agent:discover',
    getReadiness:'agent:get-readiness'
  },
  tasks: {
    list: 'tasks:list',
    create: 'tasks:create',
    update: 'tasks:update',
    delete: 'tasks:delete',
    reorder: 'tasks:reorder',
    run: 'tasks:run',
    verify: 'tasks:verify',
    executions: 'tasks:executions',
    onVerifyOutput: 'tasks:verify-output',
    addDependency: 'tasks:add-dependency',
    removeDependency: 'tasks:remove-dependency',
    getReady: 'tasks:get-ready'
  },
  fs: {
    listTree: 'fs:list-tree',
    readFile: 'fs:read-file',
    writeFile: 'fs:write-file',
    watchFile: 'fs:watch-file',
    unwatchFile: 'fs:unwatch-file',
    onFileChanged: 'fs:file-changed'
  },
  git: {
    getBranch: 'git:get-branch',
    getDiff: 'git:get-diff',
    onDiffUpdate: 'git:diff-update'
  },
  clipboard: {
    saveImageToTemp: 'clipboard:save-image-to-temp',
    readText: 'clipboard:read-text',
    writeText: 'clipboard:write-text'
  },
  voice: {
    transcribe: 'voice:transcribe',
    getModelStatus: 'voice:get-model-status',
    ensureModel: 'voice:ensure-model',
    onModelProgress: 'voice:on-model-progress'
  },
  notifications: {
    notify: 'notifications:notify',
    onActivate: 'notifications:on-activate'
  },
  copilot: {
    credits: 'copilot:credits'
  },
  agentCredits: {
    get: 'agent-credits:get'
  },
  contextUsage: {
    get: 'context-usage:get'
  },
  oxe: {
    detect: 'oxe:detect',
    status: 'oxe:status',
    statusSummary: 'oxe:status-summary',
    openDashboard: 'oxe:open-dashboard',
    startDashboard: 'oxe:start-dashboard',
    stopDashboard: 'oxe:stop-dashboard',
    watchEvents: 'oxe:watch-events',
    unwatchEvents: 'oxe:unwatch-events',
    onEventsChanged: 'oxe:on-events-changed'
  },
  background: {
    list: 'background:list',
    start: 'background:start',
    stop: 'background:stop',
    remove: 'background:remove',
    getOutput: 'background:get-output',
    onOutput: 'background:on-output',
    onUpdate: 'background:on-update'
  },
  session: {
    list: 'session:list',
    fork: 'session:fork',
    delete: 'session:delete',
    cleanup: 'session:cleanup'
  },
  skill: {
    list: 'skill:list',
    get: 'skill:get',
    invoke: 'skill:invoke',
    create: 'skill:create',
    onChange: 'skill:on-change'
  },
  mcp: {
    list: 'mcp:list',
    create: 'mcp:create',
    update: 'mcp:update',
    delete: 'mcp:delete',
    start: 'mcp:start',
    stop: 'mcp:stop',
    callTool: 'mcp:call-tool',
    onHealth: 'mcp:on-health'
  },
  github: {
    getCliStatus: 'github:get-cli-status',
    getWorkspaceStatus: 'github:get-workspace-status',
    fetch: 'github:fetch',
    pullFfOnly: 'github:pull-ff-only',
    stageAll: 'github:stage-all',
    commit: 'github:commit',
    generateCommitMessage: 'github:generate-commit-message',
    push: 'github:push',
    commitAndPush: 'github:commit-and-push',
    listBranches: 'github:list-branches',
    listWorktrees: 'github:list-worktrees',
    createWorktree: 'github:create-worktree',
    removeWorktree: 'github:remove-worktree',
    createBranch: 'github:create-branch',
    checkoutBranch: 'github:checkout-branch',
    listPullRequests: 'github:list-pull-requests',
    createPullRequest: 'github:create-pull-request',
    listCommits: 'github:list-commits',
    getCommitDetails: 'github:get-commit-details',
    listReleases: 'github:list-releases',
    createRelease: 'github:create-release',
    listWorkflows: 'github:list-workflows',
    listWorkflowRuns: 'github:list-workflow-runs',
    getWorkflowRunDetails: 'github:get-workflow-run-details',
    runWorkflow: 'github:run-workflow',
    rerunRun: 'github:rerun-run',
    getRunLogs: 'github:get-run-logs',
    listCheckpoints: 'github:list-checkpoints',
    createCheckpoint: 'github:create-checkpoint',
    restoreCheckpoint: 'github:restore-checkpoint',
    deleteCheckpoint: 'github:delete-checkpoint',
    listConnectedRepositories: 'github:list-connected-repositories',
    connectRepository: 'github:connect-repository'
  },
  integration: {
    listGroups: 'integration:list-groups',
    createGroup: 'integration:create-group',
    updateGroup: 'integration:update-group',
    deleteGroup: 'integration:delete-group',
    addMember: 'integration:add-member',
    updateMember: 'integration:update-member',
    removeMember: 'integration:remove-member',
    attachSession: 'integration:attach-session',
    listHandoffs: 'integration:list-handoffs',
    createHandoff: 'integration:create-handoff',
    updateHandoff: 'integration:update-handoff',
    buildContext: 'integration:build-context'
  },
  mcpInternal: {
    getStatus: 'mcp-internal:get-status',
    regenerateToken: 'mcp-internal:regenerate-token',
    onWebPreview: 'mcp-internal:on-web-preview',
    onWorktreeChanged: 'mcp-internal:on-worktree-changed'
  },
  oxeContext: {
    buildPaneManifest: 'oxe-context:build-pane-manifest'
  },
  semantic: {
    getStatus: 'semantic:get-status',
    setEnabled: 'semantic:set-enabled',
    reindex: 'semantic:reindex',
    getLogs: 'semantic:get-logs',
    onLog: 'semantic:log'
  }
} as const

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
  agentCommand?: string
  agentArgs?: string[]
  initialPrompt?: string
  disableRtk?: boolean
}

export interface TerminalWriteInput {
  paneId: string
  data: string
}

export interface TerminalResizeInput {
  paneId: string
  cols: number
  rows: number
}

export interface TerminalStopInput {
  paneId: string
}

export interface TerminalDataEvent {
  paneId: string
  data: string
}

export interface TerminalExitEvent {
  paneId: string
  exitCode: number | null
}

export interface SplitPaneInput {
  paneId: string
  direction: 'vertical' | 'horizontal'
}

export interface UpdatePaneTypeInput {
  paneId: string
  type: PaneType
}

export interface UpdatePaneNameInput {
  paneId: string
  displayName: string | null
}

export interface WorkspaceApi {
  list(): Promise<Workspace[]>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  setActive(id: string): Promise<Workspace>
  delete(id: string): Promise<void>
  closePane(id: string): Promise<Workspace | null>
  splitPane(input: SplitPaneInput): Promise<Workspace>
  updatePaneType(input: UpdatePaneTypeInput): Promise<Workspace>
  updatePaneName(input: UpdatePaneNameInput): Promise<Workspace>
  setPaneAgent(input: { paneId: string; agentProfileId: string | null; preserveSession?: boolean }): Promise<Workspace>
  setPaneRootPath(input: { paneId: string; rootPath: string | null }): Promise<Workspace>
  updateEditorState(input: UpdateWorkspaceEditorStateInput): Promise<Workspace>
  updateReviewState(input: UpdateWorkspaceReviewStateInput): Promise<Workspace>
  updateBackgroundState(input: UpdateWorkspaceBackgroundStateInput): Promise<Workspace>
  updateWorktreeState(input: UpdateWorkspaceWorktreeStateInput): Promise<Workspace>
  reorder(orderedIds: string[]): Promise<Workspace[]>
  updateGitHubState(input: UpdateWorkspaceGitHubStateInput): Promise<Workspace>
  updateSettings(input: UpdateWorkspaceSettingsInput): Promise<Workspace>
  pickFolder(): Promise<string | null>
  shellProfiles(): Promise<ShellProfile[]>
  createGitHubTerminalPane(workspaceId: string): Promise<{ id: string }>
}

export interface TerminalApi {
  start(input: TerminalStartInput): Promise<void>
  write(input: TerminalWriteInput): Promise<void>
  resize(input: TerminalResizeInput): Promise<void>
  stop(input: TerminalStopInput): Promise<void>
  restart(input: TerminalStopInput): Promise<void>
  onData(paneId: string, listener: (event: TerminalDataEvent) => void): () => void
  onExit(paneId: string, listener: (event: TerminalExitEvent) => void): () => void
}

export interface AgentApi {
  list(): Promise<AgentProfile[]>
  create(input: CreateAgentProfileInput): Promise<AgentProfile>
  update(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>
  delete(id: string): Promise<void>
  discover(forceRefresh?: boolean): Promise<AgentReadiness[]>
  getReadiness(): Promise<AgentReadiness[]>
}

export interface TaskApi {
  list(workspaceId: string): Promise<Task[]>
  create(input: CreateTaskInput): Promise<Task>
  update(id: string, input: UpdateTaskInput): Promise<Task>
  delete(id: string): Promise<void>
  reorder(input: ReorderTasksInput): Promise<Task[]>
  run(input: RunTaskInput): Promise<Task>
  verify(input: VerifyTaskInput): Promise<Task>
  executions(taskId: string): Promise<TaskExecution[]>
  onVerifyOutput(listener: (event: TaskVerifyOutputEvent) => void): () => void
  addDependency(input: { taskId: string; dependsOnTaskId: string }): Promise<Task>
  removeDependency(input: { taskId: string; dependsOnTaskId: string }): Promise<Task>
  getReady(workspaceId: string): Promise<string[]>
}

export interface GitApi {
  getBranch(input: import('./git').GitBranchInput): Promise<import('./git').GitBranchStatus>
  getDiff(input: import('./git').GitDiffInput): Promise<import('./git').GitDiff>
  onDiffUpdate(listener: (diff: import('./git').GitDiff) => void): () => void
}

export interface GitHubApi {
  getCliStatus(input: GitHubWorkspaceInput): Promise<GitHubCliStatus>
  getWorkspaceStatus(input: GitHubWorkspaceInput): Promise<GitHubWorkspaceStatus>
  fetch(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  pullFfOnly(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  stageAll(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  commit(input: GitHubCommitInput): Promise<GitHubMessageResult>
  generateCommitMessage(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  push(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  commitAndPush(input: GitHubCommitInput): Promise<GitHubMessageResult>
  listBranches(input: GitHubWorkspaceInput): Promise<GitHubBranch[]>
  createBranch(input: GitHubCreateBranchInput): Promise<GitHubMessageResult>
  checkoutBranch(input: GitHubCheckoutBranchInput): Promise<GitHubMessageResult>
  listWorktrees(input: GitHubWorkspaceInput): Promise<import('./github').GitHubWorktree[]>
  createWorktree(input: import('./github').GitHubCreateWorktreeInput): Promise<GitHubMessageResult>
  removeWorktree(input: import('./github').GitHubRemoveWorktreeInput): Promise<GitHubMessageResult>
  listPullRequests(input: GitHubPullRequestListInput): Promise<GitHubPullRequest[]>
  createPullRequest(input: GitHubCreatePullRequestInput): Promise<GitHubMessageResult>
  listCommits(input: GitHubWorkspaceInput): Promise<GitHubCommit[]>
  getCommitDetails(input: GitHubCommitDetailsInput): Promise<GitHubCommitDetails>
  listReleases(input: GitHubWorkspaceInput): Promise<GitHubRelease[]>
  createRelease(input: GitHubCreateReleaseInput): Promise<GitHubMessageResult>
  listWorkflows(input: GitHubWorkspaceInput): Promise<GitHubWorkflow[]>
  listWorkflowRuns(input: GitHubWorkspaceInput): Promise<GitHubWorkflowRun[]>
  getWorkflowRunDetails(input: { rootPath: string; runId: number }): Promise<GitHubWorkflowRunDetails>
  runWorkflow(input: GitHubWorkflowRunInput): Promise<GitHubMessageResult>
  rerunRun(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<GitHubMessageResult>
  getRunLogs(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<{ logs: string; truncated: boolean; bytes: number }>
  listCheckpoints(input: GitHubWorkspaceInput): Promise<GitHubCheckpoint[]>
  createCheckpoint(input: GitHubCreateCheckpointInput): Promise<GitHubCheckpoint>
  restoreCheckpoint(input: GitHubRestoreCheckpointInput): Promise<GitHubMessageResult>
  deleteCheckpoint(input: GitHubDeleteCheckpointInput): Promise<GitHubMessageResult>
  listConnectedRepositories(input: GitHubWorkspaceInput): Promise<GitHubConnectedRepository[]>
  connectRepository(input: GitHubConnectRepositoryInput): Promise<GitHubConnectedRepository>
}

export interface ClipboardApi {
  saveImageToTemp(): Promise<string | null>
  readText(): Promise<string>
  writeText(text: string): Promise<boolean>
}

export interface VoiceApi {
  transcribe(
    wav: Uint8Array,
    options?: import('./voice').VoiceTranscribeOptions
  ): Promise<import('./voice').VoiceTranscribeResult>
  getModelStatus(
    size?: import('./voice').VoiceModelSize
  ): Promise<import('./voice').VoiceModelStatus>
  ensureModel(
    size?: import('./voice').VoiceModelSize
  ): Promise<import('./voice').VoiceModelStatus>
  onModelProgress(
    listener: (event: import('./voice').VoiceModelProgressEvent) => void
  ): () => void
}

export interface AgentNotificationPayload {
  title: string
  body: string
  /** Pane to focus when the user clicks the notification. */
  paneId: string
  workspaceId: string
}

export interface NotificationsApi {
  notify(payload: AgentNotificationPayload): Promise<boolean>
  onActivate(listener: (payload: { paneId: string; workspaceId: string }) => void): () => void
}

export interface OxeIntegrationApi {
  detect(force?: boolean): Promise<import('./oxe').OxeDetect>
  status(rootPath: string, force?: boolean): Promise<import('./oxe').OxeStatusResult>
  /** Cheap, versioned summary for the hot path (oxe-cc ≥ 1.13; falls back to full status detection otherwise). */
  statusSummary(rootPath: string, force?: boolean): Promise<import('./oxe').OxeSummaryResult>
  /** Legacy fire-and-forget: opens the dashboard in the external browser. */
  openDashboard(rootPath: string): Promise<{ ok: boolean; error: string | null }>
  /** Start (or reuse) an embedded dashboard server and return its URL/port (oxe-cc ≥ 1.14). */
  startDashboard(rootPath: string): Promise<import('./oxe').OxeDashboardHandle>
  /** Kill the embedded dashboard server for a workspace root. */
  stopDashboard(rootPath: string): Promise<{ ok: boolean }>
  /** Watch the workspace's .oxe/ for changes; fires onEventsChanged. */
  watchEvents(rootPath: string): Promise<{ ok: boolean }>
  unwatchEvents(rootPath: string): Promise<{ ok: boolean }>
  onEventsChanged(listener: (payload: { rootPath: string }) => void): () => void
}

export interface CopilotApi {
  /** Global Copilot AI-Credits snapshot for the gh-authenticated account. */
  credits(force?: boolean): Promise<import('./copilot').CopilotCredits>
}

export interface AgentCreditsApi {
  /** Per-provider quota snapshot (Claude/Codex). Hidden for unsupported providers. */
  get(input: import('./agentCredits').AgentCreditsInput): Promise<import('./agentCredits').AgentCreditsSnapshot>
}

export interface ContextUsageApi {
  /** Live context-window % for a pane's provider (Claude/Codex/Copilot). */
  get(input: import('./contextUsage').ContextUsageInput): Promise<import('./contextUsage').ContextUsageChip>
}

export interface AppUpdateApi {
  getUpdateState(): Promise<import('./updater').AppUpdateState>
  checkForUpdates(): Promise<import('./updater').AppUpdateState>
  quitAndInstall(): Promise<boolean>
  onUpdateState(listener: (state: import('./updater').AppUpdateState) => void): () => void
}

export interface RtkApi {
  getStatus(): Promise<import('./updater').RtkUpdateState>
  checkForUpdate(): Promise<import('./updater').RtkUpdateState>
  updateToLatest(): Promise<import('./updater').RtkUpdateState>
}

export interface OxeApi {
  app: {
    version: string
  } & AppUpdateApi
  rtk: RtkApi
  workspace: WorkspaceApi
  terminal: TerminalApi
  agent: AgentApi
  tasks: TaskApi
  fs: FileSystemApi
  git: GitApi
  github: GitHubApi
  integration: IntegrationApi
  clipboard: ClipboardApi
  voice: VoiceApi
  notifications: NotificationsApi
  oxe: OxeIntegrationApi
  copilot: CopilotApi
  agentCredits: AgentCreditsApi
  contextUsage: ContextUsageApi
  background: BackgroundApi
  session: SessionApi
  skill: SkillApi
  mcp: McpApi
  mcpInternal: McpInternalApi
  oxeContext: OxeContextApi
  semantic: SemanticApi
}

export interface SemanticStatus {
  enabled: boolean
  workerReady: boolean
  indexing: boolean
  count: number
  lastError: string | null
  /** Embedding model id (e.g. Xenova/multilingual-e5-small). */
  modelId?: string
}

export type SemanticLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One line of the semantic engine's activity log, surfaced for transparency. */
export interface SemanticLogEntry {
  ts: number
  level: SemanticLogLevel
  message: string
  workspaceId?: string
  file?: string
}

export interface SemanticApi {
  getStatus(workspaceId: string): Promise<SemanticStatus>
  setEnabled(input: { workspaceId: string; enabled: boolean }): Promise<SemanticStatus>
  reindex(workspaceId: string): Promise<SemanticStatus>
  getLogs(): Promise<SemanticLogEntry[]>
  onLog(callback: (entry: SemanticLogEntry) => void): () => void
}

export interface McpInternalApi {
  getStatus(): Promise<import('./mcp-internal').InternalMcpStatus>
  regenerateToken(): Promise<import('./mcp-internal').InternalMcpStatus>
  onWebPreview(listener: (event: import('./mcp-internal').InternalMcpWebPreviewEvent) => void): () => void
  onWorktreeChanged(listener: (event: import('./mcp-internal').InternalMcpWorktreeChangedEvent) => void): () => void
}

export interface OxeContextApi {
  buildPaneManifest(input: { workspaceId: string; paneId: string }): Promise<string>
}

export interface IntegrationApi {
  listGroups(input?: { workspaceId?: string | null }): Promise<IntegrationGroup[]>
  createGroup(input: CreateIntegrationGroupInput): Promise<IntegrationGroup>
  updateGroup(input: UpdateIntegrationGroupInput): Promise<IntegrationGroup>
  deleteGroup(groupId: string): Promise<void>
  addMember(input: AddIntegrationMemberInput): Promise<IntegrationGroup>
  updateMember(input: UpdateIntegrationMemberInput): Promise<IntegrationGroup>
  removeMember(memberId: string): Promise<IntegrationGroup>
  attachSession(input: AttachIntegrationSessionInput): Promise<IntegrationSession>
  listHandoffs(groupId: string): Promise<IntegrationHandoff[]>
  createHandoff(input: CreateIntegrationHandoffInput): Promise<IntegrationHandoff>
  updateHandoff(input: import('./integration').UpdateIntegrationHandoffInput): Promise<IntegrationHandoff>
  buildContext(input: IntegrationContextInput): Promise<IntegrationContextResult>
}

export interface BackgroundApi {
  list(workspaceId: string): Promise<import('./background').BackgroundJob[]>
  start(input: import('./background').StartBackgroundJobInput): Promise<import('./background').BackgroundJob>
  stop(jobId: string): Promise<void>
  remove(jobId: string): Promise<void>
  getOutput(jobId: string): Promise<import('./background').BackgroundJobOutputChunk>
  onOutput(listener: (event: import('./background').BackgroundJobOutputEvent) => void): () => void
  onUpdate(listener: (event: import('./background').BackgroundJobUpdateEvent) => void): () => void
}

export interface SessionApi {
  list(input: { workspaceId: string; workspaceRootPath: string; provider: import('./agent').AgentProvider }): Promise<import('./session').SessionSummary[]>
  fork(input: import('./session').ForkSessionInput): Promise<import('./session').ForkSessionResult>
  delete(input: { workspaceRootPath: string; sessionId: string; provider: import('./agent').AgentProvider }): Promise<boolean>
  cleanup(input: { workspaceId: string; workspaceRootPath: string; provider: import('./agent').AgentProvider }): Promise<number>
}

export interface SkillApi {
  list(input?: { workspaceRootPath?: string }): Promise<import('./skill').SkillDefinition[]>
  get(name: string): Promise<import('./skill').SkillDefinition | null>
  invoke(input: import('./skill').InvokeSkillInput): Promise<void>
  create(input: import('./skill').CreateSkillInput): Promise<import('./skill').SkillDefinition>
  onChange(listener: () => void): () => void
}

export interface McpApi {
  list(workspaceId: string | null): Promise<import('./mcp').McpServer[]>
  create(input: import('./mcp').CreateMcpServerInput): Promise<import('./mcp').McpServer>
  update(input: import('./mcp').UpdateMcpServerInput): Promise<import('./mcp').McpServer>
  delete(id: string): Promise<void>
  start(id: string): Promise<import('./mcp').McpToolDescriptor[]>
  stop(id: string): Promise<void>
  callTool(input: import('./mcp').McpCallToolInput): Promise<import('./mcp').McpCallToolResult>
  onHealth(listener: (event: import('./mcp').McpServerHealthEvent) => void): () => void
}
