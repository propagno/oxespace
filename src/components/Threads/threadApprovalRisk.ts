import { riskFromShell } from '../../../shared/approval-rules'
import type { ApprovalRisk } from '../../../shared/types/approvals'
import type { ThreadRequest } from '../../../shared/types/thread'

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
