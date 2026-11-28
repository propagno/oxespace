import { riskFromShell } from '../../../shared/approval-rules'
import type { ApprovalRisk } from '../../../shared/types/approvals'
import type { ThreadRequest } from '../../../shared/types/thread'
import { approvalCommandPreview } from './ThreadApprovalDetails'

const SHELL_TOOL_NAME = /^(bash|command|shell|powershell|pwsh|sh|zsh|cmd)$/i

/**
 * The B10 risk of a conversation's approval card, from what the app already knows (P1-8):
 * - a built-in high-risk command (rm, curl, ssh…) or a destructive one (red: deletes, escalates, publishes) is
 *   critical, the coordinator's "destructive" (riskFromShell maps red to critical too);
 * - otherwise the shell classifier's level (green low, orange medium);
 * - a request the policy did not classify is medium, and so is one that writes files: neither is "low" without the
 *   classifier saying so.
 */
export function threadApprovalRisk(request: ThreadRequest, writes: boolean): ApprovalRisk {
  const policy = request.policy
  if (policy?.risk || policy?.level === 'red') return 'critical'
  if (policy?.level) {
    const level = riskFromShell(policy.level)
    return writes && level === 'low' ? 'medium' : level
  }
  return 'medium'
}

/**
 * OXE-477 · Strict eligibility for the dock's batch "Allow N safe" action.
 * Security invariants (strict AND):
 * - pending approval only (never questions, plans, permissions, elicitations, preview automation, or MCP tools);
 * - NOT guarded (never agent-steering files);
 * - low severity, reversible, and never requiring a hold.
 */
export function isStrictlySafeApproval(request: ThreadRequest): boolean {
  if (request.state !== 'pending' || request.kind !== 'approval') return false
  if (request.preview) return false
  if (request.toolName === 'ExitPlanMode' || request.nativeMethod === 'can_use_tool:ExitPlanMode') return false
  if (request.nativeMethod?.startsWith('can_use_tool:mcp__')) return false
  if (request.policy?.guarded === true) return false
  if (request.availableDecisions && !request.availableDecisions.includes('accept')) return false

  const approvalCommand = request.command ?? request.detail ?? ''
  const fileChanges = request.toolName === 'fileChange'
  const writes = fileChanges || approvalCommandPreview(approvalCommand).writesFiles
  const policyRisk = threadApprovalRisk(request, writes)
  if (policyRisk === 'critical') return false

  if (request.impact) {
    if (request.impact.kind === 'db' || request.impact.kind === 'push') return false
    if (request.impact.risk !== 'low' || request.impact.reversible !== true) return false
    if (request.policy?.risk || request.policy?.level === 'red') return false
    return true
  }

  return request.policy?.level === 'green' && !writes && policyRisk === 'low'
}

/**
 * OXE-477 · Whether an approval card carries a shell command that can be edited inline before approving.
 * Guarded requests, plans, file changes, database/container actions, preview actions, and MCP tool calls stay read-only.
 */
export function isEditableShellApproval(request: ThreadRequest): boolean {
  if (request.state !== 'pending' || request.kind !== 'approval') return false
  if (request.policy?.guarded === true) return false
  if (request.preview) return false
  if (request.toolName === 'ExitPlanMode' || request.nativeMethod === 'can_use_tool:ExitPlanMode') return false
  if (request.nativeMethod?.startsWith('can_use_tool:mcp__')) return false
  if (request.toolName === 'fileChange') return false
  const text = (request.command ?? (request.impact ? request.impact.text : '')).trim()
  if (!text) return false
  if (request.impact) {
    return request.impact.lang === 'shell' && (request.impact.kind === 'command' || request.impact.kind === 'push')
  }
  return typeof request.command === 'string' && (!request.toolName || SHELL_TOOL_NAME.test(request.toolName))
}
