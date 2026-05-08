import type {
  SplitPaneInput,
  UpdateWorkspaceEditorStateInput,
  UpdatePaneTypeInput,
  TerminalResizeInput,
  TerminalStartInput,
  TerminalStopInput,
  TerminalWriteInput
} from '../../../shared/types/ipc'
import type {
  CreateTaskInput,
  ReorderTasksInput,
  RunTaskInput,
  TaskColumn,
  TaskRunStatus,
  UpdateTaskInput,
  VerifyTaskInput
} from '../../../shared/types/task'
import type { CreateWorkspaceInput, PaneType, WorkspaceLayout } from '../../../shared/types/workspace'

const LAYOUTS = new Set<WorkspaceLayout>(['1x1', '1x2', '2x1', '2x2', '3x4', '4x4'])
const TASK_COLUMNS = new Set<TaskColumn>(['backlog', 'ready', 'running', 'review', 'done'])
const TASK_STATUSES = new Set<TaskRunStatus>(['idle', 'running', 'verifying', 'passed', 'failed'])
const PANE_TYPES = new Set<PaneType>(['terminal', 'tasks', 'editor', 'swarm', 'inspector'])

export function parseWorkspaceCreateInput(value: unknown): CreateWorkspaceInput {
  const input = expectRecord(value, 'workspace:create input')
  const rootPath = expectNonEmptyString(input.rootPath, 'rootPath')
  const layout = expectLayout(input.layout)
  const defaultShellProfileId =
    input.defaultShellProfileId === undefined ? undefined : expectNonEmptyString(input.defaultShellProfileId, 'defaultShellProfileId')
  const name = input.name === undefined ? undefined : expectNonEmptyString(input.name, 'name')

  return {
    rootPath,
    layout,
    defaultShellProfileId,
    name,
    autoStart: input.autoStart === true
  }
}

export function parseId(value: unknown, label = 'id'): string {
  return expectNonEmptyString(value, label)
}

export function parseTerminalStartInput(value: unknown): TerminalStartInput {
  const input = expectRecord(value, 'terminal:start input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId')
  }
}

export function parseTerminalWriteInput(value: unknown): TerminalWriteInput {
  const input = expectRecord(value, 'terminal:write input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    data: expectString(input.data, 'data')
  }
}

export function parseTerminalResizeInput(value: unknown): TerminalResizeInput {
  const input = expectRecord(value, 'terminal:resize input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    cols: expectPositiveInteger(input.cols, 'cols'),
    rows: expectPositiveInteger(input.rows, 'rows')
  }
}

export function parseTerminalStopInput(value: unknown): TerminalStopInput {
  const input = expectRecord(value, 'terminal stop input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId')
  }
}

export function parseSplitPaneInput(value: unknown): SplitPaneInput {
  const input = expectRecord(value, 'workspace:split-pane input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    direction: expectDirection(input.direction)
  }
}

export function parseUpdatePaneTypeInput(value: unknown): UpdatePaneTypeInput {
  const input = expectRecord(value, 'workspace:update-pane-type input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    type: expectPaneType(input.type)
  }
}

export function parseUpdateWorkspaceEditorStateInput(value: unknown): UpdateWorkspaceEditorStateInput {
  const input = expectRecord(value, 'workspace:update-editor-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    editorVisible: input.editorVisible === undefined ? undefined : expectBoolean(input.editorVisible, 'editorVisible'),
    editorExpanded: input.editorExpanded === undefined ? undefined : expectBoolean(input.editorExpanded, 'editorExpanded'),
    editorWidthPercent: input.editorWidthPercent === undefined ? undefined : expectEditorWidth(input.editorWidthPercent)
  }
}

export function parseTaskCreateInput(value: unknown): CreateTaskInput {
  const input = expectRecord(value, 'tasks:create input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    title: expectNonEmptyString(input.title, 'title'),
    description: input.description === undefined ? undefined : expectString(input.description, 'description'),
    context: input.context === undefined ? undefined : expectString(input.context, 'context'),
    verifyCommand: input.verifyCommand === undefined ? undefined : expectString(input.verifyCommand, 'verifyCommand'),
    allowedFiles: input.allowedFiles === undefined ? undefined : expectStringArray(input.allowedFiles, 'allowedFiles'),
    column: input.column === undefined ? undefined : expectTaskColumn(input.column)
  }
}

