export interface TerminalSpawnOptions {
  paneId: string
  workspaceId: string
  cwd: string
  executable: string
  args: string[]
  cols?: number
  rows?: number
}

export interface TerminalSessionInfo {
  paneId: string
  workspaceId: string
  cwd: string
  executable: string
}
