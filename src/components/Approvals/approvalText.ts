import { isMessageCode, messageKey, messageValues } from '../../../shared/messages'
import { currentLanguage, i18n } from '../../i18n'
import type { ApprovalKind, ApprovalMessage, ApprovalRequest, ApprovalRequester, ApprovalRisk } from './approvalsContract'

/** Keys are built from the request's fields, so they are looked up untyped; tests/i18n-catalog.test.ts checks they exist. */
const t = (key: string, values?: Record<string, unknown>): string => (i18n.t as unknown as (key: string, values?: Record<string, unknown>) => string)(key, values)

/**
 * Words a message from the main process. Shared C3 codes read the `main` catalog; approvals codes not yet in
 * shared/messages.ts read `approvals.codes.*` in `common`. TODO(CCR B10): one path once the codes move to main.json.
 */
export function formatApprovalMessage(message: ApprovalMessage): string {
  const values = messageValues(message as Parameters<typeof messageValues>[0], currentLanguage())
  if (isMessageCode(message.code)) return t(`main:${messageKey(message.code)}`, values)
  const key = `approvals.codes.${message.code}`
  return i18n.exists(key) ? t(key, values) : t('approvals.unknownCode')
}

export const kindTitle = (kind: ApprovalKind): string => t(`approvals.title.${kind}`)
export const kindName = (kind: ApprovalKind): string => t(`approvals.kind.${kind}`)
export const riskName = (risk: ApprovalRisk): string => t(`approvals.risk.${risk}`)
export const requesterKindName = (requester: ApprovalRequester): string => t(`approvals.requester.${requester.kind}`)
export const requesterText = (requester: ApprovalRequester): string => `${requesterKindName(requester)} · ${requester.label}`

/** The dialog's description: what, who, where and how risky, in one sentence a screen reader announces. */
export function summaryOf(request: ApprovalRequest): string {
  const values = { what: kindName(request.kind), requester: requesterText(request.requester), risk: riskName(request.risk), environment: request.environment?.name }
  if (!request.environment) return t('approvals.summary', values)
  return t(request.environment.production ? 'approvals.summaryProduction' : 'approvals.summaryEnvironment', values)
}

export const formatCount = (value: number): string => new Intl.NumberFormat(currentLanguage()).format(value)
export const formatTime = (at: number): string => new Date(at).toLocaleTimeString(currentLanguage(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export { t as approvalT }
