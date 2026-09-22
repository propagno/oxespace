export type DelegationState = 'preparing' | 'starting' | 'accepted' | 'blocked' | 'interrupted' | 'failed' | 'review' | 'approved' | 'cancelled'
export type DelegationBranchStrategy = 'existing' | 'create' | 'generated'
export type DelegationSurface = 'thread' | 'terminal'
export type DelegationRecoveryAction = 'open' | 'continue' | 'resume' | 'retry' | 'new-session' | 'cancel' | 'approve'

export interface DelegationBranchIntent {
  strategy: DelegationBranchStrategy
  /** Exact local branch for existing/create. Never rewritten by OXESpace. */
  name?: string
  /** Start point for create/generated. Defaults to the repository default branch. */
  baseRef?: string
  /** Optional remote used to resolve an existing remote branch. */
  remote?: string
  /** Refresh the selected remote before applying the checkout plan. */
  fetchBase?: boolean
  /** Reuse an already checked-out worktree instead of treating it as a conflict. */
  reuseExistingWorktree?: boolean
  /** Human work item used by generated templates; integration-provider agnostic. */
  reference?: string
  /** Optional label used in the generated slug. Falls back to the objective. */
  workLabel?: string
  /** Supported placeholders: {reference}, {slug}, {shortId}, {date}. */
  template?: string
}

export interface DelegationCheckout {
  strategy: DelegationBranchStrategy
  requestedBranch?: string
  branch: string
  baseRef: string
  baseSha: string
  remoteRef?: string
  path: string
  createBranch: boolean
  reuseExistingWorktree: boolean
  fetchBase: boolean
  resolvedAt: number
}

export interface DelegationNativeSession {
  provider: 'claude' | 'codex'
  nativeSessionId: string
  canonicalRoot: string
  generation: number
  observedAt: number
  resumable: boolean
}

export interface KnowledgeTransferSource {
  kind: 'handoff' | 'acceptance' | 'evidence' | 'memory' | 'code' | 'checkpoint' | 'session'
  label: string
  sha256: string
  bytes: number
}

export interface KnowledgeTransferBundle {
  version: 1
  revision: number
  objective: string
  acceptance: string
  handoff: string
  context: string
  sources: KnowledgeTransferSource[]
  createdAt: number
  sha256: string
}
export interface DelegationInput {
  key: string; agentProfileId: string; objective: string; handoff: string; acceptance: string
  schemaVersion?: 2
  previewId?: string
  targetWorkspaceId?: string
  mode?: 'analysis' | 'isolated-change'
  surface?: DelegationSurface
  branchIntent?: DelegationBranchIntent
  evidenceFiles?: string[]
  /** Explicitly selected saved Thread conversations from the origin project (max 5). */
  sourceThreadIds?: string[]
  /** Explicit AI Memory inclusion; omitted uses the project's automatic-context preference. */
  includeMemory?: boolean
}
export interface DelegationSessionContext {
  threadId: string
  title: string
  provider: 'claude' | 'codex'
  capturedAt: number
  text: string
}
export interface DelegationTask extends DelegationInput {
  id: string; workspaceId: string; project: string; originPaneId: string; originExecutionId: string
  destinationExecutionId?: string; paneId?: string; cwd: string; path: string; branch: string; baseSha: string
  localChanges: string; state: DelegationState; error?: string; context?: string; lastReport?: string; lastMessage?: string; createdAt: number; updatedAt: number
  originWorkspaceId?: string; originProjectId?: string; originCwd?: string
  checkout?: DelegationCheckout
  nativeSession?: DelegationNativeSession
  destinationThreadId?: string
  knowledgeBundle?: KnowledgeTransferBundle
  recoveryActions?: DelegationRecoveryAction[]
  evidence?: { path: string; commit: string; sha256: string; text: string }[]
  /** Bounded public-message snapshot captured at creation, stable across retry/restart. */
  sessionContext?: DelegationSessionContext[]
}
export interface DelegationEvent { cursor: number; taskId: string; kind: string; text: string; createdAt: number }
export interface DelegationTarget { workspaceId: string; name: string; rootPath: string; expiresAt: number; allowEvidence: boolean }
export interface DelegationPreflight { previewId?: string; targetWorkspaceId: string; targetName: string; ready: boolean; reason: string | null; checkout: DelegationCheckout; effects: string[] }
export interface DelegationSnapshot { enabled: boolean; tasks: DelegationTask[]; targets?: DelegationTarget[]; nextCursor?: string | null }
export interface DelegationApi {
  create(workspaceId: string, origin: { kind: 'pane' | 'thread'; id: string }, input: DelegationInput): Promise<DelegationTask>
  status(workspaceId: string, cursor?: string, limit?: number): Promise<DelegationSnapshot>
  preview(workspaceId: string, objective: string, branchIntent?: DelegationBranchIntent): Promise<DelegationPreflight>
  configure(workspaceId: string, enabled: boolean): Promise<void>
  control(workspaceId: string, taskId: string, action: DelegationRecoveryAction): Promise<void>
  configureTarget(workspaceId: string, rootPath: string, enabled: boolean, allowEvidence: boolean): Promise<void>
  adopt(workspaceId: string, taskId: string, paneId: string): Promise<void>
  onChanged(listener: (event: { workspaceId: string; taskId: string }) => void): () => void
}
