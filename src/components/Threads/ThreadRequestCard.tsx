import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertCircle, Check, ChevronDown, Copy, Pencil, RotateCcw, Shield, Sun, X } from 'lucide-react'
import type { ThreadPermissionSuggestion, ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { evaluateEditedShellCommand, maxApprovalRisk } from '../../../shared/shellCommandRisk'
import { approvalCommandPreview, ThreadApprovalDetails } from './ThreadApprovalDetails'
import { ThreadPlanReview } from './ThreadPlanReview'
import { extractPlanText, formatPlanReviewFeedback, isPlanReviewRequest, type PlanInlineComment, type PlanSectionBlock } from './planReviewModel'
import { isEditableShellApproval, threadApprovalRisk } from './threadApprovalRisk'
import { useAllowHold } from '../Approvals/useAllowHold'
import { useTranslation } from 'react-i18next'
import { elicitationContent, elicitationDefaults, elicitationFields, validateElicitationField, type ElicitationValue } from '../../../shared/elicitationForm'
import { Button, copyText, cx, ErrorState, FieldError, IconButton, Menu, Select, StatusSignal } from '../../ui'
import { useUIStore } from '../../store/ui.store'
import { AlwaysAllowConfirm, AlwaysAllowReason, clearAlwaysAllowToast, showAlwaysAllowToast } from '../Approvals/AlwaysAllowConfirm'
import { OPEN_APPROVAL_QUEUE_EVENT } from '../Approvals/approvalsBoot'
import { ImpactFacts } from '../Approvals/ImpactFacts'
import { ImpactPreview } from '../Approvals/ImpactPreview'
import { focusIsEditable } from '../Approvals/typingFocus'
import { i18n } from '../../i18n'
import styles from './ThreadRequestCard.module.css'
import { useThreadPrefs } from '../../store/thread-prefs.store'
import { isSendKey, sendKeyEvent } from './sendKey'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

const NON_TEXT_INPUT_TYPES = new Set(['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file'])

/** True when a keyboard event originates in a text-entry control (never fire 1–9 shortcuts while typing). */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type.toLowerCase())
  if (target.isContentEditable) return true
  const editable = target.closest('[contenteditable]')
  return editable !== null && editable.getAttribute('contenteditable') !== 'false'
}

const EMPTY_PLAN_COMMENTS: PlanInlineComment[] = []

// In-memory only: preserve drafts across view remounts, never persist secrets.
const drafts = new Map<string, Record<string, string[]>>()

const RESOLUTIONS = new Set(['answered', 'approved', 'declined', 'cancelled-by-user', 'turn-completed', 'turn-failed', 'interrupted', 'connection-lost'])

/** How a request that is no longer pending ended, in the interface language (shared/threadRequestOutcome has the English for agents). */
export function requestOutcomeText(request: ThreadRequest): string {
  if (request.resolution && RESOLUTIONS.has(request.resolution)) return i18n.t(`thread:outcome.${request.resolution as 'answered'}`)
  return i18n.t(request.state === 'expired' ? 'thread:outcome.expired' : request.state === 'cancelled' ? 'thread:outcome.cancelled' : 'thread:outcome.closed')
}

