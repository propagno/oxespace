import type {
  SplitPaneInput,
  UpdateWorkspaceBackgroundStateInput,
  UpdateWorkspaceEditorStateInput,
  UpdateWorkspaceGitHubStateInput,
  UpdateWorkspaceReviewStateInput,
  UpdateWorkspaceSettingsInput,
  UpdateWorkspaceWorktreeStateInput,
  UpdatePaneTypeInput,
  UpdatePaneNameInput,
  TerminalResizeInput,
  TerminalStartInput,
  TerminalStopInput,
  TerminalWriteInput
} from '../../../shared/types/ipc'
import type { GitDiffInput } from '../../../shared/types/git'
import type {
  GitHubCheckoutBranchInput,
  GitHubCommitDetailsInput,
  GitHubCommitInput,
  GitHubConnectRepositoryInput,
  GitHubCreateBranchInput,
  GitHubCreateCheckpointInput,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubDeleteCheckpointInput,
  GitHubPanelTab,
  GitHubPullRequestListInput,
  GitHubRestoreCheckpointInput,
  GitHubWorkflowRunInput,
  GitHubWorkspaceInput
} from '../../../shared/types/github'
import {
  ALL_PROVIDERS,
  type AgentProvider,
  type CreateAgentProfileInput,
  type UpdateAgentProfileInput
} from '../../../shared/types/agent'
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
const THEMES = new Set<WorkspaceThemeId>(['midnight', 'nord', 'dracula', 'ocean', 'monokai', 'amber', 'rose-pine', 'gruvbox', 'one-dark', 'synthwave84', 'github-dark'])
const DENSITIES = new Set<WorkspaceDensity>(['compact', 'comfortable'])
const TASK_COLUMNS = new Set<TaskColumn>(['backlog', 'ready', 'running', 'review', 'done'])
const TASK_STATUSES = new Set<TaskRunStatus>(['idle', 'running', 'verifying', 'passed', 'failed'])
const PANE_TYPES = new Set<PaneType>(['terminal', 'tasks', 'editor', 'review'])
const GITHUB_TABS = new Set<GitHubPanelTab>(['status', 'checkpoints', 'repos', 'branches', 'prs', 'commits', 'releases', 'actions', 'settings'])
const PR_STATES = new Set<GitHubPullRequestListInput['state']>(['open', 'closed', 'all'])
const AGENT_PROVIDERS = new Set<AgentProvider>(ALL_PROVIDERS)

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
    agentCommand: input.agentCommand === undefined ? undefined : expectNonEmptyString(input.agentCommand, 'agentCommand'),
    agentArgs: Array.isArray(input.agentArgs) ? (input.agentArgs as unknown[]).filter((a): a is string => typeof a === 'string') : undefined,
    initialPrompt: input.initialPrompt === undefined ? undefined : expectNonEmptyString(input.initialPrompt, 'initialPrompt'),
    disableRtk: input.disableRtk === undefined ? undefined : typeof input.disableRtk === 'boolean' ? input.disableRtk : false
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

export function parseSetPaneAgentInput(value: unknown): { paneId: string; agentProfileId: string | null; preserveSession: boolean } {
  const input = expectRecord(value, 'workspace:set-pane-agent input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    agentProfileId: input.agentProfileId === null || input.agentProfileId === undefined
      ? null
      : expectNonEmptyString(input.agentProfileId, 'agentProfileId'),
    preserveSession: input.preserveSession === undefined ? false : expectBoolean(input.preserveSession, 'preserveSession')
  }
}

