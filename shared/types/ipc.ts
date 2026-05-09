import type { CreateWorkspaceInput, PaneType, ShellProfile, UpdateWorkspaceEditorStateInput, UpdateWorkspaceSettingsInput, Workspace } from './workspace'
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

export type { ShellProfile, Workspace, UpdateWorkspaceEditorStateInput, UpdateWorkspaceSettingsInput, AgentProfile, AgentReadiness }
export type { Task, TaskExecution, TaskVerifyOutputEvent }

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
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    setActive: 'workspace:set-active',
    delete: 'workspace:delete',
    closePane: 'workspace:close-pane',
    splitPane: 'workspace:split-pane',
    updatePaneType: 'workspace:update-pane-type',
    updateEditorState: 'workspace:update-editor-state',
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
  }
} as const

export interface TerminalStartInput {
  paneId: string
  workspaceId: string
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

export interface WorkspaceApi {
  list(): Promise<Workspace[]>
  create(input: CreateWorkspaceInput): Promise<Workspace>
  setActive(id: string): Promise<Workspace>
  delete(id: string): Promise<void>
  closePane(id: string): Promise<void>
  splitPane(input: SplitPaneInput): Promise<Workspace>
  updatePaneType(input: UpdatePaneTypeInput): Promise<Workspace>
  updateEditorState(input: UpdateWorkspaceEditorStateInput): Promise<Workspace>
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

export interface OxeApi {
  app: {
    version: string
  }
  workspace: WorkspaceApi
  terminal: TerminalApi
  agent: AgentApi
  tasks: TaskApi
  fs: FileSystemApi
}
