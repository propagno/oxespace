import type { ApprovalCenter } from '../approvals/approval-center'
import { PrompterRefusal, type ApprovalDecision, type ApprovalPrompter, type ApprovalRequest } from './approval-broker'

/**
 * Asks through the approval center (B10): the app's modal while a window exists, the system dialog only as its
 * fallback. Deny is the default; "allow for this run" is offered for low-risk reads only.
 */
export function centerApprovalPrompter(center: Pick<ApprovalCenter, 'ask'> | (() => Promise<Pick<ApprovalCenter, 'ask'>>)): ApprovalPrompter {
  return {
    async ask(request: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
      const [resolved, { brokerDraft }] = await Promise.all([typeof center === 'function' ? center() : center, import('../approvals/drafts')])
      const outcome = await resolved.ask(brokerDraft(request), signal)
      // Never shown (queue full, too long): the agent gets that reason, not the person's "declined".
      if (outcome.by === 'refused' && outcome.refusal) throw new PrompterRefusal(outcome.refusal)
      return outcome.intent === 'allow' ? 'allow-once' : outcome.intent === 'allow-session' ? 'allow-session' : 'deny'
    }
  }
}

/**
 * The app's prompter. The center is loaded on the first request (and at startup by the approvals wiring), outside the
 * main entry; the first request waits for that import, so it always reaches the window.
 */
export const appApprovalPrompter: ApprovalPrompter = centerApprovalPrompter(() => import('../approvals').then(module => module.approvalCenter))
