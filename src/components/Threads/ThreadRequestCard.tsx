import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Shield, X } from 'lucide-react'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { requestOutcomeLabel } from '../../../shared/threadRequestOutcome'

// In-memory only: preserve drafts across view remounts, never persist secrets.
const drafts = new Map<string, Record<string, string[]>>()

export function ThreadRequestCard({ request, disabled, turnResult, onRespond, conversationId = '' }: {
  request: ThreadRequest
  conversationId?: string
  disabled: boolean
  turnResult?: 'completed' | 'failed' | 'interrupted'
  onRespond: (response: ThreadRequestResponse) => Promise<void>
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
  const [form, setForm] = useState<Record<string, string | number | boolean>>({})
  const [error, setError] = useState('')
  const fields = useMemo(() => Object.entries((request.schema?.properties && typeof request.schema.properties === 'object' ? request.schema.properties : {}) as Record<string, Record<string, unknown>>), [request.schema])
  const required = new Set(Array.isArray(request.schema?.required) ? request.schema.required.filter((value): value is string => typeof value === 'string') : [])
  const questionsAnswered = Boolean(request.questions?.length) && request.questions!.every(question => answers[question.id]?.some(value => value.trim()))
  const submit = async (response: ThreadRequestResponse) => {
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    setError('')
    try { await onRespond(response); drafts.delete(draftKey) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not answer this request') }
    finally { inFlight.current = false; setSending(false) }
  }
  if (request.state !== 'pending') return <details className={`thread-request-history is-${request.state}`}>
    <summary className="thread-request is-resolved">
    {request.resolution === 'answered' || request.resolution === 'approved' ? <Check size={13} /> : <AlertCircle size={13} />}
    <span><strong>{request.questions?.[0]?.question ?? request.title}</strong><small>{requestOutcomeLabel(request)}{request.resolution === 'answered' && turnResult === 'failed' ? ' · The turn failed afterward; see the error below.' : request.resolution === 'answered' && turnResult === 'interrupted' ? ' · The turn was interrupted afterward.' : ''}</small></span>
    {request.resolvedAt && <time title={new Date(request.resolvedAt).toLocaleString()}>{new Date(request.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
    </summary>
    <div className="thread-request-history-content">
      <p>{request.resolution === 'connection-lost' ? 'The application connection ended before the response could be confirmed. This is a saved record, not an active approval. No permission was inferred or resent.' : 'Saved request details. This request is no longer interactive.'}</p>
      {request.command || request.detail ? <pre>{request.command ?? request.detail}</pre> : null}
      {request.cwd && <p>Directory: {request.cwd}</p>}
      {request.reason && <p>Reason: {request.reason}</p>}
      {request.questions?.map(question => <div key={question.id}><strong>{question.question}</strong>{question.options?.length ? <ul>{question.options.map((option, index) => <li key={index}>{option.label}{option.description ? ` — ${option.description}` : ''}</li>)}</ul> : null}</div>)}
      {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    </div>
  </details>
  return <section ref={card} className={`thread-request thread-request-${request.kind}`} aria-label={request.title}>
    <header>{request.kind === 'permissions' ? <Shield size={15} /> : <AlertCircle size={15} />}<div><strong>{request.title}</strong>{request.kind !== 'approval' && request.detail && <p>{request.detail}</p>}</div></header>
    {request.kind === 'elicitation' && <p className="thread-request-context">This MCP server requested confirmation or information. Full access controls filesystem and command access; it does not answer MCP requests.</p>}
    {request.kind === 'approval' && <ThreadApprovalDetails command={request.command ?? request.detail ?? ''} cwd={request.cwd} reason={request.reason} fileChanges={request.title === 'Approve file changes'} />}
    {(request.questions?.length ?? 0) > 1 && <nav className="thread-question-steps" aria-label="Questions"><button type="button" disabled={step === 0 || disabled} onClick={() => setStep(value => value - 1)}>Previous</button><span role="status">Question {step + 1} of {request.questions!.length}</span><button type="button" disabled={step === request.questions!.length - 1 || disabled} onClick={() => setStep(value => value + 1)}>Next</button></nav>}
    {request.questions?.length ? <div className="thread-question-body">{request.questions.map((question, index) => <fieldset key={question.id} disabled={disabled} hidden={index !== step}>
      <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
      {question.options?.length ? question.options.map(option => {
        const value = option.value ?? option.label, selected = answers[question.id]?.includes(value) ?? false
        return <label key={value} className="thread-request-option"><input type={question.multiple ? 'checkbox' : 'radio'} name={question.id} checked={selected} onChange={() => setAnswers(current => ({ ...current, [question.id]: question.multiple ? selected ? (current[question.id] ?? []).filter(item => item !== value) : [...(current[question.id] ?? []), value] : [value] }))} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>
      }) : <input type={question.secret ? 'password' : 'text'} aria-label={question.question} value={answers[question.id]?.[0] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: [event.target.value] }))} />}
      {!!question.options?.length && <label className="thread-request-field"><span>Other answer</span><input type={question.secret ? 'password' : 'text'} aria-label={`Other answer: ${question.question}`} placeholder="Write your own answer…" value={(answers[question.id] ?? []).filter(value => !question.options!.some(option => (option.value ?? option.label) === value)).join(', ')} onChange={event => setAnswers(current => ({ ...current, [question.id]: [...(question.multiple ? (current[question.id] ?? []).filter(value => question.options!.some(option => (option.value ?? option.label) === value)) : []), ...(event.target.value ? [event.target.value] : [])] }))} /></label>}
    </fieldset>)}</div> : null}
    {fields.map(([name, schema]) => {
      const title = typeof schema.title === 'string' ? schema.title : name, description = typeof schema.description === 'string' ? schema.description : ''
      const options = Array.isArray(schema.enum) ? schema.enum.filter((value): value is string => typeof value === 'string') : []
      return <label key={name} className="thread-request-field"><span>{title}{required.has(name) ? ' *' : ''}</span>{description && <small>{description}</small>}
        {schema.type === 'boolean' ? <input type="checkbox" checked={Boolean(form[name])} onChange={event => setForm(value => ({ ...value, [name]: event.target.checked }))} />
          : options.length ? <select value={String(form[name] ?? '')} onChange={event => setForm(value => ({ ...value, [name]: event.target.value }))}><option value="">Select…</option>{options.map(value => <option key={value}>{value}</option>)}</select>
          : <input type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={String(form[name] ?? '')} onChange={event => setForm(value => ({ ...value, [name]: schema.type === 'number' || schema.type === 'integer' ? Number(event.target.value) : event.target.value }))} />}
      </label>
    })}
    {request.requestedPermissions && <pre>{JSON.stringify(request.requestedPermissions, null, 2)}</pre>}
    {request.url && <p className="thread-request-url">Open the authenticated URL in your browser, then confirm here: <code>{request.url}</code></p>}
    {error && <p role="alert">{error}</p>}
    <footer>
      {request.kind === 'question' && <small>{request.questions?.filter(question => answers[question.id]?.some(value => value.trim())).length ?? 0}/{request.questions?.length ?? 0} answered · Review before sending</small>}
      {request.kind === 'question' && <button type="button" className="thread-request-answer" disabled={disabled || !questionsAnswered} onClick={() => void submit({ answers })}>Answer</button>}
      {request.kind === 'elicitation' && <button type="button" disabled={disabled || [...required].some(name => form[name] === undefined || form[name] === '')} onClick={() => void submit({ decision: 'accept', content: form })}>Continue</button>}
      {request.kind === 'permissions' && <><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'turn' })}>Allow this turn</button><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'session' })}>Allow session</button></>}
      {request.kind === 'approval' && (request.availableDecisions ?? ['accept', 'decline']).filter(decision => decision === 'accept' || decision === 'acceptForSession').map(decision => <button type="button" key={decision} disabled={disabled} onClick={() => void submit({ decision })}>{decision === 'acceptForSession' ? 'Allow session' : 'Approve'}</button>)}
      <button type="button" className="thread-request-decline" disabled={disabled} onClick={() => void submit({ decision: request.availableDecisions?.includes('cancel') ? 'cancel' : 'decline' })}><X size={13} />{request.availableDecisions?.includes('cancel') ? 'Cancel' : 'Decline'}</button>
    </footer>
  </section>
}
