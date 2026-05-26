export type WorkspaceLayout = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '2x4' | '2x5' | '2x7' | '3x4' | '4x4'

export type WorkspaceLayoutPreset = 1 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16

export type WorkspaceThemeId = 'midnight' | 'nord' | 'dracula' | 'ocean' | 'monokai' | 'amber'

export type WorkspaceDensity = 'compact' | 'comfortable'

export type PaneType = 'terminal' | 'tasks' | 'editor' | 'review'

export type GitHubPanelTab = import('./github').GitHubPanelTab

export type PaneStatus = 'idle' | 'running' | 'exited'

export interface ShellProfile {
  id: string
  name: string
  executable: string
  args: string[]
  isBuiltin: boolean
}

export interface WorkspacePane {
  id: string
  workspaceId: string
  type: PaneType
  rowIndex: number
  columnIndex: number
  shellProfileId: string | null
  status: PaneStatus
  agentProfileId: string | null
  agentName: string | null
  displayName: string | null
  createdAt: number | null
  /** Per-pane working directory override (e.g. git worktree). Null = use workspace rootPath. */
  rootPath: string | null
}

export interface PaneAgentBinding {
  paneIndex: number
  agentProfileId: string
  agentName: string
}

export interface Workspace {
  id: string
  name: string
  rootPath: string
  layout: WorkspaceLayout
  layoutPreset: WorkspaceLayoutPreset
  themeId: WorkspaceThemeId
  uiDensity: WorkspaceDensity
  defaultShellProfileId: string
  autoStart: boolean
  isActive: boolean
  editorVisible?: boolean
  editorExpanded?: boolean
  editorWidthPercent?: number
  reviewPanelVisible?: boolean
  reviewPanelExpanded?: boolean
  reviewPanelWidthPercent?: number
  githubPanelVisible?: boolean
  githubPanelExpanded?: boolean
  githubPanelWidthPercent?: number
  githubActiveTab?: GitHubPanelTab
  backgroundPanelVisible?: boolean
  backgroundPanelExpanded?: boolean
  backgroundPanelWidthPercent?: number
  worktreePanelVisible?: boolean
  worktreePanelExpanded?: boolean
  worktreePanelWidthPercent?: number
  panes: WorkspacePane[]
}

export interface CreateWorkspaceInput {
  rootPath: string
  layout?: WorkspaceLayout
  layoutPreset?: WorkspaceLayoutPreset
  defaultShellProfileId?: string
  autoStart?: boolean
  name?: string
  themeId?: WorkspaceThemeId
  uiDensity?: WorkspaceDensity
  agentBindings?: PaneAgentBinding[]
}

export interface UpdateWorkspaceEditorStateInput {
  workspaceId: string
  editorVisible?: boolean
  editorExpanded?: boolean
  editorWidthPercent?: number
}

export interface UpdateWorkspaceReviewStateInput {
  workspaceId: string
  reviewPanelVisible?: boolean
  reviewPanelExpanded?: boolean
  reviewPanelWidthPercent?: number
}

export interface UpdateWorkspaceGitHubStateInput {
  workspaceId: string
  githubPanelVisible?: boolean
  githubPanelExpanded?: boolean
  githubPanelWidthPercent?: number
  githubActiveTab?: GitHubPanelTab
}

export interface UpdateWorkspaceBackgroundStateInput {
  workspaceId: string
  backgroundPanelVisible?: boolean
  backgroundPanelExpanded?: boolean
  backgroundPanelWidthPercent?: number
}

export interface UpdateWorkspaceWorktreeStateInput {
  workspaceId: string
  worktreePanelVisible?: boolean
  worktreePanelExpanded?: boolean
  worktreePanelWidthPercent?: number
}

export interface UpdateWorkspaceSettingsInput {
  workspaceId: string
  themeId?: WorkspaceThemeId
  uiDensity?: WorkspaceDensity
  defaultShellProfileId?: string
  layoutPreset?: WorkspaceLayoutPreset
  applyShellToIdlePanes?: boolean
}
