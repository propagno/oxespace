import type { MainMessage } from '../../../shared/messages'
import type { ApprovalHistoryEntry, ApprovalOption, ApprovalRequest, ApprovalRisk } from '../../../shared/types/approvals'
import { hasHiddenChars } from './hiddenChars'

/**
 * What the window enforces on top of the B10 contract (main enforces the same; shared/approval-rules.ts checks the
 * requests it emits). Pure, so the dialog and the tests read the same rules.
 */

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
 * The risk the window shows and acts on: main's, raised to at least high when the agent's text hides characters
 * (main does the same, B10 R2; the window does not wait for it).
 */
export function effectiveRisk(request: Pick<ApprovalRequest, 'risk' | 'agentText'>): ApprovalRisk {
  return (request.risk === 'low' || request.risk === 'medium') && hasHiddenChars(request.agentText.text) ? 'high' : request.risk
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
    return option.intent === 'allow' || effectiveRisk(request) === 'low'
  })
  return [...offered.filter(option => option.intent === 'deny'), ...offered.filter(option => option.intent !== 'deny')]
}

/** Allow options wait `allowDelayMs` after the request is shown (main's pacing: 2 s at critical, else 0). */
export const holdsAllow = (request: Pick<ApprovalRequest, 'allowDelayMs'>): boolean => request.allowDelayMs > 0

/** What the center weighs the main allow by: the request's risk, and whether its effect can be undone. */
export interface ApprovalWeight { risk: ApprovalRisk; reversible: boolean }

/**
 * How the center draws its main allow (ApprovalQueue's footer): primary; danger when the effect cannot be undone; at
 * critical and irreversible, danger behind hold-to-confirm, with no keyboard shortcut drawn on it.
 */
export type MainAllowStyle = 'primary' | 'danger' | 'hold'
export function mainAllowStyle(weight: ApprovalWeight | undefined): MainAllowStyle {
  if (!weight || weight.reversible) return 'primary'
  return weight.risk === 'critical' ? 'hold' : 'danger'
}

/**
 * The weight of a request of the approvals center. It carries no reversibility of its own, so a critical request is
 * taken as one that cannot be undone (nothing says it can); below critical it is weighed as the center weighs a
 * reversible change.
 */
export function requestWeight(request: Pick<ApprovalRequest, 'risk' | 'agentText'>): ApprovalWeight {
  const risk = effectiveRisk(request)
  return { risk, reversible: risk !== 'critical' }
}

export type ApprovalButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export interface ApprovalButton { option: ApprovalOption; variant: ApprovalButtonVariant; hold: boolean }

/**
 * A record's own options as the center's buttons, in their order: Deny first (secondary), the other ways to allow
 * (ghost: "Always allow" is never the one in view), and the main action last, the first "allow" option (allow once),
 * drawn by mainAllowStyle. One emphasised button at most.
 */
export function approvalButtons(options: readonly ApprovalOption[], weight?: ApprovalWeight): ApprovalButton[] {
  const allows = options.filter(option => option.intent !== 'deny')
  const main = allows.find(option => option.intent === 'allow') ?? allows[0]
  const style = mainAllowStyle(weight)
  return [
    ...options.filter(option => option.intent === 'deny').map(option => ({ option, variant: 'secondary' as const, hold: false })),
    ...allows.filter(option => option !== main).map(option => ({ option, variant: 'ghost' as const, hold: false })),
    ...(main ? [{ option: main, variant: style === 'primary' ? 'primary' as const : 'danger' as const, hold: style === 'hold' }] : [])
  ]
}

/**
 * A decision as the history shows it. A request that ended without the person's answer (main refused it: queue
 * full, text too long; it timed out; its source withdrew it) carries main's `reason`: the app's outcome, never the
 * person's decision. A person's own decision has no reason.
 */
export type ApprovalHistoryRow = Omit<ApprovalHistoryEntry, 'textSha256' | 'createdAt'>
export function refusalReason(row: ApprovalHistoryRow): MainMessage | undefined {
  return row.reason
}

export function historyRow(entry: ApprovalHistoryEntry): ApprovalHistoryRow {
  return { id: entry.id, kind: entry.kind, requester: entry.requester, risk: entry.risk, title: entry.title, summary: entry.summary, outcome: entry.outcome, by: entry.by, resolvedAt: entry.resolvedAt, reason: entry.reason }
}
