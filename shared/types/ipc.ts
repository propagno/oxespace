import type { CreateWorkspaceInput, PaneType, ShellProfile, UpdateWorkspaceAgentsStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceOxeStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, Workspace } from './workspace'
import type { AgentProfile, AgentReadiness, CreateAgentProfileInput, UpdateAgentProfileInput } from './agent'
import type {
  AgentWorkflowArtifact,
  AgentWorkflowRun,
  AgentWorkflowRunDetails,
  AppendAgentWorkflowArtifactInput,
  CompleteManualAgentWorkflowStepInput,
  CreateAgentWorkflowRunInput,
  PrepareAgentWorkflowStepInput,
  RunAgentWorkflowStepInput,
  UpdateWorkspaceAgentRoleBindingsInput,
  WorkspaceAgentRoleBinding
} from './agent-workflow'
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

export type { ShellProfile, Workspace, UpdateWorkspaceAgentsStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceOxeStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, AgentProfile, AgentReadiness }
export type { Task, TaskExecution, TaskVerifyOutputEvent }
export type { AgentWorkflowArtifact, AgentWorkflowRun, AgentWorkflowRunDetails, WorkspaceAgentRoleBinding }
export type { OxeGraphNode, OxeGraphEdge, OxeExecutionGraph, OxeExecutionGraphMeta, NodeType, EdgeType, NodeStatus } from './oxe-graph'
export type { GitDiff, GitDiffFile, GitDiffHunk, GitDiffLine, GitDiffInput, GitLineType } from './git'

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

export type OxeArtifactKind = 'state' | 'spec' | 'plan' | 'verify' | 'activeRun' | 'events' | 'summary' | 'other'
export type OxeArtifactGroup = 'operational' | 'rationality' | 'runtime' | 'evidence' | 'context' | 'product' | 'release'
export type OxeViewFreshness = 'fresh' | 'stale' | 'dirty' | 'unknown'

export interface OxeSuggestedAction {
  label: string
  command: string
  mode: 'terminal' | 'copy' | 'open_file'
}

export interface OxeWorkspaceInput {
  workspaceId: string
  rootPath: string
}

export interface OxeArtifactSummary {
  kind: OxeArtifactKind
  label: string
  relativePath: string
  exists: boolean
  size: number | null
  mtimeMs: number | null
  group?: OxeArtifactGroup
  priority?: number
}

export interface OxeEngineStatus {
  available: boolean
  version: string | null
  command: string
  message: string | null
}

export interface OxeStateSummary {
  status: string | null
  runId: string | null
  runtimeStatus: string | null
  lifecycleStatus: string | null
  nextStep: string | null
}

export interface OxeFreshness {
  state: OxeViewFreshness
  reason: string | null
  lastStatusAt: string | null
  latestWorkspaceMtimeMs: number | null
  dirtyFiles: string[]
  suggestedActions: OxeSuggestedAction[]
}

export interface OxeStatus {
  workspaceId: string
  rootPath: string
  isOxeProject: boolean
  engine: OxeEngineStatus
  state: OxeStateSummary | null
  artifacts: OxeArtifactSummary[]
  warnings: string[]
  updatedAt: string
  rawStatusJson?: unknown
  healthStatus?: string | null
  nextStep?: string | null
  cursorCmd?: string | null
  executionRationality?: unknown
  activeRun?: unknown
  contextQuality?: unknown
  diagnostics?: unknown
  semanticsDrift?: unknown
  packFreshness?: unknown
  freshness?: OxeFreshness
}

export interface OxeWorkspaceApi {
  getStatus(input: OxeWorkspaceInput): Promise<OxeStatus>
  getStatusJson(input: OxeWorkspaceInput): Promise<OxeStatus>
  listArtifacts(input: OxeWorkspaceInput): Promise<OxeArtifactSummary[]>
  listArtifactsRich(input: OxeWorkspaceInput): Promise<OxeArtifactSummary[]>
  getFreshness(input: OxeWorkspaceInput): Promise<OxeFreshness>
  onWorkspaceDrift(listener: (event: OxeFreshness & { workspaceId: string }) => void): () => void
  getGraph(input: OxeWorkspaceInput): Promise<import('./oxe-graph').OxeExecutionGraph>
  onGraphUpdate(listener: (graph: import('./oxe-graph').OxeExecutionGraph) => void): () => void
}

