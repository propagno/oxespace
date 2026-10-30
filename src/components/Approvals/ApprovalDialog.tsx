import { useEffect, useId, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { History, OctagonAlert, ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react'
import { Badge, Button, Dialog, Notice, type Intent } from '../../ui'
import type { ApprovalOption, ApprovalRequest, ApprovalRisk, ApprovalsApi } from './approvalsContract'
import { useApprovalsStore, type ApprovalNotice } from './approvals.store'
import { approvalT as t, formatApprovalMessage, formatCount, formatTime, kindTitle, requesterKindName, riskName, summaryOf } from './approvalText'
import styles from './Approvals.module.css'

/**
 * Activations in the first moments after a request appears are ignored: a key held down, or a double click on the
 * previous request's button, must not answer the next one.
 */
export const ARM_MS = 400

const RISK: Record<ApprovalRisk, { intent: Intent; icon: LucideIcon }> = {
  low: { intent: 'info', icon: ShieldCheck },
  medium: { intent: 'warning', icon: ShieldQuestion },
  high: { intent: 'danger', icon: ShieldAlert },
  critical: { intent: 'danger', icon: OctagonAlert }
}

function noticeText(notice: ApprovalNotice): { intent: 'info' | 'warning' | 'danger'; title: string; body: string } {
  if (notice.kind === 'refused') return { intent: 'warning', title: t('approvals.refused'), body: formatApprovalMessage({ code: notice.code, params: {} }) }
  if (notice.kind === 'failed') return { intent: 'danger', title: t('approvals.refused'), body: notice.text }
  return { intent: 'info', title: t(`approvals.settled.${notice.by}`), body: '' }
}

/** Deny options first, then the rest in main's order. */
const ordered = (options: ApprovalOption[]): ApprovalOption[] => [...options.filter(option => option.intent === 'deny'), ...options.filter(option => option.intent !== 'deny')]

export interface ApprovalDialogProps {
  request: ApprovalRequest
  position: number
  total: number
  api: ApprovalsApi
  armMs?: number
}

/** One approval request: what is asked, by whom, where, how risky; the app's notes apart from the agent's words. */
export function ApprovalDialog({ request, position, total, api, armMs = ARM_MS }: ApprovalDialogProps): ReactElement {
  useTranslation()
  const busyId = useApprovalsStore(state => state.busyId)
  const notice = useApprovalsStore(state => state.notice)
  const agentHeading = useId()
  const notesHeading = useId()
  const shownAt = useRef(Date.now())
  const instance = `${request.id}:${request.generation}`
  useEffect(() => { shownAt.current = Date.now() }, [instance])

  const busy = busyId === request.id
  const choose = (optionId: string): void => {
    if (Date.now() - shownAt.current < armMs) return
    void useApprovalsStore.getState().respond(api, optionId)
  }
  const deny = (): void => { if (!busy) choose(request.defaultOptionId) }

  const risk = RISK[request.risk]
  const RiskIcon = risk.icon
  const production = request.environment?.production === true
  const dangerous = production || request.risk === 'high' || request.risk === 'critical'
  const shownNotice = notice ? noticeText(notice) : null

  return <Dialog title={kindTitle(request.kind)} description={summaryOf(request)} size="lg" onClose={deny} closeLabel={t('approvals.closeDeny')} testId="approval-dialog"
    footer={<>
      <Button variant="ghost" data-align="start" icon={<History size={14} aria-hidden="true" />} onClick={() => useApprovalsStore.getState().setHistoryOpen(true)}>{t('approvals.history.open')}</Button>
      {ordered(request.options).map(option => {
        const isDefault = option.id === request.defaultOptionId
        const variant = option.intent === 'deny' ? 'secondary' : option.intent === 'allow-session' ? 'secondary' : dangerous ? 'danger' : 'primary'
        return <Button key={`${instance}:${option.id}`} variant={variant} autoFocus={isDefault} disabled={!!busyId}
          data-intent={option.intent} data-default={isDefault ? 'true' : undefined} onClick={() => choose(option.id)}>
          {formatApprovalMessage(option.label)}
        </Button>
      })}
    </>}>
    <div className={styles.meta}>
      {total > 1 && <span className={styles.queue} data-testid="approval-queue">{t('approvals.queue', { position, total })}</span>}
      <Badge intent={risk.intent} className={request.risk === 'critical' ? styles.critical : undefined}>
        <RiskIcon size={12} aria-hidden="true" />{t('approvals.risk.label', { level: riskName(request.risk) })}
      </Badge>
      {request.environment && !production && <Badge>{t('approvals.environment.label', { name: request.environment.name })}</Badge>}
    </div>
    {production && request.environment && <p className={styles.production} data-testid="approval-production">
      <OctagonAlert size={16} aria-hidden="true" />
      <strong>{t('approvals.environment.productionLabel', { name: request.environment.name })}</strong>
      <span>{t('approvals.environment.productionHint')}</span>
    </p>}
    <dl className={styles.requester}>
      <dt>{t('approvals.requester.label')}</dt>
      <dd><strong>{request.requester.label}</strong> <span className={styles.muted}>{requesterKindName(request.requester)} · {t('approvals.requester.verified')}</span></dd>
    </dl>
    {shownNotice && <Notice intent={shownNotice.intent} title={shownNotice.title}>{shownNotice.body || null}</Notice>}
    {request.appNotes.length > 0 && <section className={styles.appNotes} aria-labelledby={notesHeading} data-testid="approval-app-notes">
      <h3 id={notesHeading} className={styles.sectionTitle}>{t('approvals.appNotes')}</h3>
      <ul>{request.appNotes.map((note, index) => <li key={index}>{formatApprovalMessage(note)}</li>)}</ul>
    </section>}
    <section className={styles.agent} aria-labelledby={agentHeading} data-testid="approval-agent-block">
      <header className={styles.agentHeader}>
        <h3 id={agentHeading} className={styles.sectionTitle}>{t('approvals.agent.heading')}</h3>
        <span className={styles.muted}>{t('approvals.agent.length', { length: formatCount(request.agentText.length) })}</span>
      </header>
      <p className={styles.agentHint}>{t('approvals.agent.hint')}</p>
      {request.agentText
        // Plain text in a text node: never HTML, never markdown, never links. pre-wrap keeps the agent's spacing.
        ? <pre className={styles.agentText} tabIndex={0} aria-labelledby={agentHeading} data-testid="approval-agent-text">{request.agentText}</pre>
        : <p className={styles.muted}>{t('approvals.agent.empty')}</p>}
      {request.truncated && <p className={styles.truncated} data-testid="approval-truncated">{t('approvals.agent.truncated', { limit: formatCount(request.agentTextLimit) })}</p>}
    </section>
    {request.expiresAt && <p className={styles.expires}>{t('approvals.expires', { time: formatTime(request.expiresAt) })}</p>}
  </Dialog>
}
