import { approvalCenter } from '../approvals'
import type { ApprovalCenter } from '../approvals/approval-center'
import { brokerDraft } from '../approvals/drafts'
import type { ApprovalDecision, ApprovalPrompter, ApprovalRequest } from './approval-broker'

/**
 * Asks through the approval center (B10): the app's modal while a window exists, the system dialog only as its
 * fallback. Deny is the default; "allow for this run" is offered for low-risk reads only.
 */
export function centerApprovalPrompter(center: Pick<ApprovalCenter, 'ask'>): ApprovalPrompter {
  return {
    async ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
      const outcome = await center.ask(brokerDraft(request), signal)
      return outcome.intent === 'allow' ? 'allow-once' : outcome.intent === 'allow-session' ? 'allow-session' : 'deny'
    }
  }
}

export const appApprovalPrompter: ApprovalPrompter = centerApprovalPrompter(approvalCenter)
