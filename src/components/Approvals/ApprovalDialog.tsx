import { useEffect, useId, useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { History, OctagonAlert, ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react'
import { mainMessage } from '../../../shared/messages'
import { APPROVAL_AGENT_TEXT_MAX, type ApprovalRequest, type ApprovalRisk, type ApprovalsApi } from '../../../shared/types/approvals'
import { Badge, Button, Dialog, Notice, type Intent } from '../../ui'
import { useApprovalsStore, type ApprovalNotice } from './approvals.store'
import { denyOption, holdsAllow, visibleOptions } from './approvalsRules'
import { approvalT as t, factsSentence, formatAppNote, formatCount, formatMainMessage, formatTime, requesterKindName, requesterText, riskName, summaryLine } from './approvalText'
import { useAllowHold } from './useAllowHold'
import styles from './Approvals.module.css'

/**
 * Activations in the first moments after a request appears are ignored: a key held down, or a double click on the
 * previous request's button, must not answer the next one.
 */
export const ARM_MS = 400
// Timed with performance.now(): monotonic, and not frozen by a fixed clock (e2e) or moved by a clock change.

const RISK: Record<ApprovalRisk, { intent: Intent; icon: LucideIcon }> = {
  low: { intent: 'info', icon: ShieldCheck },
  medium: { intent: 'warning', icon: ShieldQuestion },
  high: { intent: 'danger', icon: ShieldAlert },
  critical: { intent: 'danger', icon: OctagonAlert }
}

function noticeText(notice: ApprovalNotice): { intent: 'info' | 'warning' | 'danger'; title: string; body: string } {
  if (notice.kind === 'refused') return { intent: 'warning', title: t('approvals.refused'), body: formatMainMessage(notice.message) }
  if (notice.kind === 'failed') return { intent: 'danger', title: t('approvals.refused'), body: notice.text }
  return { intent: 'info', title: t(`approvals.settled.${notice.by}`), body: '' }
}

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
  const shownAt = useRef(performance.now())
  const instance = `${request.id}:${request.generation}`
  useEffect(() => { shownAt.current = performance.now() }, [instance])
  // Main's pacing drives the hold and Enter (B10): allowDelayMs from when the request is on screen, enterDisabled.
  const held = holdsAllow(request)
  const holdLeft = useAllowHold(held, instance, request.allowDelayMs)

  const fallback = denyOption(request)
  const options = visibleOptions(request)
  const busy = busyId === request.id
  const choose = (optionId: string): void => {
    if (performance.now() - shownAt.current < armMs) return
    const option = options.find(item => item.id === optionId)
    if (!option || (option.intent !== 'deny' && holdLeft > 0)) return
    void useApprovalsStore.getState().respond(api, optionId)
  }
  const deny = (): void => { if (!busy && fallback) choose(fallback.id) }
  // With enterDisabled (critical) Enter never approves; Space or a click does, once the hold is over.
  const guardEnter = (event: KeyboardEvent<HTMLButtonElement>): void => { if (event.key === 'Enter') event.preventDefault() }

  const risk = RISK[request.risk]
  const RiskIcon = risk.icon
  const environment = request.environment
  const production = environment?.production === true
  const dangerous = production || request.risk === 'high' || request.risk === 'critical'
  const shownNotice = notice ? noticeText(notice) : null
  const hasAllow = options.some(option => option.intent !== 'deny')
  // A cut text can only be denied; the app says why, in its own notes, unless main already did.
  const notes = request.agentText.truncated && !request.appNotes.some(note => note.code === 'approvals.note.textCut')
    ? [...request.appNotes, mainMessage('approvals.note.textCut', { max: APPROVAL_AGENT_TEXT_MAX })]
    : request.appNotes

  return <Dialog title={formatMainMessage(request.title)} size="lg" onClose={deny} closeLabel={t('approvals.closeDeny')} testId="approval-dialog"
    description={<><span data-testid="approval-summary">{summaryLine(request)}</span><span className={styles.srOnly}> {factsSentence(request)}</span></>}
    footer={<>
      <Button variant="ghost" data-align="start" icon={<History size={14} aria-hidden="true" />} onClick={() => useApprovalsStore.getState().setHistoryOpen(true)}>{t('approvals.history.open')}</Button>
      {options.map(option => {
        const isDefault = option.id === fallback?.id
        const allow = option.intent !== 'deny'
        const variant = !allow || option.intent === 'allow-session' ? 'secondary' : dangerous ? 'danger' : 'primary'
        return <Button key={`${instance}:${option.id}`} variant={variant} autoFocus={isDefault} disabled={!!busyId || (allow && holdLeft > 0)}
          data-intent={option.intent} data-default={isDefault ? 'true' : undefined} onClick={() => choose(option.id)}
          onKeyDown={allow && request.enterDisabled ? guardEnter : undefined}>
          {formatMainMessage(option.label)}
        </Button>
      })}
    </>}>
    <div className={styles.meta}>
      {total > 1 && <span className={styles.queue} data-testid="approval-queue">{t('approvals.queue', { position, total })}</span>}
      <Badge intent={risk.intent} className={request.risk === 'critical' ? styles.critical : undefined}>
        <RiskIcon size={12} aria-hidden="true" />{t('approvals.risk.label', { level: riskName(request.risk) })}
      </Badge>
      {environment && !production && <Badge>{t('approvals.environment.label', { name: environment.name, kind: t(`approvals.environment.kind.${environment.kind}`) })}</Badge>}
    </div>
    {production && environment && <p className={styles.production} data-testid="approval-production">
      <OctagonAlert size={16} aria-hidden="true" />
      <strong>{t('approvals.environment.productionLabel', { name: environment.name })}</strong>
      <span>{t('approvals.environment.productionHint')}</span>
    </p>}
    <dl className={styles.requester}>
      <dt>{t('approvals.requester.label')}</dt>
      <dd><strong>{requesterText(request.requester)}</strong> <span className={styles.muted}>{requesterKindName(request.requester)} · {t('approvals.requester.verified')}</span></dd>
    </dl>
    {shownNotice && <Notice intent={shownNotice.intent} title={shownNotice.title}>{shownNotice.body || null}</Notice>}
    {notes.length > 0 && <section className={styles.appNotes} aria-labelledby={notesHeading} data-testid="approval-app-notes">
      <h3 id={notesHeading} className={styles.sectionTitle}>{t('approvals.appNotes')}</h3>
      <ul>{notes.map((note, index) => <li key={index}>{formatAppNote(note, request.kind)}</li>)}</ul>
    </section>}
    <section className={styles.agent} aria-labelledby={agentHeading} data-testid="approval-agent-block">
      <header className={styles.agentHeader}>
        <h3 id={agentHeading} className={styles.sectionTitle}>{t('approvals.agent.heading')}</h3>
        <span className={styles.muted}>{t('approvals.agent.length', { length: formatCount(request.agentText.length) })}</span>
      </header>
      <p className={styles.agentHint}>{t('approvals.agent.hint')}</p>
      {request.agentText.text
        // Plain text in a text node: never HTML, never markdown, never links. pre-wrap keeps the agent's spacing.
        ? <pre className={styles.agentText} tabIndex={0} aria-labelledby={agentHeading} data-testid="approval-agent-text">{request.agentText.text}</pre>
        : <p className={styles.muted}>{t('approvals.agent.empty')}</p>}
    </section>
    {hasAllow && held && <p className={styles.hold} role="status" data-testid="approval-hold">
      {holdLeft > 0 ? t('approvals.hold.waiting', { seconds: Math.ceil(holdLeft / 1000) }) : t(request.enterDisabled ? 'approvals.hold.ready' : 'approvals.hold.readyEnter')}
    </p>}
    <p className={styles.expires}>{t('approvals.expires', { time: formatTime(request.expiresAt) })}</p>
  </Dialog>
}
