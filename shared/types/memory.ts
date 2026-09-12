/** Persistent knowledge is scoped to a project; native agent sessions remain independent. */
export interface MemoryContext {
  projectId: string
  workspace: string
  project: string
  cwd: string
  agentId?: string
  sessionId?: string
}

export interface MemoryInput { text: string; title?: string }
export interface MemoryResult { text: string; path?: string; source: string }
export interface MemorySession { sessionId: string; agentId: string; cwd: string; ended: boolean }
export interface MemoryHandoff { id: string; summary: string; cwd?: string; state: string; nextSteps: string[]; openQuestions: string[]; filesTouched: string[] }
export interface ProjectContext { text: string; sources: string[] }
export interface MemoryHealth { status: 'disabled' | 'ready' | 'unavailable'; message?: string }
export interface MemorySettings {
  enabled: boolean
  automaticCapture: boolean
  automaticContext: boolean
}
export interface MemoryRuntimeSettings {
  mode: 'managed' | 'connected'
  executable: string
  url: string
}
export interface MemoryWorkspaceStatus {
  projectId: string
  settings: MemorySettings
  runtime: MemoryRuntimeSettings
  health: MemoryHealth
  sessions: MemorySession[]
}
export type MemoryReply<T> = { status: 'ok'; value: T } | { status: 'disabled' | 'unavailable'; message: string }
export interface MemoryApi {
  status(workspaceId: string): Promise<MemoryWorkspaceStatus>
  configure(input: { workspaceId: string; settings: MemorySettings; runtime: MemoryRuntimeSettings; token?: string }): Promise<MemoryWorkspaceStatus>
  install(): Promise<string>
  setupAgents(workspaceId: string): Promise<string>
  search(input: { workspaceId: string; query: string }): Promise<MemoryReply<MemoryResult[]>>
  recent(workspaceId: string): Promise<MemoryReply<MemoryResult[]>>
}
