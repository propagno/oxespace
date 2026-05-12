import type {
  SplitPaneInput,
  UpdateWorkspaceEditorStateInput,
  UpdateWorkspaceAgentsStateInput,
  UpdateWorkspaceOxeStateInput,
  UpdateWorkspaceReviewStateInput,
  OxeWorkspaceInput,
  UpdateWorkspaceSettingsInput,
  UpdatePaneTypeInput,
  UpdatePaneNameInput,
  TerminalResizeInput,
  TerminalStartInput,
  TerminalStopInput,
  TerminalWriteInput
} from '../../../shared/types/ipc'
import type { GitDiffInput } from '../../../shared/types/git'
import type {
  AgentRole,
  AppendAgentWorkflowArtifactInput,
  CompleteManualAgentWorkflowStepInput,
  CreateAgentWorkflowRunInput,
  PrepareAgentWorkflowStepInput,
  RunAgentWorkflowStepInput,
  UpdateWorkspaceAgentRoleBindingsInput,
  WorkflowArtifactKind,
  WorkflowSourceType,
  WorkflowStepStatus
} from '../../../shared/types/agent-workflow'
import type {
  CreateTaskInput,
  ReorderTasksInput,
  RunTaskInput,
  TaskColumn,
  TaskRunStatus,
  UpdateTaskInput,
  VerifyTaskInput
} from '../../../shared/types/task'
import type { CreateWorkspaceInput, PaneType, WorkspaceDensity, WorkspaceLayout, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'

const LAYOUTS = new Set<WorkspaceLayout>(['1x1', '1x2', '2x1', '2x2', '2x3', '2x4', '2x5', '2x7', '3x4', '4x4'])
const LAYOUT_PRESETS = new Set<WorkspaceLayoutPreset>([1, 2, 4, 6, 8, 10, 12, 14, 16])
const THEMES = new Set<WorkspaceThemeId>(['midnight', 'nord', 'dracula', 'ocean', 'monokai', 'amber'])
const DENSITIES = new Set<WorkspaceDensity>(['compact', 'comfortable'])
const TASK_COLUMNS = new Set<TaskColumn>(['backlog', 'ready', 'running', 'review', 'done'])
const TASK_STATUSES = new Set<TaskRunStatus>(['idle', 'running', 'verifying', 'passed', 'failed'])
const PANE_TYPES = new Set<PaneType>(['terminal', 'tasks', 'editor', 'swarm', 'inspector', 'graph', 'review'])
const AGENT_ROLES = new Set<AgentRole>(['rubber_duck', 'planner', 'executor', 'reviewer', 'verifier', 'publisher'])
const WORKFLOW_SOURCE_TYPES = new Set<WorkflowSourceType>(['manual', 'task', 'oxe'])
const WORKFLOW_ARTIFACT_KINDS = new Set<WorkflowArtifactKind>(['question_set', 'clarification', 'plan', 'execution_notes', 'review', 'verification', 'publish_notes'])
const MANUAL_STEP_STATUSES = new Set<Extract<WorkflowStepStatus, 'passed' | 'failed' | 'blocked'>>(['passed', 'failed', 'blocked'])

export function parseWorkspaceCreateInput(value: unknown): CreateWorkspaceInput {
  const input = expectRecord(value, 'workspace:create input')
  const rootPath = expectNonEmptyString(input.rootPath, 'rootPath')
  const layout = input.layout === undefined ? undefined : expectLayout(input.layout)
  const layoutPreset = input.layoutPreset === undefined ? undefined : expectLayoutPreset(input.layoutPreset)
  const defaultShellProfileId =
    input.defaultShellProfileId === undefined ? undefined : expectNonEmptyString(input.defaultShellProfileId, 'defaultShellProfileId')
  const name = input.name === undefined ? undefined : expectNonEmptyString(input.name, 'name')

  const agentBindings = Array.isArray(input.agentBindings)
    ? (input.agentBindings as unknown[]).flatMap((b) => {
        if (typeof b !== 'object' || b === null) return []
        const binding = b as Record<string, unknown>
        if (typeof binding.paneIndex !== 'number') return []
        if (typeof binding.agentProfileId !== 'string' || !binding.agentProfileId) return []
        if (typeof binding.agentName !== 'string' || !binding.agentName) return []
        return [{ paneIndex: binding.paneIndex, agentProfileId: binding.agentProfileId, agentName: binding.agentName }]
      })
    : undefined

  return {
    rootPath,
    layout,
    layoutPreset,
    defaultShellProfileId,
    name,
    themeId: input.themeId === undefined ? undefined : expectTheme(input.themeId),
    uiDensity: input.uiDensity === undefined ? undefined : expectDensity(input.uiDensity),
    autoStart: input.autoStart === true,
    agentBindings
  }
}

export function parseId(value: unknown, label = 'id'): string {
  return expectNonEmptyString(value, label)
}

export function parseTerminalStartInput(value: unknown): TerminalStartInput {
  const input = expectRecord(value, 'terminal:start input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    agentCommand: input.agentCommand === undefined ? undefined : expectNonEmptyString(input.agentCommand, 'agentCommand')
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

export function parseUpdatePaneNameInput(value: unknown): UpdatePaneNameInput {
  const input = expectRecord(value, 'workspace:update-pane-name input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    displayName: input.displayName === null || input.displayName === undefined
      ? null
      : expectNonEmptyString(input.displayName, 'displayName')
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

export function parseUpdateWorkspaceOxeStateInput(value: unknown): UpdateWorkspaceOxeStateInput {
  const input = expectRecord(value, 'workspace:update-oxe-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    oxePanelVisible: input.oxePanelVisible === undefined ? undefined : expectBoolean(input.oxePanelVisible, 'oxePanelVisible'),
    oxePanelExpanded: input.oxePanelExpanded === undefined ? undefined : expectBoolean(input.oxePanelExpanded, 'oxePanelExpanded'),
    oxePanelWidthPercent: input.oxePanelWidthPercent === undefined ? undefined : expectEditorWidth(input.oxePanelWidthPercent)
  }
}

export function parseUpdateWorkspaceAgentsStateInput(value: unknown): UpdateWorkspaceAgentsStateInput {
  const input = expectRecord(value, 'workspace:update-agents-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    agentsPanelVisible: input.agentsPanelVisible === undefined ? undefined : expectBoolean(input.agentsPanelVisible, 'agentsPanelVisible'),
    agentsPanelExpanded: input.agentsPanelExpanded === undefined ? undefined : expectBoolean(input.agentsPanelExpanded, 'agentsPanelExpanded'),
    agentsPanelWidthPercent: input.agentsPanelWidthPercent === undefined ? undefined : expectEditorWidth(input.agentsPanelWidthPercent)
  }
}

export function parseUpdateWorkspaceReviewStateInput(value: unknown): UpdateWorkspaceReviewStateInput {
  const input = expectRecord(value, 'workspace:update-review-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    reviewPanelVisible: input.reviewPanelVisible === undefined ? undefined : expectBoolean(input.reviewPanelVisible, 'reviewPanelVisible'),
    reviewPanelExpanded: input.reviewPanelExpanded === undefined ? undefined : expectBoolean(input.reviewPanelExpanded, 'reviewPanelExpanded'),
    reviewPanelWidthPercent: input.reviewPanelWidthPercent === undefined ? undefined : expectEditorWidth(input.reviewPanelWidthPercent)
  }
}

export function parseUpdateWorkspaceSettingsInput(value: unknown): UpdateWorkspaceSettingsInput {
  const input = expectRecord(value, 'workspace:update-settings input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    themeId: input.themeId === undefined ? undefined : expectTheme(input.themeId),
    uiDensity: input.uiDensity === undefined ? undefined : expectDensity(input.uiDensity),
    defaultShellProfileId: input.defaultShellProfileId === undefined ? undefined : expectNonEmptyString(input.defaultShellProfileId, 'defaultShellProfileId'),
    layoutPreset: input.layoutPreset === undefined ? undefined : expectLayoutPreset(input.layoutPreset),
    applyShellToIdlePanes: input.applyShellToIdlePanes === undefined ? undefined : expectBoolean(input.applyShellToIdlePanes, 'applyShellToIdlePanes')
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

export function parseOxeWorkspaceInput(value: unknown): OxeWorkspaceInput {
  const input = expectRecord(value, 'oxe workspace input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath')
  }
}

export function parseCreateAgentWorkflowRunInput(value: unknown): CreateAgentWorkflowRunInput {
  const input = expectRecord(value, 'agent-workflow:create-run input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    title: expectNonEmptyString(input.title, 'title'),
    sourceType: input.sourceType === undefined ? undefined : expectWorkflowSourceType(input.sourceType),
    sourceId: input.sourceId === undefined || input.sourceId === null ? null : expectNonEmptyString(input.sourceId, 'sourceId'),
    initialPrompt: input.initialPrompt === undefined ? undefined : expectString(input.initialPrompt, 'initialPrompt')
  }
}

export function parseUpdateWorkspaceAgentRoleBindingsInput(value: unknown): UpdateWorkspaceAgentRoleBindingsInput {
  const input = expectRecord(value, 'agent-workflow:update-role-bindings input')
  if (!Array.isArray(input.bindings)) throw new Error('bindings must be an array')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    bindings: input.bindings.map((item, index) => {
      const binding = expectRecord(item, `bindings[${index}]`)
      return {
        role: expectAgentRole(binding.role),
        agentProfileId: binding.agentProfileId === undefined || binding.agentProfileId === null ? null : expectNonEmptyString(binding.agentProfileId, 'agentProfileId'),
        shellProfileId: binding.shellProfileId === undefined || binding.shellProfileId === null ? null : expectNonEmptyString(binding.shellProfileId, 'shellProfileId'),
        model: binding.model === undefined || binding.model === null ? null : expectString(binding.model, 'model'),
        enabled: binding.enabled === undefined ? undefined : expectBoolean(binding.enabled, 'enabled')
      }
    })
  }
}

export function parsePrepareAgentWorkflowStepInput(value: unknown): PrepareAgentWorkflowStepInput {
  const input = expectRecord(value, 'agent-workflow:prepare-step input')
  return {
    runId: expectNonEmptyString(input.runId, 'runId'),
    role: expectAgentRole(input.role)
  }
}

export function parseRunAgentWorkflowStepInput(value: unknown): RunAgentWorkflowStepInput {
  const input = expectRecord(value, 'agent-workflow:run-step input')
  return {
    stepId: expectNonEmptyString(input.stepId, 'stepId'),
    paneId: expectNonEmptyString(input.paneId, 'paneId')
  }
}

export function parseCompleteManualAgentWorkflowStepInput(value: unknown): CompleteManualAgentWorkflowStepInput {
  const input = expectRecord(value, 'agent-workflow:complete-manual-step input')
  return {
    stepId: expectNonEmptyString(input.stepId, 'stepId'),
    output: expectString(input.output, 'output'),
    status: input.status === undefined ? undefined : expectManualStepStatus(input.status)
  }
}

export function parseAppendAgentWorkflowArtifactInput(value: unknown): AppendAgentWorkflowArtifactInput {
  const input = expectRecord(value, 'agent-workflow:append-artifact input')
  return {
    runId: expectNonEmptyString(input.runId, 'runId'),
    stepId: input.stepId === undefined || input.stepId === null ? null : expectNonEmptyString(input.stepId, 'stepId'),
    kind: expectWorkflowArtifactKind(input.kind),
    title: expectNonEmptyString(input.title, 'title'),
    content: expectString(input.content, 'content')
  }
}

export function parseGitDiffInput(value: unknown): GitDiffInput {
  const input = expectRecord(value, 'git:get-diff input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    base: expectNonEmptyString(input.base, 'base'),
    includeUncommitted: typeof input.includeUncommitted === 'boolean' ? input.includeUncommitted : true
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
    throw new Error('layout must be a supported workspace grid')
  }
  return value as WorkspaceLayout
}

function expectLayoutPreset(value: unknown): WorkspaceLayoutPreset {
  if (!Number.isInteger(value) || !LAYOUT_PRESETS.has(Number(value) as WorkspaceLayoutPreset)) {
    throw new Error('layoutPreset must be one of 1, 2, 4, 6, 8, 10, 12, 14, 16')
  }
  return Number(value) as WorkspaceLayoutPreset
}

function expectTheme(value: unknown): WorkspaceThemeId {
  if (typeof value !== 'string' || !THEMES.has(value as WorkspaceThemeId)) {
    throw new Error('themeId must be one of midnight, nord, dracula, ocean, monokai, amber')
  }
  return value as WorkspaceThemeId
}

function expectDensity(value: unknown): WorkspaceDensity {
  if (typeof value !== 'string' || !DENSITIES.has(value as WorkspaceDensity)) {
    throw new Error('uiDensity must be compact or comfortable')
  }
  return value as WorkspaceDensity
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

function expectAgentRole(value: unknown): AgentRole {
  if (typeof value !== 'string' || !AGENT_ROLES.has(value as AgentRole)) {
    throw new Error('role must be one of rubber_duck, planner, executor, reviewer, verifier, publisher')
  }
  return value as AgentRole
}

function expectWorkflowSourceType(value: unknown): WorkflowSourceType {
  if (typeof value !== 'string' || !WORKFLOW_SOURCE_TYPES.has(value as WorkflowSourceType)) {
    throw new Error('sourceType must be one of manual, task, oxe')
  }
  return value as WorkflowSourceType
}

function expectWorkflowArtifactKind(value: unknown): WorkflowArtifactKind {
  if (typeof value !== 'string' || !WORKFLOW_ARTIFACT_KINDS.has(value as WorkflowArtifactKind)) {
    throw new Error('kind must be a supported workflow artifact kind')
  }
  return value as WorkflowArtifactKind
}

function expectManualStepStatus(value: unknown): Extract<WorkflowStepStatus, 'passed' | 'failed' | 'blocked'> {
  if (typeof value !== 'string' || !MANUAL_STEP_STATUSES.has(value as Extract<WorkflowStepStatus, 'passed' | 'failed' | 'blocked'>)) {
    throw new Error('status must be passed, failed or blocked')
  }
  return value as Extract<WorkflowStepStatus, 'passed' | 'failed' | 'blocked'>
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
