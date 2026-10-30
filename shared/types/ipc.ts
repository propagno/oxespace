import type { CreateWorkspaceInput, ShellProfile, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, Workspace } from './workspace'
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
  GitHubFileInput,
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
import type { FileSystemApi } from './filesystem'

export type { ShellProfile, Workspace, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, AgentProfile, AgentReadiness }
export type { Task, TaskExecution, TaskVerifyOutputEvent }
export type { GitBranchInput, GitBranchStatus, GitDiff, GitDiffFile, GitDiffHunk, GitDiffLine, GitDiffInput, GitLineType } from './git'
export type { GitHubBranch, GitHubCheckpoint, GitHubCliStatus, GitHubCommit, GitHubCommitDetails, GitHubConnectedRepository, GitHubMessageResult, GitHubPanelTab, GitHubPullRequest, GitHubRelease, GitHubRepositorySummary, GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowRunDetails, GitHubWorkspaceStatus } from './github'
export type { IntegrationGroup, IntegrationMember, IntegrationHandoff, IntegrationRole, IntegrationSession, IntegrationStatus } from './integration'
export type { FileSystemApi, FileSystemFileChangedEvent, FileSystemListTreeInput, FileSystemReadBinaryInput, FileSystemReadBinaryResult, FileSystemReadFileInput, FileSystemReadFileResult, FileSystemUnwatchFileInput, FileSystemWatchFileInput, FileSystemWatchFileResult, FileSystemWriteFileInput, FileSystemWriteFileResult, FileTreeNode, FileTreeNodeType } from './filesystem'
import type { TerminalStartInput, TerminalWriteInput, TerminalResizeInput, TerminalStopInput, TerminalDataEvent, TerminalExitEvent, TerminalActivityEvent, TerminalAttachInput, TerminalAttachResult, TerminalStatusResult, SplitPaneInput, UpdatePaneTypeInput, UpdatePaneNameInput } from './ipc/terminal'
import type { SemanticStatus, SemanticRetrievalSource, SemanticVectorStatus, SemanticUsage, SemanticUsageBucket, SemanticSearchMode, SemanticConfidence, SemanticIndexCoverage, SemanticLastQuery, SemanticLogLevel, SemanticLogEntry, SemanticQueryHit, SemanticApi } from './ipc/semantic'
export type { TerminalStartInput, TerminalWriteInput, TerminalResizeInput, TerminalStopInput, TerminalDataEvent, TerminalExitEvent, TerminalActivityEvent, TerminalAttachInput, TerminalAttachResult, TerminalStatusResult, SplitPaneInput, UpdatePaneTypeInput, UpdatePaneNameInput } from './ipc/terminal'
export type { SemanticStatus, SemanticRetrievalSource, SemanticVectorStatus, SemanticUsage, SemanticUsageBucket, SemanticSearchMode, SemanticConfidence, SemanticIndexCoverage, SemanticLastQuery, SemanticLogLevel, SemanticLogEntry, SemanticQueryHit, SemanticApi } from './ipc/semantic'