export const IPC_CHANNELS = {
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    setActive: 'workspace:set-active',
    delete: 'workspace:delete',
    closePane: 'workspace:close-pane',
    splitPane: 'workspace:split-pane',
    updatePaneType: 'workspace:update-pane-type',
    updatePaneName: 'workspace:update-pane-name',
    updateEditorState: 'workspace:update-editor-state',
    updateOxeState: 'workspace:update-oxe-state',
    updateAgentsState: 'workspace:update-agents-state',
    updateReviewState: 'workspace:update-review-state',
    updateSettings: 'workspace:update-settings',
    pickFolder: 'workspace:pick-folder',
    shellProfiles: 'workspace:shell-profiles'
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
    onVerifyOutput: 'tasks:verify-output'
  },
  fs: {
    listTree: 'fs:list-tree',
    readFile: 'fs:read-file',
    writeFile: 'fs:write-file',
    watchFile: 'fs:watch-file',
    unwatchFile: 'fs:unwatch-file',
    onFileChanged: 'fs:file-changed'
  },
  oxe: {
    getStatus: 'oxe:get-status',
    getStatusJson: 'oxe:get-status-json',
    listArtifacts: 'oxe:list-artifacts',
    listArtifactsRich: 'oxe:list-artifacts-rich',
    getFreshness: 'oxe:get-freshness',
    onWorkspaceDrift: 'oxe:workspace-drift',
    getGraph: 'oxe:get-graph',
    onGraphUpdate: 'oxe:graph-update'
  },
  agentWorkflow: {
    listRuns: 'agent-workflow:list-runs',
    createRun: 'agent-workflow:create-run',
    getRun: 'agent-workflow:get-run',
    updateRoleBindings: 'agent-workflow:update-role-bindings',
    getRoleBindings: 'agent-workflow:get-role-bindings',
    prepareStep: 'agent-workflow:prepare-step',
    runStep: 'agent-workflow:run-step',
    completeManualStep: 'agent-workflow:complete-manual-step',
    appendArtifact: 'agent-workflow:append-artifact'
  },
  git: {
    getDiff: 'git:get-diff',
    onDiffUpdate: 'git:diff-update'
  }
} as const

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
  agentCommand?: string
  initialPrompt?: string
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
  closePane(id: string): Promise<void>
  splitPane(input: SplitPaneInput): Promise<Workspace>
  updatePaneType(input: UpdatePaneTypeInput): Promise<Workspace>
  updatePaneName(input: UpdatePaneNameInput): Promise<Workspace>
  updateEditorState(input: UpdateWorkspaceEditorStateInput): Promise<Workspace>
  updateOxeState(input: UpdateWorkspaceOxeStateInput): Promise<Workspace>
  updateAgentsState(input: UpdateWorkspaceAgentsStateInput): Promise<Workspace>
  updateReviewState(input: UpdateWorkspaceReviewStateInput): Promise<Workspace>
  updateSettings(input: UpdateWorkspaceSettingsInput): Promise<Workspace>
  pickFolder(): Promise<string | null>
  shellProfiles(): Promise<ShellProfile[]>
}

export interface TerminalApi {
  start(input: TerminalStartInput): Promise<void>
  write(input: TerminalWriteInput): Promise<void>
  resize(input: TerminalResizeInput): Promise<void>
  stop(input: TerminalStopInput): Promise<void>
  restart(input: TerminalStopInput): Promise<void>
  onData(listener: (event: TerminalDataEvent) => void): () => void
  onExit(listener: (event: TerminalExitEvent) => void): () => void
}

export interface AgentApi {
  list(): Promise<AgentProfile[]>
  create(input: CreateAgentProfileInput): Promise<AgentProfile>
  update(id: string, input: UpdateAgentProfileInput): Promise<AgentProfile>
  delete(id: string): Promise<void>
  discover(forceRefresh?: boolean): Promise<AgentReadiness[]>
  getReadiness(): Promise<AgentReadiness[]>
}

export interface AgentWorkflowApi {
  listRuns(workspaceId: string): Promise<AgentWorkflowRun[]>
  createRun(input: CreateAgentWorkflowRunInput): Promise<AgentWorkflowRunDetails>
  getRun(runId: string): Promise<AgentWorkflowRunDetails>
  updateRoleBindings(input: UpdateWorkspaceAgentRoleBindingsInput): Promise<WorkspaceAgentRoleBinding[]>
  getRoleBindings(workspaceId: string): Promise<WorkspaceAgentRoleBinding[]>
  prepareStep(input: PrepareAgentWorkflowStepInput): Promise<AgentWorkflowRunDetails>
  runStep(input: RunAgentWorkflowStepInput): Promise<AgentWorkflowRunDetails>
  completeManualStep(input: CompleteManualAgentWorkflowStepInput): Promise<AgentWorkflowRunDetails>
  appendArtifact(input: AppendAgentWorkflowArtifactInput): Promise<AgentWorkflowRunDetails>
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
}

export interface GitApi {
  getDiff(input: import('./git').GitDiffInput): Promise<import('./git').GitDiff>
  onDiffUpdate(listener: (diff: import('./git').GitDiff) => void): () => void
}

export interface OxeApi {
  app: {
    version: string
  }
  workspace: WorkspaceApi
  terminal: TerminalApi
  agent: AgentApi
  agentWorkflow: AgentWorkflowApi
  tasks: TaskApi
  fs: FileSystemApi
  oxe: OxeWorkspaceApi
  git: GitApi
}
