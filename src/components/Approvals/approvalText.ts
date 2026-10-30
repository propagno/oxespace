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
  if (!isMainMessage(message)) return t('approvals.unknownCode')
  return t(`main:${messageKey(message.code)}`, messageValues(message, currentLanguage()))
}

export const riskName = (risk: ApprovalRisk): string => t(`approvals.risk.${risk}`)
export const requesterKindName = (requester: ApprovalRequester): string => t(`approvals.requester.${requester.kind}`)
export const requesterText = (requester: ApprovalRequester): string => formatMainMessage(requester.label)

/** The one summary line: main's generic summary for the action, and what it applies to. Never the agent's words. */
export function summaryLine(request: Pick<ApprovalRequest, 'summary' | 'target'>): string {
  const summary = formatMainMessage(request.summary)
  return request.target ? t('approvals.summaryTarget', { summary, target: request.target }) : summary
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
