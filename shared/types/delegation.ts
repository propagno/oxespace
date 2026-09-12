export type DelegationState = 'preparing' | 'starting' | 'accepted' | 'blocked' | 'interrupted' | 'failed' | 'review' | 'approved' | 'cancelled'
export interface DelegationInput { key: string; agentProfileId: string; objective: string; handoff: string; acceptance: string }
export interface DelegationTask extends DelegationInput {
  id: string; workspaceId: string; project: string; originPaneId: string; originExecutionId: string
  destinationExecutionId?: string; paneId?: string; cwd: string; path: string; branch: string; baseSha: string
  localChanges: string; state: DelegationState; error?: string; context?: string; lastReport?: string; lastMessage?: string; createdAt: number; updatedAt: number
}
export interface DelegationEvent { cursor: number; taskId: string; kind: string; text: string; createdAt: number }
export interface DelegationSnapshot { enabled: boolean; tasks: DelegationTask[] }
export interface DelegationApi {
  status(workspaceId: string): Promise<DelegationSnapshot>
  configure(workspaceId: string, enabled: boolean): Promise<void>
  control(workspaceId: string, taskId: string, action: 'retry' | 'cancel' | 'approve'): Promise<void>
  onChanged(listener: (event: { workspaceId: string; taskId: string }) => void): () => void
}
