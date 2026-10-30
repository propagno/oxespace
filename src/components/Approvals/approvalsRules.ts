import type { MainMessage } from '../../../shared/messages'
import type { ApprovalHistoryEntry, ApprovalOption, ApprovalRequest } from '../../../shared/types/approvals'

/**
 * What the window enforces on top of the B10 contract (main enforces the same; shared/approval-rules.ts checks the
 * requests it emits). Pure, so the dialog and the tests read the same rules.
 */

/** At critical risk, allow options stay disabled this long after the request is shown. TODO(CCR B10): not exported by shared/approval-rules.ts yet. */
export const CRITICAL_ALLOW_DELAY_MS = 2_000

/** Requests in the order they are answered: oldest first, ties by id so the order never shuffles. */
export function byCreatedAt(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The order of the queue: requests main needs acknowledged (the crash prompt) first, then oldest first. */
export function queueOrder(a: { createdAt: number; id: string; ackRequired: boolean }, b: { createdAt: number; id: string; ackRequired: boolean }): number {
  return Number(b.ackRequired) - Number(a.ackRequired) || byCreatedAt(a, b)
}

/** The deny option the window falls back to: the default when it is a deny (the contract says it always is), else the first deny. */
export function denyOption(request: ApprovalRequest): ApprovalOption | undefined {
  const fallback = request.options.find(option => option.id === request.defaultOptionId)
  return fallback?.intent === 'deny' ? fallback : request.options.find(option => option.intent === 'deny')
}

/**
 * The options the window offers, deny first:
 * - a cut text offers deny only (the person must see all of what they approve);
 * - "allow for this run" (allow-session) only at low risk, even if main sent it.
 */
export function visibleOptions(request: ApprovalRequest): ApprovalOption[] {
  const offered = request.options.filter(option => {
    if (option.intent === 'deny') return true
    if (request.agentText.truncated) return false
    return option.intent === 'allow' || request.risk === 'low'
  })
  return [...offered.filter(option => option.intent === 'deny'), ...offered.filter(option => option.intent !== 'deny')]
}

/** Allow options wait CRITICAL_ALLOW_DELAY_MS at critical risk, and are never activated by Enter there. */
export const holdsAllow = (request: ApprovalRequest): boolean => request.risk === 'critical'

/**
 * A decision as the history shows it. `reason` carries why main settled it without the person, when it says so.
 * TODO(CCR B10): ApprovalHistoryEntry has no reason field and there is no C3 code for "denied, queue full"
 * (APPROVAL_QUEUE_MAX). The window reads an optional `reason` and recognises QUEUE_FULL_CODE until the contract has one.
 */
export type ApprovalHistoryRow = Omit<ApprovalHistoryEntry, 'textSha256' | 'createdAt'> & { reason?: MainMessage | { code: string; params: Record<string, unknown> } }
export const QUEUE_FULL_CODE = 'approvals.queueFull'
export const isQueueFull = (row: ApprovalHistoryRow): boolean => row.reason?.code === QUEUE_FULL_CODE

export function historyRow(entry: ApprovalHistoryEntry & { reason?: ApprovalHistoryRow['reason'] }): ApprovalHistoryRow {
  return { id: entry.id, kind: entry.kind, requester: entry.requester, risk: entry.risk, title: entry.title, summary: entry.summary, outcome: entry.outcome, by: entry.by, resolvedAt: entry.resolvedAt, reason: entry.reason }
}
