/** Linear integration (#4) — issues/board navigation and worktree-from-issue. */

export interface LinearStatus {
  /** A credential is stored for this machine. */
  connected: boolean
  /** Whether the stored credential is protected by the OS keychain/DPAPI. */
  encrypted: boolean
  /** Display name of the authenticated user, when known. */
  viewerName: string | null
  viewerEmail: string | null
  organization: string | null
  error: string | null
}

export interface LinearIssue {
  id: string
  /** Human key, e.g. `OXE-42`. */
  identifier: string
  title: string
  description: string | null
  url: string
  /** Branch name Linear suggests for this issue — used verbatim by worktrees. */
  branchName: string
  priority: number
  priorityLabel: string
  stateName: string
  stateType: string
  stateColor: string | null
  assigneeName: string | null
  teamKey: string | null
  updatedAt: string
}

export interface LinearTeam {
  id: string
  key: string
  name: string
}

export type LinearIssueScope = 'assigned' | 'created' | 'team'

export interface LinearListIssuesInput {
  scope: LinearIssueScope
  teamId?: string | null
  /** Free-text filter applied to title/identifier by the Linear API. */
  query?: string | null
  includeCompleted?: boolean
}

export interface LinearSetApiKeyInput {
  apiKey: string
}

export interface LinearWorktreeFromIssueInput {
  workspaceId: string
  rootPath: string
  issueId: string
  /** Defaults to the repo's current HEAD when omitted. */
  baseRef?: string | null
}

export interface LinearWorktreeFromIssueResult {
  ok: boolean
  message: string
  branch: string
  worktreePath: string | null
}
