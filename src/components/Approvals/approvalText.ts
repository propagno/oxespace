import { isMainMessage, messageKey, messageValues, type MainMessage } from '../../../shared/messages'
import type { ApprovalRequest, ApprovalRequester, ApprovalRisk } from '../../../shared/types/approvals'
import { currentLanguage, i18n } from '../../i18n'

/** Keys built from a request's fields are looked up untyped; tests/approvals-boot.test.tsx checks they exist in both languages. */
const t = (key: string, values?: Record<string, unknown>): string => (i18n.t as unknown as (key: string, values?: Record<string, unknown>) => string)(key, values)

/**
 * Words a C3 message from main with the `main` catalog. TODO(CCR B10): use the shared formatMainMessage once it is on
 * main; none exists yet, so this mirrors McpServerSafety's lookup.
 */
export function formatMainMessage(message: MainMessage | { code: string; params: Record<string, unknown> }): string {
  // A code this version does not know never disappears: a generic sentence names it.
  if (!isMainMessage(message)) return t('approvals.unknownCode', { code: String(message.code) })
  return t(`main:${messageKey(message.code)}`, messageValues(message, currentLanguage()))
}

/**
 * One of the app's notes on a request. For OxeQuery, the SQL guard's risk reasons arrive as C3 codes
 * (`SqlGuardVerdict.codes`, #237): each is worded by the catalog, never by the guard's English string, and an
 * unknown one reads as a generic "risky SQL" reason with its code.
 */
export function formatAppNote(note: MainMessage | { code: string; params: Record<string, unknown> }, kind: ApprovalRequest['kind']): string {
  if (kind === 'oxequery' && !isMainMessage(note)) return t('approvals.sqlUnknown', { code: String(note.code) })
  return formatMainMessage(note)
}

/** Where a note's `rule` goes in its sentence: a marker no translation contains. */
const RULE_MARK = '\u0000rule\u0000'
/**
 * An app note in pieces, for B7.4's policy notes: a `{{rule}}` param (sanitized by main) is its own piece, so the
 * dialog shows it as plain code text, never as markdown or HTML (#372 SECURITY). Other notes are one text piece.
 */
export function appNoteParts(note: MainMessage | { code: string; params: Record<string, unknown> }, kind: ApprovalRequest['kind']): Array<{ text: string } | { rule: string }> {
  const rule = (note.params as Record<string, unknown> | undefined)?.rule
  if (typeof rule !== 'string' || (kind === 'oxequery' && !isMainMessage(note))) return [{ text: formatAppNote(note, kind) }]
  const marked = formatMainMessage({ ...note, params: { ...note.params, rule: RULE_MARK } } as unknown as MainMessage)
  return marked.split(RULE_MARK).flatMap((text, index) => index === 0 ? (text ? [{ text }] : []) : [{ rule }, ...(text ? [{ text }] : [])])
}

export const riskName = (risk: ApprovalRisk): string => t(`approvals.risk.${risk}`)
/** The text block's heading and hint for this kind (a changed policy file reads differently); the agent's by default. */
export const textLabel = (kind: string): string => i18n.exists(`common:approvals.textLabel.${kind}`) ? t(`approvals.textLabel.${kind}`) : t('approvals.agent.heading')
export const textHint = (kind: string): string => i18n.exists(`common:approvals.textHint.${kind}`) ? t(`approvals.textHint.${kind}`) : t('approvals.agent.hint')
export const requesterKindName = (requester: ApprovalRequester): string => t(`approvals.requester.${requester.kind}`)
/** The requester as main named it; never empty (an unknown provider reads "Unknown agent", B10). */
export const requesterText = (requester: ApprovalRequester): string => formatMainMessage(requester.label).trim() || t('approvals.requester.unknown')

/**
 * A requester main could not identify (an unknown provider in a pane or conversation, or no name at all): the window
 * must not say OXESpace identified it.
 */
export function isUnidentified(requester: ApprovalRequester): boolean {
  return String(requester.label?.code ?? '').startsWith('approvals.requester.unknown') || !formatMainMessage(requester.label).trim()
}

/** The one summary line: main's generic summary for the action, and what it applies to. Never the agent's words. */
export function summaryLine(request: Pick<ApprovalRequest, 'summary' | 'target'>): string {
  const summary = formatMainMessage(request.summary)
  // The target has its own Where row in the modal; the summary reads on its own.
  return summary
}

/** Risk, environment and requester as one sentence, for screen readers (the dialog's description ends with it). */
export function factsSentence(request: ApprovalRequest): string {
  const values = { risk: riskName(request.risk), requester: requesterText(request.requester), environment: request.environment?.name }
  if (!request.environment) return t('approvals.facts', values)
  return t(request.environment.production ? 'approvals.factsProduction' : 'approvals.factsEnvironment', values)
}

export const formatCount = (value: number): string => new Intl.NumberFormat(currentLanguage()).format(value)
export const formatTime = (at: number): string => new Date(at).toLocaleTimeString(currentLanguage(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export { t as approvalT }
