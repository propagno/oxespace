/**
 * OXE-327 (OXE-132 · CA-4) · Workspace access ceiling: effective access is always
 * `min(workspaceCeiling, sessionAccess)` ordered from strictest to most permissive:
 *   read-only < workspace-write < full-access
 *
 * Pure shared rules so main (approval-center, domain-tool, agent-actions), the renderer
 * (WorkspaceSettingsModal), and unit tests evaluate the exact same ordering.
 */
import type { ApprovalRisk } from './types/approvals'

export const WORKSPACE_ACCESS_LEVELS = ['read-only', 'workspace-write', 'full-access'] as const
export type WorkspaceAccessLevel = typeof WORKSPACE_ACCESS_LEVELS[number]

/** Existing workspaces default to `full-access` until the person lowers their ceiling. */
export const DEFAULT_WORKSPACE_ACCESS_CEILING: WorkspaceAccessLevel = 'full-access'

const ACCESS_RANK: Record<WorkspaceAccessLevel, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'full-access': 2
}

export function isWorkspaceAccessLevel(value: unknown): value is WorkspaceAccessLevel {
  return typeof value === 'string' && Object.hasOwn(ACCESS_RANK, value)
}

export function accessRank(level: WorkspaceAccessLevel): number {
  return ACCESS_RANK[level]
}

/**
 * Computes `min(workspaceCeiling, sessionAccess)` ordered from strictest (`read-only`)
 * to most permissive (`full-access`). Omitted/null values default to `full-access`.
 */
export function effectiveAccess(
  workspaceCeiling?: WorkspaceAccessLevel | null,
  sessionAccess?: WorkspaceAccessLevel | null
): WorkspaceAccessLevel {
  const ceiling = workspaceCeiling ?? DEFAULT_WORKSPACE_ACCESS_CEILING
  const session = sessionAccess ?? DEFAULT_WORKSPACE_ACCESS_CEILING
  return ACCESS_RANK[ceiling] <= ACCESS_RANK[session] ? ceiling : session
}

/** Whether `effective` access is at least as permissive as `required`. */
export function accessSatisfies(effective: WorkspaceAccessLevel, required: WorkspaceAccessLevel): boolean {
  return ACCESS_RANK[effective] >= ACCESS_RANK[required]
}

/**
 * Maps an MCP domain-tool / agent action level to the minimum WorkspaceAccessLevel required.
 * - `read` (and read-scoped confirmations like cross-workspace reads) -> `read-only`
 * - `confirm` at `critical` risk -> `full-access`
 * - `write` and non-critical `confirm` -> `workspace-write`
 */
export function actionRequiredAccess(
  level: 'read' | 'write' | 'confirm',
  options: { risk?: ApprovalRisk; brokerRisk?: 'read' | 'write' | 'action' } = {}
): WorkspaceAccessLevel {
  if (level === 'read') return 'read-only'
  if (level === 'confirm' && options.brokerRisk === 'read') return 'read-only'
  if (level === 'confirm' && options.risk === 'critical') return 'full-access'
  return 'workspace-write'
}

/**
 * Maps an ApprovalCenter draft to the minimum WorkspaceAccessLevel required when the caller
 * did not specify `requiredAccess` explicitly.
 * - App's own prompts (`requester.kind === 'app'`) are never blocked -> `read-only`
 * - Low-risk read approvals (offering `allow-session`) -> `read-only`
 * - Critical-risk approvals -> `full-access`
 * - All other write/action approvals -> `workspace-write`
 */
export function approvalRequiredAccess(draft: {
  requesterKind: 'agent' | 'mcp-server' | 'app'
  risk: ApprovalRisk
  hasSessionReadOption: boolean
}): WorkspaceAccessLevel {
  if (draft.requesterKind === 'app') return 'read-only'
  if (draft.risk === 'low' && draft.hasSessionReadOption) return 'read-only'
  if (draft.risk === 'critical') return 'full-access'
  return 'workspace-write'
}