export const IPC_CHANNELS = {
  team: { command: 'team:command', messages: 'team:messages', send: 'team:send' },
  agentAccount: { read: 'agent-account:read', login: 'agent-account:login', logout: 'agent-account:logout', cancel: 'agent-account:cancel', code: 'agent-account:code', browser: 'agent-account:browser', changed: 'agent-account:changed' },
  thread: { projectDiff: 'thread:project-diff', artifact: 'thread:artifact', exportPortable: 'thread:export-portable', importPortable: 'thread:import-portable', models: 'thread:models', configure: 'thread:configure', command: 'thread:command', recover: 'thread:recover', observe: 'thread:observe', commands: 'thread:commands', projects: 'thread:projects', addProject: 'thread:project-add', relinkProject: 'thread:project-relink', setProjectHidden: 'thread:project-hidden', list: 'thread:list', pendingRequestsAll: 'thread:pending-requests-all', respondPending: 'thread:respond-pending', create: 'thread:create', read: 'thread:read', history: 'thread:history', attach: 'thread:attach', removeAttachment: 'thread:remove-attachment', send: 'thread:send', steer: 'thread:steer', stopTask: 'thread:stop-task', turnFiles: 'thread:turn-files', undoTurnFile: 'thread:undo-turn-file', turnFileHunks: 'thread:turn-file-hunks', undoTurnHunk: 'thread:undo-turn-hunk', permissionRules: 'thread:permission-rules', addPermissionRule: 'thread:permission-rule-add', removePermissionRule: 'thread:permission-rule-remove', auditLog: 'thread:audit-log', debugEvents: 'thread:debug-events', autoApproveReads: 'thread:auto-approve-reads', setAutoApproveReads: 'thread:set-auto-approve-reads', idleSuspendMinutes: 'thread:idle-suspend-minutes', setIdleSuspendMinutes: 'thread:set-idle-suspend-minutes', shellCheck: 'thread:shell-check', usageSummary: 'thread:usage-summary', workRuns: 'thread:work-runs', cancelWork: 'thread:work-cancel', updateQueued: 'thread:queue-update', deleteQueued: 'thread:queue-delete', reorderQueued: 'thread:queue-reorder', readSince: 'thread:read-since', rewind: 'thread:rewind', redoRewind: 'thread:redo-rewind', retryTurn: 'thread:retry-turn', contextUsage: 'thread:context-usage', resumeQueue: 'thread:queue-resume', sendQueuedNow: 'thread:queue-send-now', interrupt: 'thread:interrupt', approve: 'thread:approve', respond: 'thread:respond', pin: 'thread:pin', changed: 'thread:changed', worktreeInspect: 'thread:worktree-inspect', worktreeFinish: 'thread:worktree-finish' },
  delegation: { create: 'delegation:create', status: 'delegation:status', preview: 'delegation:preview', configure: 'delegation:configure', control: 'delegation:control', changed: 'delegation:changed', configureTarget: 'delegation:configure-target', adopt: 'delegation:adopt' },
  memory: {
    status: 'memory:status', configure: 'memory:configure', install: 'memory:install', rollback: 'memory:rollback',
    setupAgents: 'memory:setup-agents', search: 'memory:search', recent: 'memory:recent',
    handoffs: 'memory:handoffs', storage: 'memory:storage', acceptHandoff: 'memory:accept-handoff',
    notes: 'memory:notes', noteUpdate: 'memory:note-update', noteDelete: 'memory:note-delete', export: 'memory:export', reset: 'memory:reset'
  },
  app: {
    getUpdateState: 'app:get-update-state',
    checkForUpdates: 'app:check-for-updates',
    quitAndInstall: 'app:quit-and-install',
    downloadUpdate: 'app:download-update',
    setUpdatePreferences: 'app:set-update-preferences',
    onUpdateState: 'app:update-state',
    setAppearance: 'app:set-appearance',
    setLanguage: 'app:set-language',
    setUiScale: 'app:set-ui-scale',
    connectivity: 'app:connectivity', onConnectivity: 'app:connectivity-changed', about: 'app:about'
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
    createPane: 'workspace:create-pane',
    /** Main changed a workspace on its own (an agent opened or closed a pane): the new state. */
    onChanged: 'workspace:on-changed',
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
    // A terminal VIEW attaches to and detaches from a session whose lifetime is
    // owned by the main process. Unmounting a pane no longer kills its shell,
    // so returning to a workspace does not pay a respawn.
    attach: 'terminal:attach',
    detach: 'terminal:detach',
    status: 'terminal:status',
    onData: 'terminal:data',
    onExit: 'terminal:exit',
    onActivity: 'terminal:activity'
  },
  agent: {
    list:        'agent:list',
    create:      'agent:create',
    update:      'agent:update',
    delete:      'agent:delete',
    discover:    'agent:discover',
    getReadiness:'agent:get-readiness',
    compatibility: 'agent:compatibility'
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
    readBinary: 'fs:read-binary',
    writeFile: 'fs:write-file',
    watchFile: 'fs:watch-file',
    unwatchFile: 'fs:unwatch-file',
    onFileChanged: 'fs:file-changed'
  },
  git: {
    getBranch: 'git:get-branch',
    getStatus: 'git:get-status',
    getDiff: 'git:get-diff',
    getDiffSummary: 'git:diff-summary',
    getFileOriginal: 'git:file-original',
    getFileAtRef: 'git:file-at-ref',
    onDiffUpdate: 'git:diff-update'
  },
  search: {
    run: 'search:run',
    cancel: 'search:cancel',
    listFiles: 'search:list-files'
  },
  linear: {
    getStatus: 'linear:get-status',
    setApiKey: 'linear:set-api-key',
    clearApiKey: 'linear:clear-api-key',
    listTeams: 'linear:list-teams',
    listIssues: 'linear:list-issues',
    getIssue: 'linear:get-issue',
    createWorktreeFromIssue: 'linear:worktree-from-issue'
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
  oxeQuery: {
    call: 'oxeQuery:call',
    onEvent: 'oxeQuery:event'
  },
  oxePod: { call: 'oxePod:call', onEvent: 'oxePod:event' },
  oxePost: { call: 'oxePost:call' },
  automations: {
    list: 'automations:list',
    create: 'automations:create',
    setEnabled: 'automations:set-enabled',
    remove: 'automations:remove',
    runNow: 'automations:run-now',
    runs: 'automations:runs',
    onChange: 'automations:on-change'
  },
  agentHooks: {
    status: 'agent-hooks:status',
    install: 'agent-hooks:install',
    remove: 'agent-hooks:remove',
    onStatus: 'agent-hooks:on-status',
    onLocation: 'agent-hooks:on-location'
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
    cleanup: 'session:cleanup',
    search: 'session:search'
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
    test: 'mcp:test',
    diagnose: 'mcp:diagnose',
    stop: 'mcp:stop',
    openSignIn: 'mcp:open-sign-in',
    discover: 'mcp:discover',
    importDiscovered: 'mcp:import-discovered',
    callTool: 'mcp:call-tool',
    onHealth: 'mcp:on-health'
  },
  github: {
    getCliStatus: 'github:get-cli-status',
    getWorkspaceStatus: 'github:get-workspace-status',
    fetch: 'github:fetch',
    pullFfOnly: 'github:pull-ff-only',
    stageAll: 'github:stage-all',
    stageFile: 'github:stage-file',
    unstageFile: 'github:unstage-file',
    commit: 'github:commit',
    generateCommitMessage: 'github:generate-commit-message',
    push: 'github:push',
    commitAndPush: 'github:commit-and-push',
    listBranches: 'github:list-branches',
    listWorktrees: 'github:list-worktrees',
    createWorktree: 'github:create-worktree',
    removeWorktree: 'github:remove-worktree',
    resolveWorktreeBase: 'github:resolve-worktree-base',
    getWorktreeStatus: 'github:get-worktree-status',
    getRepoConfig: 'github:get-repo-config',
    scanWorktreeCleanup: 'github:scan-worktree-cleanup',
    removeWorktreeCleanup: 'github:remove-worktree-cleanup',
    approveRepoHook: 'github:approve-repo-hook',
    createBranch: 'github:create-branch',
    checkoutBranch: 'github:checkout-branch',
    listPullRequests: 'github:list-pull-requests',
    createPullRequest: 'github:create-pull-request',
    getPullRequestStatus: 'github:get-pull-request-status',
    setPullRequestAutoMerge: 'github:set-pull-request-auto-merge',
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
  agentState: {
    list: 'agent-state:list',
    markSeen: 'agent-state:mark-seen',
    explain: 'agent-state:explain',
    onChanged: 'agent-state:changed'
  },
  mcpInternal: {
    getStatus: 'mcp-internal:get-status',
    regenerateToken: 'mcp-internal:regenerate-token',
    captureWebPreview: 'mcp-internal:capture-web-preview',
    onWebPreview: 'mcp-internal:on-web-preview',
    onWorktreeChanged: 'mcp-internal:on-worktree-changed',
    actionAudit: 'mcp-internal:action-audit',
    exportAudit: 'mcp-internal:export-audit'
  },
  browserPreview: {
    session: 'browser-preview:session',
    mount: 'browser-preview:mount',
    bounds: 'browser-preview:bounds',
    setAccess: 'browser-preview:set-access',
    designMode: 'browser-preview:design-mode',
    setZoom: 'browser-preview:set-zoom',
    reload: 'browser-preview:reload',
    back: 'browser-preview:back',
    forward: 'browser-preview:forward',
    captureElement: 'browser-preview:capture-element',
    captureClipboard: 'browser-preview:capture-clipboard',
    close: 'browser-preview:close',
    onEvent: 'browser-preview:event'
  },
  oxeContext: {
    buildPaneManifest: 'oxe-context:build-pane-manifest'
  },
  semantic: {
    getStatus: 'semantic:get-status',
    setEnabled: 'semantic:set-enabled',
    projectStatus: 'semantic:project-status',
    setProjectEnabled: 'semantic:set-project-enabled',
    setMode: 'semantic:set-mode',
    reindex: 'semantic:reindex',
    getLogs: 'semantic:get-logs',
    onLog: 'semantic:log',
    query: 'semantic:query',
    getVectorStatus: 'semantic:get-vector-status',
    setVectorIndex: 'semantic:set-vector-index',
    downloadModel: 'semantic:download-model',
    importModel: 'semantic:import-model',
    removeModel: 'semantic:remove-model',
    getUsage: 'semantic:get-usage'
  },
  diagnostics: {
    getSnapshot: 'diagnostics:get-snapshot',
    exportReport: 'diagnostics:export-report',
    reportInteractive: 'diagnostics:report-interactive',
    buildIssueReport: 'diagnostics:build-issue-report',
    recordFirstAnswer: 'diagnostics:record-first-answer'
  },
  policy: {
    get: 'policy:get'
  }
} as const

export interface WorkspaceApi {
  list(): Promise<Workspace[]>
  onChanged(listener: (workspace: Workspace) => void): () => void
  create(input: CreateWorkspaceInput): Promise<Workspace>
  setActive(id: string): Promise<Workspace>
  delete(id: string): Promise<void>
  closePane(id: string): Promise<Workspace | null>
  splitPane(input: SplitPaneInput): Promise<Workspace>
  createPane(input: { workspaceId: string }): Promise<{ workspace: Workspace; paneId: string }>
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
  attach(input: TerminalAttachInput): Promise<TerminalAttachResult>
  detach(input: TerminalStopInput): Promise<void>
  status(paneId: string): Promise<TerminalStatusResult>
  onData(paneId: string, listener: (event: TerminalDataEvent) => void): () => void
  onExit(paneId: string, listener: (event: TerminalExitEvent) => void): () => void
  onActivity(paneId: string, listener: (event: TerminalActivityEvent) => void): () => void
}

export interface AgentApi {
  list(): Promise<AgentProfile[]>
  create(input: CreateAgentProfileInput): Promise<AgentProfile>
  update(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>
  delete(id: string): Promise<void>
  discover(forceRefresh?: boolean): Promise<AgentReadiness[]>
  getReadiness(): Promise<AgentReadiness[]>
  /** The last nightly provider contract result; null when it cannot be read. */
  compatibility?(): Promise<import('../providerCompatibility').ProviderCompatibility | null>
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
  getStatus(input: import('./git').GitBranchInput): Promise<import('./git').GitControlStatus>
  getDiff(input: import('./git').GitDiffInput): Promise<import('./git').GitDiff>
  getDiffSummary(input: import('./git').GitDiffInput): Promise<import('./git').GitDiffSummary>
  getFileOriginal(input: import('./git').GitFileOriginalInput): Promise<import('./git').GitFileOriginal>
  getFileAtRef(input: import('./git').GitFileAtRefInput): Promise<import('./git').GitFileOriginal>
  onDiffUpdate(listener: (diff: import('./git').GitDiff) => void): () => void
}

export interface SearchApi {
  run(input: import('./search').SearchInput): Promise<import('./search').SearchResult>
  cancel(): Promise<void>
  listFiles(input: import('./search').SearchFilesInput): Promise<import('./search').SearchFilesResult>
}

export interface LinearApi {
  getStatus(): Promise<import('./linear').LinearStatus>
  setApiKey(input: import('./linear').LinearSetApiKeyInput): Promise<import('./linear').LinearStatus>
  clearApiKey(): Promise<void>
  listTeams(): Promise<import('./linear').LinearTeam[]>
  listIssues(input: import('./linear').LinearListIssuesInput): Promise<import('./linear').LinearIssue[]>
  getIssue(input: { issueId: string }): Promise<import('./linear').LinearIssue>
  createWorktreeFromIssue(
    input: import('./linear').LinearWorktreeFromIssueInput
  ): Promise<import('./linear').LinearWorktreeFromIssueResult>
}

export interface GitHubApi {
  getCliStatus(input: GitHubWorkspaceInput): Promise<GitHubCliStatus>
  getWorkspaceStatus(input: GitHubWorkspaceInput): Promise<GitHubWorkspaceStatus>
  fetch(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  pullFfOnly(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  stageAll(input: GitHubWorkspaceInput): Promise<GitHubMessageResult>
  stageFile(input: GitHubFileInput): Promise<GitHubMessageResult>
  unstageFile(input: GitHubFileInput): Promise<GitHubMessageResult>
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
  resolveWorktreeBase(input: import('./github').GitHubWorkspaceInput): Promise<import('./github').GitHubWorktreeBase>
  getWorktreeStatus(input: import('./github').GitHubWorktreePathInput): Promise<import('./github').GitHubWorktreeStatus>
  getRepoConfig(input: { rootPath: string }): Promise<import('./repo-config').RepoConfigSnapshot>
  scanWorktreeCleanup(input: import('./worktree-cleanup').WorktreeCleanupScanInput): Promise<import('./worktree-cleanup').WorktreeCleanupCandidate[]>
  removeWorktreeCleanup(input: import('./worktree-cleanup').WorktreeCleanupRemoveInput): Promise<import('./worktree-cleanup').WorktreeCleanupRemoveResult[]>
  /** Approves the hook script whose hash the user was shown; refused if the file changed since. */
  approveRepoHook(input: { rootPath: string; kind: import('./repo-config').RepoHookKind; contentHash: string }): Promise<import('./repo-config').RepoConfigSnapshot>
  listPullRequests(input: GitHubPullRequestListInput): Promise<GitHubPullRequest[]>
  createPullRequest(input: GitHubCreatePullRequestInput): Promise<GitHubMessageResult>
  getPullRequestStatus(input: GitHubWorkspaceInput): Promise<import('./github').GitHubPrStatus | null>
  setPullRequestAutoMerge(input: import('./github').GitHubPrAutoMergeInput): Promise<GitHubMessageResult>
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
  /** What the notification is about; the main process picks the image. Without it, the app icon. */
  icon?: import('./app').NotificationIcon
}

export interface AutomationsApi {
  list(): Promise<import('./automation').Automation[]>
  create(input: import('./automation').AutomationInput): Promise<import('./automation').Automation>
  setEnabled(input: { id: string; enabled: boolean }): Promise<import('./automation').Automation>
  remove(id: string): Promise<void>
  runNow(id: string): Promise<import('./automation').AutomationRun | null>
  runs(id: string): Promise<import('./automation').AutomationRun[]>
  onChange(listener: (event: { automationId: string; run: import('./automation').AutomationRun | null }) => void): () => void
}

export interface AgentHooksApi {
  status(): Promise<import('./agent-hooks').AgentHooksStatus[]>
  install(agent: import('./agent-hooks').AgentHookAgent): Promise<import('./agent-hooks').AgentHooksStatus>
  remove(agent: import('./agent-hooks').AgentHookAgent): Promise<import('./agent-hooks').AgentHooksStatus>
  /** Pane status pushed by an agent's own lifecycle hooks. */
  onStatus(listener: (event: import('./agent-hooks').AgentHookStatusEvent) => void): () => void
  /** The directory an agent session reports working in, sent when it changes. */
  onLocation(listener: (event: import('./agent-hooks').AgentHookLocationEvent) => void): () => void
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
  /** Downloads an available update when the mode does not do it on its own. */
  downloadUpdate?(): Promise<import('./updater').AppUpdateState>
  setUpdatePreferences?(preferences: import('./updater').AppUpdatePreferences): Promise<import('./updater').AppUpdateState>
  onUpdateState(listener: (state: import('./updater').AppUpdateState) => void): () => void
  /** Mirrors the person's light/dark choice into the native window; resolves to the mode in effect. */
  setAppearance?(mode: 'system' | 'light' | 'dark'): Promise<'light' | 'dark'>
  /** Tells the main process which language the interface shows, for native dialogs and notifications. */
  setLanguage?(language: import('../i18n').Language): Promise<void>
  /** Zooms the whole window (0.9–1.25) and saves it for the next start; resolves to the factor in effect. */
  setUiScale?(factor: number): Promise<number>
}

export interface RtkApi {
  getStatus(): Promise<import('./updater').RtkUpdateState>
  checkForUpdate(): Promise<import('./updater').RtkUpdateState>
  updateToLatest(): Promise<import('./updater').RtkUpdateState>
}

export interface OxeApi {
  team?: import('./team').TeamApi
  agentAccount?: import('./agentAuth').AgentAccountApi
  thread?: import('./thread').ThreadApi
  delegation: import('./delegation').DelegationApi
  memory: import('./memory').MemoryApi
  app: {
    version: string
    /** Host OS, so renderer code can build platform-correct shell commands. */
    platform: NodeJS.Platform
    /** The operating system's locale (Electron's app.getLocale()), which picks the default interface language. */
    locale: string
  } & AppUpdateApi & import('./app').AppInfoApi
  rtk: RtkApi
  workspace: WorkspaceApi
  terminal: TerminalApi
  agent: AgentApi
  tasks: TaskApi
  fs: FileSystemApi
  git: GitApi
  search: SearchApi
  linear: LinearApi
  github: GitHubApi
  integration: IntegrationApi
  clipboard: ClipboardApi
  voice: VoiceApi
  notifications: NotificationsApi
  agentHooks: AgentHooksApi
  automations: AutomationsApi
  oxeQuery: import('./oxequery').OxeQueryApi
  oxePod: import('./oxepod').OxePodApi
  oxePost: import('../oxepost/types').OxePostApi
  oxe: OxeIntegrationApi
  copilot: CopilotApi
  agentCredits: AgentCreditsApi
  contextUsage: ContextUsageApi
  background: BackgroundApi
  session: SessionApi
  skill: SkillApi
  mcp: McpApi
  mcpInternal: McpInternalApi
  agentState: import('./agent-state').AgentStateApi
  browserPreview: import('./browser-preview').BrowserPreviewApi
  oxeContext: OxeContextApi
  semantic: SemanticApi
  diagnostics: import('./diagnostics').DiagnosticsApi
  policy: import('../policy').PolicyApi
}

export interface McpInternalApi {
  getStatus(): Promise<import('./mcp-internal').InternalMcpStatus>
  regenerateToken(): Promise<import('./mcp-internal').InternalMcpStatus>
  /** Copies the visible Web Preview frame to the system clipboard. */
  captureWebPreview(): Promise<void>
  onWebPreview(listener: (event: import('./mcp-internal').InternalMcpWebPreviewEvent) => void): () => void
  onWorktreeChanged(listener: (event: import('./mcp-internal').InternalMcpWorktreeChangedEvent) => void): () => void
  /** Recent changes agents made through the OXESpace MCP tools, newest first. */
  actionAudit(limit?: number): Promise<import('./mcp-internal').AgentActionEntry[]>
  /** Saves every audit entry still kept as JSON lines; the path, or null when the person cancels. */
  exportAudit(): Promise<string | null>
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
  /** Full-text search across the native Claude Code and Codex transcripts. */
  search(input: import('./session-search').SessionSearchInput): Promise<import('./session-search').SessionSearchResult>
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
  /** Reopens the browser sign-in page of a server that is waiting to authenticate. */
  /** Handshake and tool list, then the server is let go; the outcome is on the returned server. */
  test(id: string): Promise<import('./mcp').McpServer>
  /** A test plus the Node.js version the server would run on, to explain why it failed. */
  diagnose?(id: string): Promise<import('./mcp').McpDiagnosis>
  openSignIn(id: string): Promise<boolean>
  callTool(input: import('./mcp').McpCallToolInput): Promise<import('./mcp').McpCallToolResult>
  /** Servers Claude Desktop, Cursor and Windsurf already have, without their secret values. */
  discover?(workspaceId: string | null): Promise<import('./mcp').McpDiscoverySource[]>
  /** Creates the named servers of one source, untrusted, in the global or workspace scope. */
  importDiscovered?(input: { workspaceId: string | null; source: import('./mcp').McpDiscoverySource['id']; names: string[] }): Promise<import('./mcp').McpImportResult>
  onHealth(listener: (event: import('./mcp').McpServerHealthEvent) => void): () => void
}
