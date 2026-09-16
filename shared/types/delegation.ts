export type DelegationState = 'preparing' | 'starting' | 'accepted' | 'blocked' | 'interrupted' | 'failed' | 'review' | 'approved' | 'cancelled'
export interface DelegationInput {
  key: string; agentProfileId: string; objective: string; handoff: string; acceptance: string
  targetWorkspaceId?: string
  mode?: 'analysis' | 'isolated-change'
  evidenceFiles?: string[]
}
export interface DelegationTask extends DelegationInput {
  id: string; workspaceId: string; project: string; originPaneId: string; originExecutionId: string
  destinationExecutionId?: string; paneId?: string; cwd: string; path: string; branch: string; baseSha: string
  localChanges: string; state: DelegationState; error?: string; context?: string; lastReport?: string; lastMessage?: string; createdAt: number; updatedAt: number
  originWorkspaceId?: string; originProjectId?: string; originCwd?: string
  evidence?: { path: string; commit: string; sha256: string; text: string }[]
}
export interface DelegationEvent { cursor: number; taskId: string; kind: string; text: string; createdAt: number }
export interface DelegationTarget { workspaceId: string; name: string; rootPath: string; expiresAt: number; allowEvidence: boolean }
export interface DelegationSnapshot { enabled: boolean; tasks: DelegationTask[]; targets?: DelegationTarget[] }
export interface DelegationApi {
  status(workspaceId: string): Promise<DelegationSnapshot>
  configure(workspaceId: string, enabled: boolean): Promise<void>
  control(workspaceId: string, taskId: string, action: 'retry' | 'cancel' | 'approve'): Promise<void>
  configureTarget(workspaceId: string, rootPath: string, enabled: boolean, allowEvidence: boolean): Promise<void>
  adopt(workspaceId: string, taskId: string, paneId: string): Promise<void>
  onChanged(listener: (event: { workspaceId: string; taskId: string }) => void): () => void
}
