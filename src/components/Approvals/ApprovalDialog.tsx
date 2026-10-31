import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { History, OctagonAlert, ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react'
import { mainMessage } from '../../../shared/messages'
import { APPROVAL_AGENT_TEXT_MAX, type ApprovalRequest, type ApprovalRisk, type ApprovalsApi } from '../../../shared/types/approvals'
import { Badge, Button, Dialog, Notice, type Intent } from '../../ui'
import { noticeFor, refKey, useApprovalsStore, type ApprovalNotice } from './approvals.store'
import { acknowledge } from './approvalsBoot'
import { denyOption, effectiveRisk, holdsAllow, visibleOptions } from './approvalsRules'
import { approvalT as t, factsSentence, formatAppNote, formatCount, formatMainMessage, formatTime, isUnidentified, requesterKindName, requesterText, riskName, summaryLine } from './approvalText'
import { hasHiddenChars, revealHidden } from './hiddenChars'
import { useAllowHold } from './useAllowHold'
import { attentive, useWindowAttention } from './useWindowAttention'
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

function noticeText(notice: ApprovalNotice): { intent: 'warning' | 'danger'; title: string; body: string } {
  if (notice.kind === 'refused') return { intent: 'warning', title: t('approvals.refused'), body: formatMainMessage(notice.message) }
  return { intent: 'danger', title: t('approvals.refused'), body: notice.text }
}

/** Main's C3 note for hidden characters (B10 R2). */
const HIDDEN_NOTE = 'approvals.note.hiddenCharacters'

/** Someone was typing here when the request appeared: the dialog then does not put a button under their keys. */
function typingIn(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' || element.tagName === 'SELECT' || !!element.closest('.xterm')
}

const ACTIVATION_KEYS = new Set(['Enter', ' '])

export interface ApprovalDialogProps {
  request: ApprovalRequest
  position: number
  total: number
  api: ApprovalsApi
  armMs?: number
}

/**
 * One approval request: what is asked, by whom, where, how risky; the app's notes apart from the agent's words.
 * Mounted once per request and generation (ApprovalCenter keys it), so every answer, ack and notice here belongs to
 * the request this component rendered, never to whatever the queue holds at the moment of a click (R1).
 */
export function ApprovalDialog({ request, position, total, api, armMs = ARM_MS }: ApprovalDialogProps): ReactElement {
  useTranslation()
  const busyKey = useApprovalsStore(state => state.busy)
  const storedNotice = useApprovalsStore(state => state.notice)
  const agentHeading = useId()
  const notesHeading = useId()
  const inside = useRef<HTMLDivElement>(null)
  const shownAt = useRef(performance.now())
  // Read before the dialog takes focus: someone typing elsewhere does not get a button under their keys (R9).
  const startedTyping = useRef(typingIn(document.activeElement))
  // The option whose own key (Enter, Space) went down on it; a keyboard click without that is not the person's (R9).
  const pressed = useRef<string | null>(null)
  const instance = `${request.id}:${request.generation}`
  const attention = useWindowAttention()
  const looking = attentive(attention)
  // The request on screen tells main so, and again whenever the window comes into view and focus or leaves it (R3, R4).
  useEffect(() => { acknowledge({ id: request.id, generation: request.generation }, attention, api) }, [request.id, request.generation, attention, api])
  // Main's pacing drives the hold and Enter (B10): allowDelayMs counted while the request is on screen and looked at.
  const held = holdsAllow(request)
  const holdLeft = useAllowHold(held, instance, request.allowDelayMs, looking)

  const fallback = denyOption(request)
  const options = visibleOptions(request)
  const busy = busyKey === refKey(request)
  // `request` is the one rendered on screen: its id, generation and options are what is answered.
  const choose = (optionId: string): void => {
    if (performance.now() - shownAt.current < armMs) return
    const option = options.find(item => item.id === optionId)
    if (!option || (option.intent !== 'deny' && holdLeft > 0)) return
    void useApprovalsStore.getState().respond(api, request, optionId)
  }
  const deny = (): void => { if (!busy && fallback) choose(fallback.id) }
  const onOptionKeyDown = (option: { id: string; intent: string }) => (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!ACTIVATION_KEYS.has(event.key)) return
    // A held key repeats: its repeats never answer, whatever has focus by then.
    if (event.repeat) { event.preventDefault(); return }
    // With enterDisabled (critical) Enter never approves; Space or a click does, once the hold is over.
    if (event.key === 'Enter' && option.intent !== 'deny' && request.enterDisabled) { event.preventDefault(); return }
    pressed.current = option.id
  }
  const onOptionClick = (optionId: string) => (event: MouseEvent<HTMLButtonElement>): void => {
    const fromKey = event.detail === 0
    const ownKey = pressed.current === optionId
    pressed.current = null
    if (fromKey && !ownKey) return
    choose(optionId)
  }
  // Escape denies only when it is typed in this dialog, and never as a held key's repeat (R9).
  const onEscape = (event: globalThis.KeyboardEvent): void => {
    const target = event.target instanceof Node ? event.target : null
    const dialog = inside.current?.closest('[role="dialog"]')
    if (event.repeat || !target || !dialog?.contains(target)) event.preventDefault()
  }

  const shownRisk = effectiveRisk(request)
  const risk = RISK[shownRisk]
  const RiskIcon = risk.icon
  const environment = request.environment
  const production = environment?.production === true
  const dangerous = production || shownRisk === 'high' || shownRisk === 'critical'
  const notice = noticeFor(storedNotice, request)
  const shownNotice = notice ? noticeText(notice) : null
  const hasAllow = options.some(option => option.intent !== 'deny')
  // Main flags hidden characters with its own note (#238); the window also finds the ones main's list does not cover
  // (tag characters, other format characters) and then says so in its own words.
  const hiddenUnflagged = hasHiddenChars(request.agentText.text) && !request.appNotes.some(note => note.code === HIDDEN_NOTE)
  // A cut text can only be denied; the app says why, in its own notes, unless main already did.
  const notes = request.agentText.truncated && !request.appNotes.some(note => note.code === 'approvals.note.textCut')
    ? [...request.appNotes, mainMessage('approvals.note.textCut', { max: APPROVAL_AGENT_TEXT_MAX })]
    : request.appNotes
  const unidentified = isUnidentified(request.requester)
  const pieces = request.agentText.text ? revealHidden(request.agentText.text) : []

  return <Dialog title={formatMainMessage(request.title)} size="lg" onClose={deny} closeLabel={t('approvals.closeDeny')} testId="approval-dialog" onEscapeKeyDown={onEscape}
    description={<><span data-testid="approval-summary">{summaryLine(request)}</span><span className={styles.srOnly}> {factsSentence(request)}</span></>}
    footer={<>
      <Button variant="ghost" data-align="start" icon={<History size={14} aria-hidden="true" />} onClick={() => useApprovalsStore.getState().setHistoryOpen(true)}>{t('approvals.history.open')}</Button>
      {options.map(option => {
        const isDefault = option.id === fallback?.id
        const allow = option.intent !== 'deny'
        const variant = !allow || option.intent === 'allow-session' ? 'secondary' : dangerous ? 'danger' : 'primary'
        return <Button key={`${instance}:${option.id}`} variant={variant} autoFocus={isDefault && !startedTyping.current} disabled={!!busyKey || (allow && holdLeft > 0)}
          data-intent={option.intent} data-default={isDefault ? 'true' : undefined} onClick={onOptionClick(option.id)} onKeyDown={onOptionKeyDown(option)}>
          {formatMainMessage(option.label)}
        </Button>
      })}
    </>}>
    <div className={styles.meta} ref={inside}>
      {total > 1 && <span className={styles.queue} data-testid="approval-queue">{t('approvals.queue', { position, total })}</span>}
      <Badge intent={risk.intent} className={shownRisk === 'critical' ? styles.critical : undefined}>
        <RiskIcon size={12} aria-hidden="true" />{t('approvals.risk.label', { level: riskName(shownRisk) })}
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
      {/* An unknown requester is never called identified (R7). */}
      <dd><strong>{requesterText(request.requester)}</strong> <span className={styles.muted} data-testid="approval-requester-kind">{requesterKindName(request.requester)} · {t(unidentified ? 'approvals.requester.unidentified' : 'approvals.requester.verified')}</span></dd>
    </dl>
    {shownNotice && <Notice intent={shownNotice.intent} title={shownNotice.title}>{shownNotice.body || null}</Notice>}
    {(notes.length > 0 || hiddenUnflagged) && <section className={styles.appNotes} aria-labelledby={notesHeading} data-testid="approval-app-notes">
      <h3 id={notesHeading} className={styles.sectionTitle}>{t('approvals.appNotes')}</h3>
      <ul>
        {hiddenUnflagged && <li data-testid="approval-hidden-note">{t('approvals.hiddenCharacters')}</li>}
        {notes.map((note, index) => <li key={index}>{formatAppNote(note, request.kind)}</li>)}
      </ul>
    </section>}
    <section className={styles.agent} aria-labelledby={agentHeading} data-testid="approval-agent-block">
      <header className={styles.agentHeader}>
        <h3 id={agentHeading} className={styles.sectionTitle}>{t('approvals.agent.heading')}</h3>
        <span className={styles.muted}>{t('approvals.agent.length', { length: formatCount(request.agentText.length) })}</span>
      </header>
      <p className={styles.agentHint}>{t('approvals.agent.hint')}</p>
      {pieces.length
        // Plain text in text nodes: never HTML, never markdown, never links. pre-wrap keeps the agent's spacing. Each
        // invisible or bidi character is replaced by a visible marker and never reaches the page (R2): nothing is
        // reordered or hidden, on screen or in what is copied.
        ? <pre className={styles.agentText} dir="ltr" tabIndex={0} aria-labelledby={agentHeading} data-testid="approval-agent-text">{pieces.map((piece, index) => piece.kind === 'text'
          ? piece.text
          : <span key={index} className={styles.hiddenChar} data-hidden-char={piece.code}>⟨{piece.code}⟩</span>)}</pre>
        : <p className={styles.muted}>{t('approvals.agent.empty')}</p>}
    </section>
    {hasAllow && held && <p className={styles.hold} role="status" data-testid="approval-hold">
      {holdLeft > 0
        ? looking ? t('approvals.hold.waiting', { seconds: Math.ceil(holdLeft / 1000) }) : t('approvals.hold.paused')
        : t(request.enterDisabled ? 'approvals.hold.ready' : 'approvals.hold.readyEnter')}
    </p>}
    <p className={styles.expires}>{t('approvals.expires', { time: formatTime(request.expiresAt) })}</p>
  </Dialog>
}
