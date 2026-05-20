export type TaskColumn = 'backlog' | 'ready' | 'running' | 'review' | 'done'

export type TaskRunStatus = 'idle' | 'running' | 'verifying' | 'passed' | 'failed'

export type TaskExecutionType = 'run' | 'verify'

export interface Task {
  id: string
  workspaceId: string
  title: string
  description: string
  context: string
  verifyCommand: string
  allowedFiles: string[]
  column: TaskColumn
  runStatus: TaskRunStatus
  position: number
  createdAt: number
  updatedAt: number
  /** IDs of tasks this one depends on. A task is blocked until all listed deps reach 'passed'. */
  dependsOn: string[]
}

export interface AddTaskDependencyInput {
  taskId: string
  dependsOnTaskId: string
}

export interface RemoveTaskDependencyInput {
  taskId: string
  dependsOnTaskId: string
}

export interface RunPipelineInput {
  workspaceId: string
}

export interface PipelineRunResult {
  /** Tasks that were dispatched. Note: not all may finish — pipeline is fire-and-forget. */
  dispatchedTaskIds: string[]
  /** Tasks ready but no pane available — caller can show a warning. */
  pendingReadyIds: string[]
}

export interface TaskExecution {
  id: string
  taskId: string
  type: TaskExecutionType
  agentProfileId: string | null
  prompt: string
  output: string
  exitCode: number | null
  startedAt: number
  completedAt: number | null
}

export interface CreateTaskInput {
  workspaceId: string
  title: string
  description?: string
  context?: string
  verifyCommand?: string
  allowedFiles?: string[]
  column?: TaskColumn
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  context?: string
  verifyCommand?: string
  allowedFiles?: string[]
  column?: TaskColumn
  runStatus?: TaskRunStatus
}

export interface ReorderTasksInput {
  workspaceId: string
  column: TaskColumn
  orderedIds: string[]
}

export interface RunTaskInput {
  taskId: string
  agentProfileId?: string
}

export interface VerifyTaskInput {
  taskId: string
}

export interface TaskVerifyOutputEvent {
  taskId: string
  executionId: string
  chunk: string
  done: boolean
  exitCode?: number | null
}
