/** Persistent identities, never native agent session IDs or credentials. */
export interface CoordinationScope {
  taskId: string
  originWorkspaceId: string
  originProjectId: string
  targetWorkspaceId: string
  targetProjectId: string
  revision: number
}

export type CoordinationRole = 'requester' | 'executor' | 'observer'
export type CoordinationAction = 'read' | 'message' | 'report' | 'control'
export interface CoordinationParticipant {
  id: string
  taskId: string
  role: CoordinationRole
  workspaceId: string
  projectId: string
}
