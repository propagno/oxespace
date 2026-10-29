import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Shield, X } from 'lucide-react'
import type { ThreadPermissionSuggestion, ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { requestOutcomeLabel } from '../../../shared/threadRequestOutcome'
import { elicitationContent, elicitationDefaults, elicitationFields, validateElicitationField, type ElicitationValue } from '../../../shared/elicitationForm'
import { cx, Select } from '../../ui'
import styles from './ThreadRequestCard.module.css'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

// In-memory only: preserve drafts across view remounts, never persist secrets.
const drafts = new Map<string, Record<string, string[]>>()

export function ThreadRequestCard({ request, disabled, turnResult, onRespond, onRemember, conversationId = '' }: {
  request: ThreadRequest
  conversationId?: string
  disabled: boolean
  turnResult?: 'completed' | 'failed' | 'interrupted'
  onRespond: (response: ThreadRequestResponse) => Promise<void>
  /** Saves allow rules for this project; the request is approved afterwards. */
  onRemember?: (suggestions: ThreadPermissionSuggestion[]) => Promise<void>
}) {
  const draftKey = `${conversationId}:${request.generation}:${request.id}:${request.createdAt}`
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => drafts.get(draftKey) ?? {})
  const [step, setStep] = useState(0)
  const card = useRef<HTMLElement>(null)
  const previousStep = useRef(step)
  useEffect(() => {
    if (previousStep.current === step) return
    previousStep.current = step
    const frame = requestAnimationFrame(() => card.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [step])
  const [sending, setSending] = useState(false)
  const inFlight = useRef(false)
  disabled = disabled || sending
  useEffect(() => {
    if (request.state !== 'pending') { drafts.delete(draftKey); return }
    const safe = Object.fromEntries(Object.entries(answers).filter(([id]) => !request.questions?.find(question => question.id === id)?.secret))
    drafts.set(draftKey, safe)
    while (drafts.size > 100) drafts.delete(drafts.keys().next().value!)
  }, [answers, draftKey, request.state, request.questions])
  const elicitation = useMemo(() => elicitationFields(request.schema), [request.schema])
  const [form, setForm] = useState<Record<string, ElicitationValue>>(() => elicitationDefaults(elicitation))
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState('')
  const requestLabel = request.kind === 'approval' && request.nativeMethod === 'can_use_tool:ExitPlanMode' ? 'Review plan'
    : request.kind === 'approval' && request.nativeMethod?.startsWith('can_use_tool:mcp__') ? 'Approve MCP tool request' : request.title
  const questionsAnswered = Boolean(request.questions?.length) && request.questions!.every(question => answers[question.id]?.some(value => value.trim()))
  const submit = async (response: ThreadRequestResponse) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    setError('')
    try { await onRespond(response); drafts.delete(draftKey) } catch (cause) { setError(humanizeError(cause, 'Could not answer this request')) }
    finally { inFlight.current = false; setSending(false) }
  }
  const policy = request.policy
  const remember = policy?.decision === 'ask' && policy.suggestions?.length && onRemember && request.availableDecisions?.includes('accept') !== false ? policy.suggestions : undefined
  const rememberAndApprove = async (suggestions: ThreadPermissionSuggestion[]) => {
    if (inFlight.current) return
    setError('')
    try { await onRemember!(suggestions) } catch (cause) { setError(humanizeError(cause, 'Could not save the rule')); return }
    await submit({ decision: 'accept' })
  }
  if (request.state !== 'pending') return <details className={cx(`thread-request-history is-${request.state}`, styles.history)}>
    <summary className={cx('thread-request is-resolved', styles.resolved)}>
    {request.resolution === 'answered' || request.resolution === 'approved' ? <Check size={14} /> : <AlertCircle size={14} />}
    <span><strong>{request.questions?.[0]?.question ?? request.title}</strong><small>{requestOutcomeLabel(request)}{policy && policy.decision !== 'ask' && (request.resolution === 'approved' || request.resolution === 'declined') ? ' · by a permission rule' : ''}{request.resolution === 'answered' && turnResult === 'failed' ? ' · The turn failed afterward; see the error below.' : request.resolution === 'answered' && turnResult === 'interrupted' ? ' · The turn was interrupted afterward.' : ''}</small></span>
    {request.resolvedAt && <time title={formatDateTime(request.resolvedAt)}>{formatDateTime(request.resolvedAt, { hour: '2-digit', minute: '2-digit' })}</time>}
    </summary>
    <div className={cx('thread-request-history-content', styles.historyBody)}>
      <p>{request.resolution === 'connection-lost' ? 'The application connection ended before the response could be confirmed. This is a saved record, not an active approval. No permission was inferred or resent.' : 'Saved request details. This request is no longer interactive.'}</p>
      {request.command || request.detail ? <pre>{request.command ?? request.detail}</pre> : null}
      {request.cwd && <p>Directory: {request.cwd}</p>}
      {request.reason && <p>Reason: {request.reason}</p>}
      {policy && policy.reasons.length > 0 && <p>Permission rules: {policy.reasons.join(' ')}</p>}
      {request.questions?.map(question => <div key={question.id}><strong>{question.question}</strong>{question.options?.length ? <ul>{question.options.map((option, index) => <li key={index}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul> : null}</div>)}
      {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    </div>
  </details>
  return <section ref={card} className={cx(`thread-request thread-request-${request.kind}`, styles.root, request.kind === 'question' && styles.question)} aria-label={requestLabel}>
    <header>{request.kind === 'permissions' ? <Shield size={14} /> : <AlertCircle size={14} />}<div><strong>{requestLabel}</strong>{request.kind !== 'approval' && request.detail && <p>{request.detail}</p>}</div></header>
    {request.kind === 'elicitation' && <p className={styles.context}>This MCP server requested confirmation or information. Full access controls filesystem and command access; it does not answer MCP requests.</p>}
    {request.kind === 'approval' && request.nativeMethod?.startsWith('can_use_tool:mcp__') && <p className={styles.context}>This request comes from an MCP tool. Full access does not approve requests made by the connected provider or MCP server.</p>}
    {request.kind === 'approval' && <ThreadApprovalDetails command={request.command ?? request.detail ?? ''} cwd={request.cwd} reason={request.reason} fileChanges={request.title === 'Approve file changes'} toolName={request.nativeMethod?.startsWith('can_use_tool:') ? request.nativeMethod.slice('can_use_tool:'.length) : undefined} />}
    {request.kind === 'approval' && policy?.decision === 'ask' && policy.reasons.length > 0 && <div className={cx('thread-request-policy', styles.policy, policy.risk && cx('is-high-risk', styles.highRisk))}>
      {policy.risk ? <strong>High-risk command</strong> : policy.level === 'red' ? <strong>Destructive or far-reaching command</strong> : policy.level === 'orange' ? <strong>Changes something</strong> : null}
      <ul>{policy.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      {policy.warnings?.map((warning, index) => <p key={index} role="note">{warning}</p>)}
    </div>}
    {(request.questions?.length ?? 0) > 1 && <nav className={cx('thread-question-steps', styles.steps)} aria-label="Questions"><button type="button" disabled={step === 0 || disabled} onClick={() => setStep(value => value - 1)}>Previous</button><span role="status" className={cx('thread-question-progress', styles.progress)}>{request.questions!.map((question, index) => <i key={question.id} aria-hidden="true" className={index === step ? cx('is-current', styles.current) : (answers[question.id]?.some(value => value.trim()) ? cx('is-answered', styles.answered) : undefined)} />)}<span>Question {step + 1} of {request.questions!.length}</span></span><button type="button" disabled={step === request.questions!.length - 1 || disabled} onClick={() => setStep(value => value + 1)}>Next</button></nav>}
    {request.questions?.length ? <div className={cx('thread-question-body', styles.body)}>{request.questions.map((question, index) => <fieldset key={question.id} disabled={disabled} hidden={index !== step}>
      <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
      {question.options?.length ? question.options.map(option => {
        const value = option.value ?? option.label, selected = answers[question.id]?.includes(value) ?? false
        return <label key={value} className={cx('thread-request-option', styles.option)}><input type={question.multiple ? 'checkbox' : 'radio'} name={question.id} checked={selected} onChange={() => setAnswers(current => ({ ...current, [question.id]: question.multiple ? selected ? (current[question.id] ?? []).filter(item => item !== value) : [...(current[question.id] ?? []), value] : [value] }))} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>
      }) : <input type={question.secret ? 'password' : 'text'} aria-label={question.question} value={answers[question.id]?.[0] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: [event.target.value] }))} />}
      {!!question.options?.length && <label className={cx('thread-request-field', styles.field)}><span>Other answer</span><input type={question.secret ? 'password' : 'text'} aria-label={`Other answer: ${question.question}`} placeholder="Write your own answer…" value={(answers[question.id] ?? []).filter(value => !question.options!.some(option => (option.value ?? option.label) === value)).join(', ')} onChange={event => setAnswers(current => ({ ...current, [question.id]: [...(question.multiple ? (current[question.id] ?? []).filter(value => question.options!.some(option => (option.value ?? option.label) === value)) : []), ...(event.target.value ? [event.target.value] : [])] }))} /></label>}
    </fieldset>)}</div> : null}
    {elicitation.map(field => {
      const value = form[field.name], problem = showProblems ? validateElicitationField(field, value) : null
      const set = (next: ElicitationValue) => setForm(current => ({ ...current, [field.name]: next }))
      const chosen = Array.isArray(value) ? value : []
      // A group of checkboxes cannot sit inside a label: each option is its own label.
      const Wrapper = field.kind === 'multi' ? 'fieldset' : 'label'
      return <Wrapper key={field.name} className={cx('thread-request-field', styles.field)}><span>{field.title}{field.required ? ' *' : ''}</span>{field.description && <small>{field.description}</small>}
        {field.kind === 'boolean' ? <input type="checkbox" checked={value === true} onChange={event => set(event.target.checked)} />
          : field.kind === 'single' ? <Select value={String(value ?? '')} onChange={event => set(event.target.value)}><option value="">Select…</option>{field.options!.map(option => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}</Select>
          : field.kind === 'multi' ? <span role="group" aria-label={field.title}>{field.options!.map(option => <label key={option.value}><input type="checkbox" checked={chosen.includes(option.value)} onChange={event => set(event.target.checked ? [...chosen, option.value] : chosen.filter(item => item !== option.value))} />{option.label ?? option.value}</label>)}</span>
          : <input type={field.kind === 'number' ? 'number' : field.format === 'email' ? 'email' : 'text'} step={field.integer ? 1 : 'any'} min={field.minimum} max={field.maximum} maxLength={field.maxLength} value={String(value ?? '')} onChange={event => set(event.target.value)} />}
        {problem && <small role="alert">{problem}</small>}
      </Wrapper>
    })}
    {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    {request.url && <p className={styles.url}>Open the authenticated URL in your browser, then confirm here: <code>{request.url}</code></p>}
    {error && <p role="alert">{error}</p>}
    <footer>
      {request.kind === 'question' && <small>{request.questions?.filter(question => answers[question.id]?.some(value => value.trim())).length ?? 0}/{request.questions?.length ?? 0} answered · Review before sending</small>}
      {request.kind === 'question' && <button type="button" className={cx('thread-request-answer', styles.answer)} disabled={disabled || !questionsAnswered} onClick={() => void submit({ answers })}>Answer</button>}
      {request.kind === 'elicitation' && <button type="button" disabled={disabled} onClick={() => {
        // Problems are shown on the fields once, when the person tries to continue.
        const { content, errors } = elicitationContent(elicitation, form)
        if (Object.keys(errors).length) { setShowProblems(true); return }
        void submit({ decision: 'accept', content })
      }}>Continue</button>}
      {request.kind === 'permissions' && <><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'turn' })}>Allow this turn</button><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'session' })}>Allow session</button></>}
      {request.kind === 'approval' && (request.availableDecisions ?? ['accept', 'decline']).filter(decision => decision === 'accept' || decision === 'acceptForSession').map(decision => <button type="button" key={decision} disabled={disabled} onClick={() => void submit({ decision })}>{decision === 'acceptForSession' ? 'Allow session' : 'Approve'}</button>)}
      {/* MCP tool suggestions are alternatives (the tool, or its whole server); the others must all be saved together. */}
      {request.kind === 'approval' && remember && (remember.every(item => item.kind === 'tool') ? remember.map(item => [item]) : [remember]).map(group => <button key={group.map(item => item.pattern).join(',')} type="button" className={cx('thread-request-remember', styles.remember)} disabled={disabled} title={`Saves ${group.map(item => item.pattern).join(', ')} as an allow rule for this project`} onClick={() => void rememberAndApprove(group)}>Always allow {group.map(item => item.label).join(', ')}</button>)}
      <button type="button" className={cx('thread-request-decline', styles.decline)} disabled={disabled} onClick={() => void submit({ decision: request.availableDecisions?.includes('cancel') ? 'cancel' : 'decline' })}><X size={14} />{request.availableDecisions?.includes('cancel') ? 'Cancel' : 'Decline'}</button>
    </footer>
  </section>
}
