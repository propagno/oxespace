export type WorkspaceLayout = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '2x4' | '2x5' | '2x7' | '3x4' | '4x4'

export type WorkspaceLayoutPreset = 1 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16

export type WorkspaceThemeId = 'midnight' | 'nord' | 'dracula' | 'ocean' | 'monokai' | 'amber'

export type WorkspaceDensity = 'compact' | 'comfortable'

export type PaneType = 'terminal' | 'tasks' | 'editor' | 'swarm' | 'inspector'

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
}

export interface UpdateWorkspaceEditorStateInput {
  workspaceId: string
  editorVisible?: boolean
  editorExpanded?: boolean
  editorWidthPercent?: number
}

export interface UpdateWorkspaceSettingsInput {
  workspaceId: string
  themeId?: WorkspaceThemeId
  uiDensity?: WorkspaceDensity
  defaultShellProfileId?: string
  layoutPreset?: WorkspaceLayoutPreset
  applyShellToIdlePanes?: boolean
}