export function parseTaskUpdateInput(value: unknown): UpdateTaskInput {
  const input = expectRecord(value, 'tasks:update input')
  return {
    title: input.title === undefined ? undefined : expectNonEmptyString(input.title, 'title'),
    description: input.description === undefined ? undefined : expectString(input.description, 'description'),
    context: input.context === undefined ? undefined : expectString(input.context, 'context'),
    verifyCommand: input.verifyCommand === undefined ? undefined : expectString(input.verifyCommand, 'verifyCommand'),
    allowedFiles: input.allowedFiles === undefined ? undefined : expectStringArray(input.allowedFiles, 'allowedFiles'),
    column: input.column === undefined ? undefined : expectTaskColumn(input.column),
    runStatus: input.runStatus === undefined ? undefined : expectTaskStatus(input.runStatus)
  }
}

export function parseTaskReorderInput(value: unknown): ReorderTasksInput {
  const input = expectRecord(value, 'tasks:reorder input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    column: expectTaskColumn(input.column),
    orderedIds: expectStringArray(input.orderedIds, 'orderedIds')
  }
}

export function parseTaskRunInput(value: unknown): RunTaskInput {
  const input = expectRecord(value, 'tasks:run input')
  return {
    taskId: expectNonEmptyString(input.taskId, 'taskId'),
    agentProfileId: input.agentProfileId === undefined ? undefined : expectNonEmptyString(input.agentProfileId, 'agentProfileId')
  }
}

export function parseTaskVerifyInput(value: unknown): VerifyTaskInput {
  const input = expectRecord(value, 'tasks:verify input')
  return {
    taskId: expectNonEmptyString(input.taskId, 'taskId')
  }
}

export function parseFileSystemListTreeInput(value: unknown) {
  const input = expectRecord(value, 'fs:list-tree input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    relativePath: input.relativePath === undefined ? undefined : expectString(input.relativePath, 'relativePath')
  }
}

export function parseFileSystemReadFileInput(value: unknown) {
  const input = expectRecord(value, 'fs:read-file input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    relativePath: expectString(input.relativePath, 'relativePath')
  }
}

export function parseFileSystemWriteFileInput(value: unknown) {
  const input = expectRecord(value, 'fs:write-file input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    relativePath: expectString(input.relativePath, 'relativePath'),
    content: expectString(input.content, 'content')
  }
}

export function parseFileSystemWatchFileInput(value: unknown) {
  const input = expectRecord(value, 'fs:watch-file input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    relativePath: expectString(input.relativePath, 'relativePath')
  }
}

export function parseFileSystemUnwatchFileInput(value: unknown) {
  const input = expectRecord(value, 'fs:unwatch-file input')
  return {
    watchId: expectNonEmptyString(input.watchId, 'watchId')
  }
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function expectDirection(value: unknown): 'vertical' | 'horizontal' {
  if (value !== 'vertical' && value !== 'horizontal') {
    throw new Error('direction must be "vertical" or "horizontal"')
  }
  return value
}

function expectLayout(value: unknown): WorkspaceLayout {
  if (typeof value !== 'string' || !LAYOUTS.has(value as WorkspaceLayout)) {
    throw new Error('layout must be one of 1x1, 1x2, 2x2, 3x4, 4x4')
  }
  return value as WorkspaceLayout
}

function expectTaskColumn(value: unknown): TaskColumn {
  if (typeof value !== 'string' || !TASK_COLUMNS.has(value as TaskColumn)) {
    throw new Error('column must be one of backlog, ready, running, review, done')
  }
  return value as TaskColumn
}

function expectTaskStatus(value: unknown): TaskRunStatus {
  if (typeof value !== 'string' || !TASK_STATUSES.has(value as TaskRunStatus)) {
    throw new Error('runStatus must be one of idle, running, verifying, passed, failed')
  }
  return value as TaskRunStatus
}

function expectPaneType(value: unknown): PaneType {
  if (typeof value !== 'string' || !PANE_TYPES.has(value as PaneType)) {
    throw new Error('type must be one of terminal, tasks, editor, swarm, inspector')
  }
  return value as PaneType
}

function expectNonEmptyString(value: unknown, label: string): string {
  const text = expectString(value, label).trim()
  if (text.length === 0) {
    throw new Error(`${label} must not be empty`)
  }
  return text
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`)
  }
  return value
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`)
  }
  return value
}

function expectEditorWidth(value: unknown): number {
  if (!Number.isFinite(value) || Number(value) < 25 || Number(value) > 70) {
    throw new Error('editorWidthPercent must be between 25 and 70')
  }
  return Number(value)
}

function expectPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}
