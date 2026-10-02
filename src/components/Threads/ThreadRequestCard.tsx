import { useMemo, useState } from 'react'
import { AlertCircle, Check, Shield, X } from 'lucide-react'
import type { ThreadRequest, ThreadRequestResponse } from '../../../shared/types/thread'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { requestOutcomeLabel } from '../../../shared/threadRequestOutcome'

export function ThreadRequestCard({ request, disabled, turnResult, onRespond }: {
  request: ThreadRequest
  disabled: boolean
  turnResult?: 'completed' | 'failed' | 'interrupted'
  onRespond: (response: ThreadRequestResponse) => Promise<void>
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [form, setForm] = useState<Record<string, string | number | boolean>>({})
  const [error, setError] = useState('')
  const fields = useMemo(() => Object.entries((request.schema?.properties && typeof request.schema.properties === 'object' ? request.schema.properties : {}) as Record<string, Record<string, unknown>>), [request.schema])
  const required = new Set(Array.isArray(request.schema?.required) ? request.schema.required.filter((value): value is string => typeof value === 'string') : [])
  const questionsAnswered = Boolean(request.questions?.length) && request.questions!.every(question => answers[question.id]?.some(value => value.trim()))
  const submit = async (response: ThreadRequestResponse) => {
    setError('')
    try { await onRespond(response) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not answer this request') }
  }
  if (request.state !== 'pending') return <div className={`thread-request is-resolved is-${request.state}`}>
    {request.resolution === 'answered' || request.resolution === 'approved' ? <Check size={13} /> : <AlertCircle size={13} />}
    <span><strong>{request.questions?.[0]?.question ?? request.title}</strong><small>{requestOutcomeLabel(request)}{request.resolution === 'answered' && turnResult === 'failed' ? ' · The turn failed afterward; see the error below.' : request.resolution === 'answered' && turnResult === 'interrupted' ? ' · The turn was interrupted afterward.' : ''}</small></span>
    {request.resolvedAt && <time title={new Date(request.resolvedAt).toLocaleString()}>{new Date(request.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
  </div>
  return <section className={`thread-request thread-request-${request.kind}`} aria-label={request.title}>
    <header>{request.kind === 'permissions' ? <Shield size={15} /> : <AlertCircle size={15} />}<div><strong>{request.title}</strong>{request.kind !== 'approval' && request.detail && <p>{request.detail}</p>}</div></header>
    {request.kind === 'approval' && <ThreadApprovalDetails command={request.command ?? request.detail ?? ''} cwd={request.cwd} reason={request.reason} fileChanges={request.title === 'Approve file changes'} />}
    {request.questions?.map(question => <fieldset key={question.id}>
      <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
      {question.options?.length ? question.options.map(option => {
        const value = option.value ?? option.label, selected = answers[question.id]?.includes(value) ?? false
        return <label key={value} className="thread-request-option"><input type={question.multiple ? 'checkbox' : 'radio'} name={question.id} checked={selected} onChange={() => setAnswers(current => ({ ...current, [question.id]: question.multiple ? selected ? (current[question.id] ?? []).filter(item => item !== value) : [...(current[question.id] ?? []), value] : [value] }))} /><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></label>
      }) : <input type={question.secret ? 'password' : 'text'} aria-label={question.question} value={answers[question.id]?.[0] ?? ''} onChange={event => setAnswers(current => ({ ...current, [question.id]: [event.target.value] }))} />}
    </fieldset>)}
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
      {request.kind === 'question' && <button type="button" disabled={disabled || !questionsAnswered} onClick={() => void submit({ answers })}>Answer</button>}
      {request.kind === 'elicitation' && <button type="button" disabled={disabled || [...required].some(name => form[name] === undefined || form[name] === '')} onClick={() => void submit({ decision: 'accept', content: form })}>Continue</button>}
      {request.kind === 'permissions' && <><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'turn' })}>Allow this turn</button><button type="button" disabled={disabled} onClick={() => void submit({ decision: 'accept', permissions: request.requestedPermissions ?? {}, scope: 'session' })}>Allow session</button></>}
      {request.kind === 'approval' && (request.availableDecisions ?? ['accept', 'decline']).filter(decision => decision === 'accept' || decision === 'acceptForSession').map(decision => <button type="button" key={decision} disabled={disabled} onClick={() => void submit({ decision })}>{decision === 'acceptForSession' ? 'Allow session' : 'Approve'}</button>)}
      <button type="button" className="thread-request-decline" disabled={disabled} onClick={() => void submit({ decision: request.availableDecisions?.includes('cancel') ? 'cancel' : 'decline' })}><X size={13} />{request.availableDecisions?.includes('cancel') ? 'Cancel' : 'Decline'}</button>
    </footer>
  </section>
}