export function ThreadRequestCard({ request, agent, disabled: disabledProp, turnResult, onRespond, onRemember, onSeeImpact, conversationId = '', place }: {
  request: ThreadRequest
  agent?: string
  conversationId?: string
  disabled: boolean
  turnResult?: 'completed' | 'failed' | 'interrupted'
  onRespond: (response: ThreadRequestResponse) => Promise<void>
  /** Saves allow rules for this project; the request is approved afterwards. */
  onRemember?: (suggestions: ThreadPermissionSuggestion[]) => Promise<void>
  onSeeImpact?: () => void
  /** Worktree branch, or the folder name when the chat has no worktree. */
  place?: string
}) {
  const { t } = useTranslation('thread')
  const { t: tCommon } = useTranslation('common')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const draftKey = `${conversationId}:${request.generation}:${request.id}:${request.createdAt}`
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => drafts.get(draftKey) ?? {})
  const [step, setStep] = useState(0)
  const card = useRef<HTMLElement>(null)
  const denyButtonRef = useRef<HTMLButtonElement>(null)
  const previousStep = useRef(step)
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    // The next question can make the card taller than the conversation's viewport. Its buttons are what the person needs
    // next, so they are what is brought into view; the card itself only when it has no footer.
    const frame = requestAnimationFrame(() => (card.current?.querySelector('footer') ?? card.current)?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [step])
  const [sendingId, setSendingId] = useState<string | null>(null)
  const inFlight = useRef<string | null>(null)
  const disabled = disabledProp || sendingId === request.id
  useEffect(() => {
    if (request.state !== 'pending') { drafts.delete(draftKey); return }
    const safe = Object.fromEntries(Object.entries(answers).filter(([id]) => !request.questions?.find(question => question.id === id)?.secret))
    drafts.set(draftKey, safe)
    while (drafts.size > 100) drafts.delete(drafts.keys().next().value!)
  }, [answers, draftKey, request.state, request.questions])
  const elicitation = useMemo(() => elicitationFields(request.schema), [request.schema])
  const [form, setForm] = useState<Record<string, ElicitationValue>>(() => elicitationDefaults(elicitation))
  const [showProblems, setShowProblems] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current) }, [])
  useEffect(() => {
    if (!previewOpen) return
    const closePreview = (): void => setPreviewOpen(false)
    window.addEventListener(OPEN_APPROVAL_QUEUE_EVENT, closePreview)
    return () => window.removeEventListener(OPEN_APPROVAL_QUEUE_EVENT, closePreview)
  }, [previewOpen])
  const [alwaysAllowOpen, setAlwaysAllowOpen] = useState(false)
  const [savingRule, setSavingRule] = useState(false)
  const [error, setError] = useState('')
  const preview = request.kind === 'approval' ? request.preview : undefined
  const isPlanRequest = isPlanReviewRequest(request)
  const planText = useMemo(() => extractPlanText(request), [request])
  const [planReview, setPlanReview] = useState<{ key: string; comments: PlanInlineComment[]; generalNote: string }>(() => ({
    key: draftKey,
    comments: [],
    generalNote: ''
  }))
  const planComments = useMemo(
    () => (isPlanRequest && planReview.key === draftKey ? planReview.comments : EMPTY_PLAN_COMMENTS),
    [isPlanRequest, planReview, draftKey]
  )
  const planGeneralNote = isPlanRequest && planReview.key === draftKey ? planReview.generalNote : ''
  const addPlanComment = (section: PlanSectionBlock, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const nextComment: PlanInlineComment = {
      id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sectionIndex: section.index,
      excerpt: section.excerpt,
      lineRange: section.lineRange,
      comment: trimmed
    }
    setPlanReview(current => {
      const base = current.key === draftKey ? current : { key: draftKey, comments: [], generalNote: '' }
      return { ...base, comments: [...base.comments, nextComment] }
    })
  }
  const updatePlanComment = (commentId: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setPlanReview(current => {
      if (current.key !== draftKey) return current
      return { ...current, comments: current.comments.map(item => item.id === commentId ? { ...item, comment: trimmed } : item) }
    })
  }
  const deletePlanComment = (commentId: string) => {
    setPlanReview(current => {
      if (current.key !== draftKey) return current
      return { ...current, comments: current.comments.filter(item => item.id !== commentId) }
    })
  }
  const changePlanGeneralNote = (text: string) => {
    setPlanReview(current => {
      const base = current.key === draftKey ? current : { key: draftKey, comments: [], generalNote: '' }
      return { ...base, generalNote: text }
    })
  }
  const planFeedback = useMemo(
    () => (isPlanRequest ? formatPlanReviewFeedback(planComments, planGeneralNote) : ''),
    [isPlanRequest, planComments, planGeneralNote]
  )
  const hasPlanFeedback = planFeedback.length > 0
  const requestChangesLabel = planComments.length > 0
    ? t('planReview.requestChangesCount', { count: planComments.length })
    : t('planReview.requestChanges')
  const submitPlanChanges = () => {
    if (!planFeedback) return
    void submit({ decision: 'decline', reason: planFeedback })
  }
  const requestLabel = preview ? t('previewApproval.title', { agent: preview.agentName || t('previewApproval.defaultAgent') })
    : isPlanRequest ? t('request.reviewPlan')
    : request.kind === 'approval' && request.nativeMethod?.startsWith('can_use_tool:mcp__') ? t('request.mcpApproval') : request.title
  const questionsAnswered = Boolean(request.questions?.length) && request.questions!.every(question => answers[question.id]?.some(value => value.trim()))
  const submit = async (response: ThreadRequestResponse) => {
    const reqId = request.id
    if (inFlight.current === reqId) return
    inFlight.current = reqId
    setSendingId(reqId)
    setError('')
    try { await onRespond(response); drafts.delete(draftKey) } catch (cause) { setError(humanizeError(cause, t('request.answerFailed'))) }
    finally {
      if (inFlight.current === reqId) inFlight.current = null
      setSendingId(current => current === reqId ? null : current)
    }
  }
  // OXE-131: the free-text answer answers on the send key the person chose in Settings › Agents.
  const answerOnKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSendKey(sendKeyEvent(event), sendKey)) return
    event.preventDefault()
    if (!disabled && questionsAnswered) void submit({ answers })
  }
  const toggleQuestionOption = (questionId: string, value: string, multiple?: boolean): void => {
    setAnswers(current => {
      const existing = current[questionId] ?? []
      const selected = existing.includes(value)
      return {
        ...current,
        [questionId]: multiple
          ? (selected ? existing.filter(item => item !== value) : [...existing, value])
          : [value]
      }
    })
  }
  const policy = request.policy
  // B10 risk rules on the card too (P1-8): Approve is quiet above low risk; at critical risk it waits 2 s, Enter never
  // activates it and nothing is remembered; "allow session" only at low risk.
  const approvalCommand = request.command ?? request.detail ?? ''
  // OXE-477: inline command editing for shell command approvals (never guarded, never file/db/plan/MCP).
  const canEditCommand = isEditableShellApproval(request)
  const originalCommand = request.command ?? (request.impact ? request.impact.text : '')
  const [commandEdit, setCommandEdit] = useState<{ key: string; editing: boolean; value: string }>(() => ({
    key: draftKey,
    editing: false,
    value: originalCommand
  }))
  const editingCommand = canEditCommand && commandEdit.key === draftKey ? commandEdit.editing : false
  const editedCommand = canEditCommand && commandEdit.key === draftKey ? commandEdit.value : originalCommand
  const toggleEditingCommand = () => {
    setCommandEdit(current => {
      const base = current.key === draftKey ? current : { key: draftKey, editing: false, value: originalCommand }
      return { ...base, editing: !base.editing }
    })
  }
  const updateEditedCommand = (value: string) => {
    setCommandEdit({ key: draftKey, editing: true, value })
  }
  const resetEditedCommand = () => {
    setCommandEdit(current => ({ key: draftKey, editing: current.key === draftKey ? current.editing : false, value: originalCommand }))
  }
  const isCommandModified = canEditCommand && editedCommand !== originalCommand
  const editedCommandEmpty = canEditCommand && editedCommand.trim().length === 0
  const editedEval = useMemo(
    () => (isCommandModified ? evaluateEditedShellCommand(editedCommand) : null),
    [isCommandModified, editedCommand]
  )
  const withEditedCommand = (response: ThreadRequestResponse): ThreadRequestResponse => {
    if (!isCommandModified) return response
    if (response.decision !== 'accept' && response.decision !== 'acceptForSession') return response
    return { ...response, decision: 'accept', updatedInput: { command: editedCommand } }
  }
  // From the request's structure, never its title: titles become translated C3 text (FE-M-11).
  const fileChanges = request.kind === 'approval' && request.toolName === 'fileChange'
  const baseRisk = request.kind === 'approval' ? threadApprovalRisk(request, fileChanges || approvalCommandPreview(approvalCommand).writesFiles) : 'low'
  const risk = editedEval ? maxApprovalRisk(baseRisk, editedEval.risk) : baseRisk
  const critical = risk === 'critical'
  // P1-17: a change to a file that steers agents (.mcp.json, AGENTS.md, hooks) is answered by a person each time:
  // no "allow session", nothing remembered, Approve never the primary button, whatever the provider offers.
  const guarded = request.kind === 'approval' && (policy?.guarded === true || Boolean(editedEval?.guarded))
  const plainRiskEscalated = Boolean(editedEval) && (risk !== baseRisk || Boolean(editedEval?.guarded))
  const holdKey = critical && isCommandModified ? `${draftKey}:${editedCommand}` : draftKey
  const holdLeft = useAllowHold(request.kind === 'approval' && request.state === 'pending' && critical, holdKey)
  const guardEnter = critical ? (event: KeyboardEvent<HTMLButtonElement>) => { if (event.key === 'Enter') event.preventDefault() } : undefined
  const remember = !critical && !guarded && !isCommandModified && policy?.decision === 'ask' && policy.suggestions?.length && onRemember && request.availableDecisions?.includes('accept') !== false ? policy.suggestions : undefined
  const rememberAndApprove = async (suggestions: ThreadPermissionSuggestion[]) => {
    if (inFlight.current === request.id) return
    setError('')
    try { await onRemember!(suggestions) } catch (cause) { setError(humanizeError(cause, t('request.ruleFailed'))); return }
    await submit({ decision: 'accept' })
  }
  const isImpactApproval = request.kind === 'approval' && request.state === 'pending' && Boolean(request.impact)
  // OXE-175: Deny takes the focus only when the person is not typing (in this conversation's composer or anywhere else).
  const [typingAtMount] = useState(focusIsEditable)
  useEffect(() => {
    if (isImpactApproval && !focusIsEditable()) denyButtonRef.current?.focus()
  }, [isImpactApproval, request.id])
  if (request.state !== 'pending') {
    if (request.kind === 'approval' && (request.resolution === 'approved' || request.resolution === 'declined')) {
      const allowed = request.resolution === 'approved'
      const decided = allowed ? t('request.allowedOnce') : t('request.denied')
      return <p data-ui="request-decided" className={styles.decided}>{allowed ? <StatusSignal state="done" label={decided} size={14} /> : null}<span>{decided}</span></p>
    }
    return <details className={cx(`thread-request-history is-${request.state}`, styles.history)}>
    <summary className={cx('thread-request is-resolved', styles.resolved)}>
    {request.resolution === 'answered' || request.resolution === 'approved' ? <Check size={14} className="oxe-confirm" /> : <AlertCircle size={14} />}
    <span><strong>{request.questions?.[0]?.question ?? request.title}</strong><small>{requestOutcomeText(request)}{policy && policy.decision !== 'ask' && (request.resolution === 'approved' || request.resolution === 'declined') ? t('request.byRule') : ''}{request.resolution === 'answered' && turnResult === 'failed' ? t('request.failedAfter') : request.resolution === 'answered' && turnResult === 'interrupted' ? t('request.interruptedAfter') : ''}</small></span>
    {request.resolvedAt && <time title={formatDateTime(request.resolvedAt)}>{formatDateTime(request.resolvedAt, { hour: '2-digit', minute: '2-digit' })}</time>}
    </summary>
    <div className={cx('thread-request-history-content', styles.historyBody)}>
      <p>{request.resolution === 'connection-lost' ? t('request.connectionLost') : t('request.saved')}</p>
      {request.command || request.detail ? <pre>{request.command ?? request.detail}</pre> : null}
      {request.cwd && <p>{t('request.directory', { path: request.cwd })}</p>}
      {request.reason && <p>{t('request.reason', { reason: request.reason })}</p>}
      {policy && policy.reasons.length > 0 && <p>{t('request.rules', { reasons: policy.reasons.join(' ') })}</p>}
      {request.questions?.map(question => <div key={question.id}><strong>{question.question}</strong>{question.options?.length ? <ul>{question.options.map((option, index) => <li key={index}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul> : null}</div>)}
      {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    </div>
  </details>
  }
  if (isImpactApproval && request.impact) {
    const impact = request.impact
    const agentName = agent ?? t('f7.card.defaultAgent')
    const offer = request.alwaysAllow
    const offeredRule = !isCommandModified && !guarded && offer?.offered ? offer.rule : undefined
    // The label promises no more than the rule gives: a Codex rule lasts for its session, never the whole project.
    const alwaysAllowLabel = offeredRule?.scope === 'session' ? t('f7.card.alwaysAllowEllipsis') : t('request.alwaysAllowProject')
    const confirmAlwaysAllow = async (): Promise<void> => {
      if (savingRule || inFlight.current === request.id) return
      setSavingRule(true)
      try {
        const res = await window.oxe?.approvals?.alwaysAllow?.(request.id)
        setAlwaysAllowOpen(false)
        if (!res?.ok) {
          clearAlwaysAllowToast()
          return
        }
        await submit({ decision: 'accept' })
        showAlwaysAllowToast(
          t('f7.alwaysAllow.toastAdded', { command: impact.text }),
          t('f7.alwaysAllow.toastOpen'),
          () => useUIStore.getState().openSettingsPage('agent-permissions')
        )
      } finally {
        setSavingRule(false)
      }
    }
    const baseLevel = baseRisk === 'critical' ? 'critical' : impact.risk
    const level = editedEval ? maxApprovalRisk(baseLevel, editedEval.risk) : baseLevel
    const effectiveReversible = editedEval ? impact.reversible && editedEval.reversible : impact.reversible
    const effectiveText = isCommandModified ? editedCommand : impact.text
    const effectiveImpact = isCommandModified ? { ...impact, text: editedCommand, risk: level, reversible: effectiveReversible } : impact
    const impactRiskEscalated = Boolean(editedEval) && (level !== baseLevel || (!effectiveReversible && impact.reversible) || guarded)
    const oneStep = effectiveReversible && (level === 'low' || level === 'medium') && !guarded
    const kindLabel = isPlanRequest ? t('request.reviewPlan') : t(`request.kind.${impact.kind}`)
    const origin = [agentName, place].filter(Boolean).join(' · ')
    const openImpact = () => { if (onSeeImpact && !isCommandModified) onSeeImpact(); else setPreviewOpen(true) }
    const copyCommand = () => {
      const text = effectiveText
      const write = navigator.clipboard?.writeText
      if (write) void write.call(navigator.clipboard, text)
      else void copyText(text, t('f7.card.copyWhat'))
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    }
    const copyButton = <IconButton className={canEditCommand || isPlanRequest ? undefined : styles.copy} label={t('f7.card.copyExact')} title={t('f7.card.copyExact')} icon={copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} onClick={copyCommand} />
    const editButton = canEditCommand
      ? <IconButton data-action="edit-command" aria-pressed={editingCommand} disabled={disabled} label={editingCommand ? t('request.doneEditingCommand') : t('request.editCommand')} title={editingCommand ? t('request.doneEditingCommand') : t('request.editCommand')} icon={editingCommand ? <Check size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />} onClick={toggleEditingCommand} />
      : null
    const onImpactKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
      if (disabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isTextEntryTarget(event.target)) return
      if (event.key === '1') {
        event.preventDefault()
        void submit({ decision: 'decline' })
      } else if (event.key === '2') {
        if (editedCommandEmpty) return
        event.preventDefault()
        if (oneStep) void submit(withEditedCommand({ decision: 'accept' }))
        else openImpact()
      }
    }
    return <section ref={card} tabIndex={-1} onKeyDown={onImpactKeyDown} className={cx('thread-request thread-request-approval', styles.root, styles.impact)} data-ui="request-card" data-risk={level} aria-label={kindLabel}>
      <header><Sun size={14} aria-hidden="true" /><div><strong>{kindLabel}</strong>{guarded && <span className={cx('thread-request-guarded', styles.guarded)} data-testid="approval-guarded" title={t('request.guardedHint')}><Shield size={12} aria-hidden="true" />{t('request.guarded')}</span>}</div><span data-ui="risk-label" data-risk={level}>{tCommon('approvals.risk.label', { level: tCommon(`approvals.risk.${level}`) })}</span></header>
      {origin ? <p data-ui="request-origin" className={styles.origin}>{origin}</p> : null}
      {guarded ? <p className={styles.context} data-testid="approval-guarded-hint">{t('request.guardedHint')}</p> : null}
      {impact.why ? <p className={styles.context}>{impact.why}</p> : null}
      <div className={styles.factsWrap}><ImpactFacts impact={effectiveImpact} layout="chips" /></div>
      {/* A plan is prose to read whole, not a command: rendered with inline section comments (OXE-480). */}
      {isPlanRequest && planText
        ? <ThreadPlanReview
            plan={planText}
            comments={planComments}
            generalNote={planGeneralNote}
            disabled={disabled}
            headerAction={copyButton}
            statusText={copied ? t('markdown.copied') : ''}
            testId="request-plan"
            ariaLabel={t('approvalDetails.plan')}
            onAddComment={addPlanComment}
            onUpdateComment={updatePlanComment}
            onDeleteComment={deletePlanComment}
            onChangeGeneralNote={changePlanGeneralNote}
          />
        : editingCommand
          ? <div className={cx(styles.command, styles.commandEditing)} data-ui="request-command">
              <div className={styles.commandEditingHeader}>
                {isCommandModified && <span className={styles.commandEditedBadge} data-ui="command-edited">{t('request.commandEdited')}</span>}
                <span className={styles.commandEditingActions}>{editButton}{copyButton}</span>
              </div>
              <textarea
                className={styles.commandEditor}
                data-testid="approval-command-editor"
                aria-label={t('request.editCommandInput')}
                value={editedCommand}
                disabled={disabled}
                spellCheck={false}
                onChange={event => updateEditedCommand(event.target.value)}
                onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); toggleEditingCommand() } }}
              />
              <div className={styles.commandEditorBar}>
                <span className={styles.commandEditorStatus}>
                  {editedCommandEmpty && <span className={styles.commandEscalated} role="status">{t('request.commandEmpty')}</span>}
                  {!editedCommandEmpty && impactRiskEscalated && <span className={styles.commandEscalated} role="status">{t('request.commandRiskEscalated')}</span>}
                </span>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={12} aria-hidden="true" />} disabled={disabled || !isCommandModified} onClick={resetEditedCommand}>{t('request.resetCommand')}</Button>
              </div>
              <span role="status" className={styles.live}>{copied ? t('markdown.copied') : ''}</span>
            </div>
          : <div className={cx(styles.command, canEditCommand && styles.commandEditable)} data-ui="request-command">
              <code>{effectiveText}</code>
              {canEditCommand ? <span className={styles.commandActions}>{editButton}{copyButton}</span> : copyButton}
              {isCommandModified && <div className={styles.commandEditorBar}>
                <span className={styles.commandEditorStatus}>
                  <span className={styles.commandEditedBadge} data-ui="command-edited">{t('request.commandEdited')}</span>
                  {editedCommandEmpty && <span className={styles.commandEscalated} role="status">{t('request.commandEmpty')}</span>}
                  {!editedCommandEmpty && impactRiskEscalated && <span className={styles.commandEscalated} role="status">{t('request.commandRiskEscalated')}</span>}
                </span>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={12} aria-hidden="true" />} disabled={disabled} onClick={resetEditedCommand}>{t('request.resetCommand')}</Button>
              </div>}
              <span role="status" className={styles.live}>{copied ? t('markdown.copied') : ''}</span>
            </div>}
      {offer && !offer.offered ? <AlwaysAllowReason reasonKind={offer.reasonKind} className={styles.context} /> : null}
      {error && <ErrorState compact title={error} />}
      <footer>
        <Button ref={denyButtonRef} variant="secondary" aria-keyshortcuts="1" className={cx('thread-request-decline', styles.decline)} disabled={disabled} onClick={() => void submit({ decision: 'decline' })}><kbd className={styles.keycap} data-ui="option-key" data-option-key="1" aria-hidden="true" />{t('request.deny')}</Button>
        {isPlanRequest && hasPlanFeedback && <Button variant="secondary" data-ui="plan-request-changes" className={styles.requestChanges} disabled={disabled} onClick={submitPlanChanges}>{requestChangesLabel}</Button>}
        {oneStep ? <>
          <Button variant={hasPlanFeedback ? 'secondary' : 'primary'} aria-keyshortcuts="2" className={hasPlanFeedback ? styles.quiet : styles.allowPrimary} disabled={disabled || editedCommandEmpty} onClick={() => void submit(withEditedCommand({ decision: 'accept' }))}><kbd className={cx(styles.keycap, !hasPlanFeedback && styles.keycapOnAccent)} data-ui="option-key" data-option-key="2" aria-hidden="true" />{t('f7.card.allowOnce')}</Button>
          <Menu label={t('request.allowMenu')} trigger={<IconButton data-ui="allow-menu" label={t('request.allowMenu')} title={t('request.allowMenu')} icon={<ChevronDown size={14} aria-hidden="true" />} />} items={[
            ...(offeredRule ? [{ label: alwaysAllowLabel, onSelect: () => setAlwaysAllowOpen(true) }] : []),
            { label: t('f7.card.seeImpact'), onSelect: openImpact }
          ]} />
        </> : <Button variant="secondary" aria-keyshortcuts="2" className={styles.quiet} disabled={disabled || editedCommandEmpty} title={t('f7.card.seeImpactHint')} onClick={openImpact}><kbd className={styles.keycap} data-ui="option-key" data-option-key="2" aria-hidden="true" />{t('f7.card.seeImpact')}</Button>}
      </footer>
      {previewOpen ? <ImpactPreview request={isCommandModified ? { ...request, command: editedCommand, impact: effectiveImpact } : request} agent={agentName} onRespond={async response => { setPreviewOpen(false); await submit(withEditedCommand(response)) }} onClose={() => setPreviewOpen(false)} /> : null}
      {alwaysAllowOpen && offer?.offered && !isCommandModified ? <AlwaysAllowConfirm rule={offer.rule} runsProjectCode={offer.runsProjectCode} definedIn={offer.definedIn} busy={savingRule} onCancel={() => setAlwaysAllowOpen(false)} onConfirm={() => void confirmAlwaysAllow()} /> : null}
    </section>
  }
  const warmAmber = request.kind === 'approval' || request.kind === 'question'
  // OXE-336: a yes or no lists Deny first, on screen and for Tab; a form or a question keeps its answer first. The main
  // allow sits in a span so it stays a first child, which is what draws it as the main action; allows share order 2.
  const denyFirst = request.kind === 'approval' || request.kind === 'permissions' || (request.kind === 'elicitation' && !elicitation.length)
  const declineLabel = request.availableDecisions?.includes('cancel') ? t('request.cancel') : denyFirst ? t('request.deny') : t('request.decline')
  const approvalDecisions = request.kind === 'approval' && !preview
    ? (request.availableDecisions ?? ['accept', 'decline']).filter(decision => decision === 'accept' || (decision === 'acceptForSession' && risk === 'low' && !guarded && !isCommandModified))
    : []
  const rememberGroups = request.kind === 'approval' && !preview && remember
    ? (remember.every(item => item.kind === 'tool') ? remember.map(item => [item]) : [remember])
    : []
  const numberedApproval = request.kind === 'approval'
  const declineButton = <Button variant="secondary" aria-keyshortcuts={numberedApproval ? '1' : undefined} className={cx('thread-request-decline', styles.decline)} disabled={disabled} icon={numberedApproval ? undefined : <X size={14} aria-hidden="true" />} onClick={() => void submit({ decision: request.availableDecisions?.includes('cancel') ? 'cancel' : 'decline' })}>{numberedApproval && <kbd className={styles.keycap} data-ui="option-key" data-option-key="1" aria-hidden="true" />}{declineLabel}</Button>
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (isTextEntryTarget(event.target)) return
    if (!/^[1-9]$/.test(event.key)) return
    const index = Number(event.key) - 1
    if (request.kind === 'question') {
      const activeQuestion = request.questions?.[step]
      const option = activeQuestion?.options?.[index]
      if (!activeQuestion || !option) return
      event.preventDefault()
      toggleQuestionOption(activeQuestion.id, option.value ?? option.label, activeQuestion.multiple)
      return
    }
    if (request.kind === 'approval') {
      if (preview) {
        if (index === 0) { event.preventDefault(); void submit({ decision: 'decline' }) }
        else if (index === 1) { event.preventDefault(); void submit({ decision: 'accept' }) }
        return
      }
      if (index === 0) {
        event.preventDefault()
        void submit({ decision: request.availableDecisions?.includes('cancel') ? 'cancel' : 'decline' })
        return
      }
      // Critical approvals keep the 2 s wait and never allow one-keystroke approval (safety invariant).
      if (critical || holdLeft > 0 || editedCommandEmpty) return
      const choiceIndex = index - 1
      if (choiceIndex < approvalDecisions.length) {
        event.preventDefault()
        void submit(withEditedCommand({ decision: approvalDecisions[choiceIndex] }))
        return
      }
      const rememberIndex = choiceIndex - approvalDecisions.length
      if (rememberIndex >= 0 && rememberIndex < rememberGroups.length) {
        event.preventDefault()
        void rememberAndApprove(rememberGroups[rememberIndex])
      }
    }
  }
  return <section ref={card} tabIndex={-1} onKeyDown={onCardKeyDown} className={cx(`thread-request thread-request-${request.kind}`, styles.root, warmAmber && styles.amber, request.kind === 'question' && styles.question)} data-ui={request.kind === 'question' ? 'request-card' : undefined} aria-label={requestLabel}>
    <header>{request.kind === 'permissions' ? <Shield size={14} aria-hidden="true" /> : warmAmber ? <Sun size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}<div><strong>{requestLabel}</strong>{guarded && <span className={cx('thread-request-guarded', styles.guarded)} data-testid="approval-guarded" title={t('request.guardedHint')}><Shield size={12} aria-hidden="true" />{t('request.guarded')}</span>}{request.kind !== 'approval' && request.detail && <p>{request.detail}</p>}</div></header>
    {guarded && <p className={styles.context} data-testid="approval-guarded-hint">{t('request.guardedHint')}</p>}
    {request.kind === 'elicitation' && <p className={styles.context}>{t('request.elicitation')}</p>}
    {request.kind === 'approval' && request.nativeMethod?.startsWith('can_use_tool:mcp__') && <p className={styles.context}>{t('request.mcpContext')}</p>}
    {preview && <div className={styles.context}>
      <p>{preview.action.kind === 'click' ? t('previewApproval.click', { label: preview.action.label, origin: preview.origin })
        : preview.action.kind === 'fill' ? t('previewApproval.fill', { label: preview.action.label, origin: preview.origin })
        : preview.action.kind === 'navigate' ? t('previewApproval.navigate', { url: preview.action.target ?? preview.origin })
        : t('previewApproval.scroll', { origin: preview.origin })}</p>
      <p>{preview.scope === 'session' ? t('previewApproval.scopeSession', { origin: preview.origin }) : t('previewApproval.scopeAction')}</p>
      {preview.scope === 'action' && preview.action.kind === 'navigate' && isLoopbackOrigin(preview.origin) && <p>{t('previewApproval.leavingLocalhost')}</p>}
    </div>}
    {request.kind === 'approval' && !preview && <ThreadApprovalDetails
      command={canEditCommand ? editedCommand : approvalCommand}
      cwd={request.cwd}
      reason={request.reason}
      fileChanges={fileChanges}
      toolName={request.nativeMethod?.startsWith('can_use_tool:') ? request.nativeMethod.slice('can_use_tool:'.length) : undefined}
      editable={canEditCommand}
      editing={editingCommand}
      isModified={isCommandModified}
      riskEscalated={plainRiskEscalated}
      commandEmpty={editedCommandEmpty}
      disabled={disabled}
      onToggleEdit={toggleEditingCommand}
      onChangeCommand={updateEditedCommand}
      onResetCommand={resetEditedCommand}
      planReview={isPlanRequest && planText ? <ThreadPlanReview
        plan={planText}
        comments={planComments}
        generalNote={planGeneralNote}
        disabled={disabled}
        embedded
        onAddComment={addPlanComment}
        onUpdateComment={updatePlanComment}
        onDeleteComment={deletePlanComment}
        onChangeGeneralNote={changePlanGeneralNote}
      /> : undefined}
    />}
    {request.kind === 'approval' && policy?.decision === 'ask' && policy.reasons.length > 0 && <div className={cx('thread-request-policy', styles.policy, policy.risk && cx('is-high-risk', styles.highRisk))}>
      {policy.risk ? <strong>{t('request.highRisk')}</strong> : policy.level === 'red' ? <strong>{t('request.destructive')}</strong> : policy.level === 'orange' ? <strong>{t('request.changes')}</strong> : null}
      <ul>{policy.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      {policy.warnings?.map((warning, index) => <p key={index} role="note">{warning}</p>)}
    </div>}
    {(request.questions?.length ?? 0) > 1 && <nav className={cx('thread-question-steps', styles.steps)} aria-label={t('request.questions')}><Button variant="ghost" size="sm" disabled={step === 0 || disabled} onClick={() => setStep(value => value - 1)}>{t('request.previous')}</Button><span role="status" className={cx('thread-question-progress', styles.progress)}>{request.questions!.map((question, index) => <i key={question.id} aria-hidden="true" className={index === step ? cx('is-current', styles.current) : (answers[question.id]?.some(value => value.trim()) ? cx('is-answered', styles.answered) : undefined)} />)}<span>{t('request.progress', { current: step + 1, total: request.questions!.length })}</span></span><Button variant="ghost" size="sm" disabled={step === request.questions!.length - 1 || disabled} onClick={() => setStep(value => value + 1)}>{t('request.next')}</Button></nav>}
    {request.questions?.length ? <div className={cx('thread-question-body', styles.body)}>{request.questions.map((question, index) => <fieldset key={question.id} disabled={disabled} hidden={index !== step}>
      <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
      {question.options?.length ? question.options.map((option, optionIndex) => {
        const value = option.value ?? option.label, selected = answers[question.id]?.includes(value) ?? false
        return <label key={value} className={cx('thread-request-option', styles.option)}><input type={question.multiple ? 'checkbox' : 'radio'} name={question.id} checked={selected} onChange={() => toggleQuestionOption(question.id, value, question.multiple)} />{optionIndex < 9 && <kbd className={styles.keycap} data-ui="option-key" data-option-key={String(optionIndex + 1)} aria-hidden="true" />}<span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>
      }) : <input type={question.secret ? 'password' : 'text'} aria-label={question.question} onKeyDown={answerOnKey} value={answers[question.id]?.[0] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: [event.target.value] }))} />}
      {!!question.options?.length && <label className={cx('thread-request-field', styles.field)}><input type={question.secret ? 'password' : 'text'} aria-label={t('request.otherLabel', { question: question.question })} placeholder={t('request.otherOption')} onKeyDown={answerOnKey} value={(answers[question.id] ?? []).filter(value => !question.options!.some(option => (option.value ?? option.label) === value)).join(', ')} onChange={event => setAnswers(current => ({ ...current, [question.id]: [...(question.multiple ? (current[question.id] ?? []).filter(value => question.options!.some(option => (option.value ?? option.label) === value)) : []), ...(event.target.value ? [event.target.value] : [])] }))} /></label>}
    </fieldset>)}</div> : null}
    {elicitation.map(field => {
      const value = form[field.name], problem = showProblems ? validateElicitationField(field, value) : null
      const errorId = `${request.id}-${field.name}-error`
      const invalid = problem ? { 'aria-invalid': true, 'aria-describedby': errorId } : {}
      const set = (next: ElicitationValue) => setForm(current => ({ ...current, [field.name]: next }))
      const chosen = Array.isArray(value) ? value : []
      // A group of checkboxes cannot sit inside a label: each option is its own label.
      const Wrapper = field.kind === 'multi' ? 'fieldset' : 'label'
      return <Wrapper key={field.name} className={cx('thread-request-field', styles.field)}><span>{field.title}{field.required ? ' *' : ''}</span>{field.description && <small>{field.description}</small>}
        {field.kind === 'boolean' ? <input type="checkbox" checked={value === true} onChange={event => set(event.target.checked)} />
          : field.kind === 'single' ? <Select value={String(value ?? '')} {...invalid} onChange={event => set(event.target.value)}><option value="">{t('request.select')}</option>{field.options!.map(option => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}</Select>
          : field.kind === 'multi' ? <span role="group" aria-label={field.title}>{field.options!.map(option => <label key={option.value}><input type="checkbox" checked={chosen.includes(option.value)} onChange={event => set(event.target.checked ? [...chosen, option.value] : chosen.filter(item => item !== option.value))} />{option.label ?? option.value}</label>)}</span>
          : <input type={field.kind === 'number' ? 'number' : field.format === 'email' ? 'email' : 'text'} step={field.integer ? 1 : 'any'} min={field.minimum} max={field.maximum} maxLength={field.maxLength} value={String(value ?? '')} {...invalid} onChange={event => set(event.target.value)} />}
        {problem && <FieldError id={errorId}>{problem}</FieldError>}
      </Wrapper>
    })}
    {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    {request.url && <p className={styles.url}>{t('request.url')} <code>{request.url}</code></p>}
    {error && <ErrorState compact title={error} />}
    <footer>
      {request.kind === 'question' && <small>{t('request.answered', { answered: request.questions?.filter(question => answers[question.id]?.some(value => value.trim())).length ?? 0, total: request.questions?.length ?? 0 })}</small>}
      {request.kind === 'question' && <Button variant="primary" className={cx('thread-request-answer', styles.answer)} disabled={disabled || !questionsAnswered} onClick={() => void submit({ answers })}>{t('request.answer')}</Button>}
      {!preview && denyFirst && declineButton}
      {request.kind === 'elicitation' && <span className={styles.quiet}><Button variant="primary" disabled={disabled} onClick={() => {
        // Problems are shown on the fields once, when the person tries to continue.
        const { content, errors } = elicitationContent(elicitation, form)
        if (Object.keys(errors).length) { setShowProblems(true); return }
        void submit({ decision: 'accept', content })
      }}>{t(elicitation.length ? 'request.continue' : 'request.approve')}</Button></span>}
      {request.kind === 'permissions' && <><span className={styles.quiet}><Button variant="primary" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'turn' })}>{t('request.allowTurn')}</Button></span><Button variant="secondary" className={styles.quiet} disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'session' })}>{t('request.allowSession')}</Button></>}
      {preview ? <>
        <Button variant="secondary" autoFocus={!typingAtMount} aria-keyshortcuts="1" className={cx('thread-request-decline', styles.decline)} disabled={disabled} onClick={() => void submit({ decision: 'decline' })}><kbd className={styles.keycap} data-ui="option-key" data-option-key="1" aria-hidden="true" />{t('request.deny')}</Button>
        <Button variant="primary" aria-keyshortcuts="2" disabled={disabled} onClick={() => void submit({ decision: 'accept' })}><kbd className={cx(styles.keycap, styles.keycapOnAccent)} data-ui="option-key" data-option-key="2" aria-hidden="true" />{preview.scope === 'session' ? t('previewApproval.allowSession') : t('previewApproval.allowOnce')}</Button>
      </> : <>
      {request.kind === 'approval' && critical && <small role="status" data-testid="approval-hold">{holdLeft > 0 ? t('request.holdWaiting', { seconds: Math.ceil(holdLeft / 1000) }) : t('request.holdReady')}</small>}
      {isPlanRequest && hasPlanFeedback && <Button variant="secondary" data-ui="plan-request-changes" className={styles.requestChanges} disabled={disabled} onClick={submitPlanChanges}>{requestChangesLabel}</Button>}
      {approvalDecisions.map((decision, idx) => {
        const quiet = decision === 'acceptForSession' || risk !== 'low' || guarded || hasPlanFeedback
        const decisionLabel = decision === 'acceptForSession' ? t('request.allowSession') : t('request.approve')
        const shortcutNumber = !critical && idx + 2 <= 9 ? idx + 2 : null
        const allow = <Button key={decision} variant={quiet ? 'secondary' : 'primary'} aria-keyshortcuts={shortcutNumber ? String(shortcutNumber) : undefined} data-risk={risk} data-guarded={guarded ? 'true' : undefined} className={quiet ? styles.quiet : undefined} disabled={disabled || holdLeft > 0 || editedCommandEmpty} onKeyDown={guardEnter} onClick={() => { if (holdLeft <= 0 && !editedCommandEmpty) void submit(withEditedCommand({ decision })) }}>{shortcutNumber !== null && <kbd className={cx(styles.keycap, !quiet && styles.keycapOnAccent)} data-ui="option-key" data-option-key={String(shortcutNumber)} aria-hidden="true" />}{decisionLabel}</Button>
        return decision === 'accept' ? <span key={decision} className={styles.quiet}>{allow}</span> : allow
      })}
      {/* MCP tool suggestions are alternatives (the tool, or its whole server); the others must all be saved together. */}
      {rememberGroups.map((group, idx) => {
        const groupLabel = t('request.always', { labels: group.map(item => item.label).join(', ') })
        const shortcutNumber = !critical && approvalDecisions.length + idx + 2 <= 9 ? approvalDecisions.length + idx + 2 : null
        return <Button key={group.map(item => item.pattern).join(',')} variant="secondary" aria-keyshortcuts={shortcutNumber ? String(shortcutNumber) : undefined} className={cx('thread-request-remember', styles.quiet)} disabled={disabled} title={t('request.rememberTitle', { patterns: group.map(item => item.pattern).join(', ') })} onClick={() => void rememberAndApprove(group)}>{shortcutNumber !== null && <kbd className={styles.keycap} data-ui="option-key" data-option-key={String(shortcutNumber)} aria-hidden="true" />}{groupLabel}</Button>
      })}
      {!denyFirst && declineButton}
      </>}
    </footer>
  </section>
}
