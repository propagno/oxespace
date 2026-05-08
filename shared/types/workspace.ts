export type WorkspaceLayout = '1x1' | '1x2' | '2x1' | '2x2' | '3x4' | '4x4'

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
  defaultShellProfileId: string
  autoStart: boolean
  isActive: boolean
  panes: WorkspacePane[]
}

export interface CreateWorkspaceInput {
  rootPath: string
  layout: WorkspaceLayout
  defaultShellProfileId?: string
  autoStart?: boolean
  name?: string
}