export function parseSetPaneRootPathInput(value: unknown): { paneId: string; rootPath: string | null } {
  const input = expectRecord(value, 'workspace:set-pane-root-path input')
  return {
    paneId: expectNonEmptyString(input.paneId, 'paneId'),
    rootPath: input.rootPath === null || input.rootPath === undefined
      ? null
      : expectNonEmptyString(input.rootPath, 'rootPath')
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


export function parseUpdateWorkspaceReviewStateInput(value: unknown): UpdateWorkspaceReviewStateInput {
  const input = expectRecord(value, 'workspace:update-review-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    reviewPanelVisible: input.reviewPanelVisible === undefined ? undefined : expectBoolean(input.reviewPanelVisible, 'reviewPanelVisible'),
    reviewPanelExpanded: input.reviewPanelExpanded === undefined ? undefined : expectBoolean(input.reviewPanelExpanded, 'reviewPanelExpanded'),
    reviewPanelWidthPercent: input.reviewPanelWidthPercent === undefined ? undefined : expectPanelWidth(input.reviewPanelWidthPercent)
  }
}

export function parseUpdateWorkspaceGitHubStateInput(value: unknown): UpdateWorkspaceGitHubStateInput {
  const input = expectRecord(value, 'workspace:update-github-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    githubPanelVisible: input.githubPanelVisible === undefined ? undefined : expectBoolean(input.githubPanelVisible, 'githubPanelVisible'),
    githubPanelExpanded: input.githubPanelExpanded === undefined ? undefined : expectBoolean(input.githubPanelExpanded, 'githubPanelExpanded'),
    githubPanelWidthPercent: input.githubPanelWidthPercent === undefined ? undefined : expectPanelWidth(input.githubPanelWidthPercent),
    githubActiveTab: input.githubActiveTab === undefined ? undefined : expectGitHubTab(input.githubActiveTab)
  }
}

export function parseUpdateWorkspaceBackgroundStateInput(value: unknown): UpdateWorkspaceBackgroundStateInput {
  const input = expectRecord(value, 'workspace:update-background-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    backgroundPanelVisible: input.backgroundPanelVisible === undefined ? undefined : expectBoolean(input.backgroundPanelVisible, 'backgroundPanelVisible'),
    backgroundPanelExpanded: input.backgroundPanelExpanded === undefined ? undefined : expectBoolean(input.backgroundPanelExpanded, 'backgroundPanelExpanded'),
    backgroundPanelWidthPercent: input.backgroundPanelWidthPercent === undefined ? undefined : expectPanelWidth(input.backgroundPanelWidthPercent)
  }
}

export function parseUpdateWorkspaceWorktreeStateInput(value: unknown): UpdateWorkspaceWorktreeStateInput {
  const input = expectRecord(value, 'workspace:update-worktree-state input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    worktreePanelVisible: input.worktreePanelVisible === undefined ? undefined : expectBoolean(input.worktreePanelVisible, 'worktreePanelVisible'),
    worktreePanelExpanded: input.worktreePanelExpanded === undefined ? undefined : expectBoolean(input.worktreePanelExpanded, 'worktreePanelExpanded'),
    worktreePanelWidthPercent: input.worktreePanelWidthPercent === undefined ? undefined : expectPanelWidth(input.worktreePanelWidthPercent)
  }
}

export function parseUpdateWorkspaceSettingsInput(value: unknown): UpdateWorkspaceSettingsInput {
  const input = expectRecord(value, 'workspace:update-settings input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    name: input.name === undefined ? undefined : expectNonEmptyString(input.name, 'name'),
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

export function parseCreateAgentProfileInput(value: unknown): CreateAgentProfileInput {
  const input = expectRecord(value, 'agent:create input')
  return {
    name: expectNonEmptyString(input.name, 'name'),
    provider: expectAgentProvider(input.provider),
    command: expectString(input.command, 'command'),
    commandTemplate: expectString(input.commandTemplate, 'commandTemplate'),
    model: input.model === undefined ? undefined : expectString(input.model, 'model'),
    role: input.role === undefined ? undefined : expectString(input.role, 'role'),
    systemPrompt: input.systemPrompt === undefined ? undefined : expectString(input.systemPrompt, 'systemPrompt'),
    parentProvider: input.parentProvider === undefined ? undefined : expectAgentProvider(input.parentProvider)
  }
}

export function parseUpdateAgentProfileInput(value: unknown): UpdateAgentProfileInput {
  const input = expectRecord(value, 'agent:update input')
  return {
    name: input.name === undefined ? undefined : expectNonEmptyString(input.name, 'name'),
    command: input.command === undefined ? undefined : expectString(input.command, 'command'),
    commandTemplate: input.commandTemplate === undefined ? undefined : expectString(input.commandTemplate, 'commandTemplate'),
    model: input.model === undefined ? undefined : input.model === null ? undefined : expectString(input.model, 'model'),
    role: input.role === undefined ? undefined : input.role === null ? undefined : expectString(input.role, 'role'),
    systemPrompt: input.systemPrompt === undefined ? undefined : input.systemPrompt === null ? undefined : expectString(input.systemPrompt, 'systemPrompt'),
    parentProvider: input.parentProvider === undefined ? undefined : input.parentProvider === null ? undefined : expectAgentProvider(input.parentProvider)
  }
}

export function parseGitDiffInput(value: unknown): GitDiffInput {
  const input = expectRecord(value, 'git:get-diff input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    base: expectGitRef(input.base, 'base'),
    includeUncommitted: typeof input.includeUncommitted === 'boolean' ? input.includeUncommitted : true
  }
}

export function parseGitBranchInput(value: unknown): { workspaceId: string; rootPath: string } {
  const input = expectRecord(value, 'git:get-branch input')
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath')
  }
}

// Subset of git's check-ref-format rules — accepts the characters legal in branch
// names, tags, SHAs, and short refspecs we actually surface (HEAD~3, origin/main, v1.2.3).
// Rejects shell metacharacters that would be dangerous if a future caller forgets
// `shell:false`.
const GIT_REF_PATTERN = /^[A-Za-z0-9_./@~^{}-]+$/

function expectGitRef(value: unknown, label: string): string {
  const text = expectNonEmptyString(value, label)
  if (!GIT_REF_PATTERN.test(text) || text.includes('..') || text.startsWith('-')) {
    throw new Error(`${label} must be a valid git ref (alphanumerics, ._/@~^{}-)`)
  }
  return text
}

export function parseGitHubWorkspaceInput(value: unknown): GitHubWorkspaceInput {
  const input = expectRecord(value, 'github workspace input')
  return expectGitHubWorkspace(input)
}

export function parseGitHubCommitInput(value: unknown): GitHubCommitInput {
  const input = expectRecord(value, 'github commit input')
  return {
    ...expectGitHubWorkspace(input),
    message: expectNonEmptyString(input.message, 'message')
  }
}

export function parseGitHubCommitDetailsInput(value: unknown): GitHubCommitDetailsInput {
  const input = expectRecord(value, 'github commit details input')
  return {
    ...expectGitHubWorkspace(input),
    oid: expectNonEmptyString(input.oid, 'oid')
  }
}

export function parseGitHubCreateBranchInput(value: unknown): GitHubCreateBranchInput {
  const input = expectRecord(value, 'github create branch input')
  return {
    ...expectGitHubWorkspace(input),
    name: expectNonEmptyString(input.name, 'name'),
    checkout: input.checkout === undefined ? undefined : expectBoolean(input.checkout, 'checkout')
  }
}

export function parseGitHubCheckoutBranchInput(value: unknown): GitHubCheckoutBranchInput {
  const input = expectRecord(value, 'github checkout branch input')
  return {
    ...expectGitHubWorkspace(input),
    name: expectNonEmptyString(input.name, 'name'),
    force: input.force === undefined ? undefined : expectBoolean(input.force, 'force')
  }
}

export function parseGitHubPullRequestListInput(value: unknown): GitHubPullRequestListInput {
  const input = expectRecord(value, 'github list pull requests input')
  const state = input.state === undefined ? 'open' : expectPullRequestState(input.state)
  return {
    ...expectGitHubWorkspace(input),
    state
  }
}

export function parseGitHubCreatePullRequestInput(value: unknown): GitHubCreatePullRequestInput {
  const input = expectRecord(value, 'github create pull request input')
  return {
    ...expectGitHubWorkspace(input),
    title: expectNonEmptyString(input.title, 'title'),
    body: input.body === undefined ? '' : expectString(input.body, 'body'),
    base: input.base === undefined ? undefined : expectNonEmptyString(input.base, 'base'),
    head: input.head === undefined ? undefined : expectNonEmptyString(input.head, 'head'),
    draft: input.draft === undefined ? undefined : expectBoolean(input.draft, 'draft')
  }
}

export function parseGitHubCreateReleaseInput(value: unknown): GitHubCreateReleaseInput {
  const input = expectRecord(value, 'github create release input')
  return {
    ...expectGitHubWorkspace(input),
    tagName: expectNonEmptyString(input.tagName, 'tagName'),
    title: input.title === undefined ? undefined : expectNonEmptyString(input.title, 'title'),
    notes: input.notes === undefined ? undefined : expectString(input.notes, 'notes'),
    generateNotes: input.generateNotes === undefined ? undefined : expectBoolean(input.generateNotes, 'generateNotes'),
    prerelease: input.prerelease === undefined ? undefined : expectBoolean(input.prerelease, 'prerelease'),
    draft: input.draft === undefined ? undefined : expectBoolean(input.draft, 'draft')
  }
}

export function parseGitHubWorkflowRunInput(value: unknown): GitHubWorkflowRunInput {
  const input = expectRecord(value, 'github run workflow input')
  return {
    ...expectGitHubWorkspace(input),
    workflowId: expectNonEmptyString(input.workflowId, 'workflowId'),
    ref: input.ref === undefined ? undefined : expectNonEmptyString(input.ref, 'ref'),
    fields: input.fields === undefined ? undefined : expectStringRecord(input.fields, 'fields')
  }
}

export function parseGitHubCreateCheckpointInput(value: unknown): GitHubCreateCheckpointInput {
  const input = expectRecord(value, 'github create checkpoint input')
  return {
    ...expectGitHubWorkspace(input),
    name: expectNonEmptyString(input.name, 'name'),
    description: input.description === undefined ? undefined : expectString(input.description, 'description')
  }
}

export function parseGitHubRestoreCheckpointInput(value: unknown): GitHubRestoreCheckpointInput {
  const input = expectRecord(value, 'github restore checkpoint input')
  return {
    ...expectGitHubWorkspace(input),
    checkpointId: expectNonEmptyString(input.checkpointId, 'checkpointId')
  }
}

export function parseGitHubDeleteCheckpointInput(value: unknown): GitHubDeleteCheckpointInput {
  const input = expectRecord(value, 'github delete checkpoint input')
  return {
    checkpointId: expectNonEmptyString(input.checkpointId, 'checkpointId')
  }
}

export function parseGitHubConnectRepositoryInput(value: unknown): GitHubConnectRepositoryInput {
  const input = expectRecord(value, 'github connect repository input')
  return {
    ...expectGitHubWorkspace(input),
    fullName: expectNonEmptyString(input.fullName, 'fullName'),
    url: input.url === undefined || input.url === null ? null : expectNonEmptyString(input.url, 'url')
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
    throw new Error('type must be one of terminal, tasks, editor, review')
  }
  return value as PaneType
}

function expectGitHubTab(value: unknown): GitHubPanelTab {
  if (typeof value !== 'string' || !GITHUB_TABS.has(value as GitHubPanelTab)) {
    throw new Error('githubActiveTab must be a supported GitHub panel tab')
  }
  return value as GitHubPanelTab
}

function expectPullRequestState(value: unknown): GitHubPullRequestListInput['state'] {
  if (typeof value !== 'string' || !PR_STATES.has(value as GitHubPullRequestListInput['state'])) {
    throw new Error('state must be open, closed or all')
  }
  return value as GitHubPullRequestListInput['state']
}

function expectGitHubWorkspace(input: Record<string, unknown>): GitHubWorkspaceInput {
  return {
    workspaceId: expectNonEmptyString(input.workspaceId, 'workspaceId'),
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath')
  }
}

function expectStringRecord(value: unknown, label: string): Record<string, string> {
  const input = expectRecord(value, label)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(input)) {
    result[key] = expectString(item, `${label}.${key}`)
  }
  return result
}

function expectAgentProvider(value: unknown): AgentProvider {
  if (typeof value !== 'string' || !AGENT_PROVIDERS.has(value as AgentProvider)) {
    throw new Error('provider must be one of ' + ALL_PROVIDERS.join(', '))
  }
  return value as AgentProvider
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
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error('editorWidthPercent must be between 0 and 100')
  }
  return Number(value)
}

function expectPanelWidth(value: unknown): number {
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error('panel width must be between 0 and 100')
  }
  return Number(value)
}

function expectPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return Number(value)
}

export function parseGitHubCreateWorktreeInput(value: unknown): import('../../../shared/types/github').GitHubCreateWorktreeInput {
  const input = expectRecord(value, 'github:create-worktree input')
  return {
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    branch: expectNonEmptyString(input.branch, 'branch'),
    path: expectNonEmptyString(input.path, 'path'),
    createBranch: input.createBranch === true
  }
}

export function parseGitHubRemoveWorktreeInput(value: unknown): import('../../../shared/types/github').GitHubRemoveWorktreeInput {
  const input = expectRecord(value, 'github:remove-worktree input')
  return {
    rootPath: expectNonEmptyString(input.rootPath, 'rootPath'),
    path: expectNonEmptyString(input.path, 'path'),
    force: input.force === true
  }
}
