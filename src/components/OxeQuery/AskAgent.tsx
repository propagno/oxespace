import { useState, type ReactElement } from 'react'
import { Sparkles } from 'lucide-react'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { useWorkspaceStore } from '../../store/workspace.store'
import { buildAgentPrompt, type AskContext, type AskKind } from './agent-prompt'

/**
 * Hands a question about the open query to the workspace's agent. The prompt is pasted into the agent
 * terminal for the person to read and send; it holds the statement, the error or plan and table and
 * column names, never rows. What the agent then reads goes through OxeQuery's gateway and its approvals.
 */
export function AskAgent({ context, hasError, hasPlan }: { context: AskContext; hasError: boolean; hasPlan: boolean }): ReactElement {
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const [open, setOpen] = useState(false)
  const [writing, setWriting] = useState(false)
  const [request, setRequest] = useState('')
  const [message, setMessage] = useState('')

  const send = async (kind: AskKind): Promise<void> => {
    setMessage('')
    if (!workspaceId) { setMessage('Open a workspace with an agent terminal first.'); return }
    const result = await pasteIntoAgentTerminal(workspaceId, buildAgentPrompt(kind, { ...context, ...(kind === 'write' ? { request } : {}) }))
    setMessage(result.message)
    if (result.ok) { setOpen(false); setWriting(false); setRequest('') }
  }
  const hasText = Boolean(context.sql?.trim())
  return <span className="oq-ask">
    <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><Sparkles size={13} aria-hidden="true" />Ask agent</button>
    {open && <div className="oq-ask-menu" role="menu" aria-label="Ask the agent">
      <button type="button" role="menuitem" disabled={!hasText} onClick={() => void send('explain')}>Explain this {context.engine === 'postgres' ? 'statement' : 'query'}</button>
      <button type="button" role="menuitem" disabled={!hasError} onClick={() => void send('fix')}>Fix this error</button>
      <button type="button" role="menuitem" disabled={!hasPlan} onClick={() => void send('plan')}>Read this plan</button>
      {writing
        ? <form onSubmit={event => { event.preventDefault(); void send('write') }}>
          <input aria-label="What should the query do?" autoFocus value={request} onChange={event => setRequest(event.target.value)} placeholder="Orders per customer last month…" />
          <button type="submit" disabled={!request.trim()}>Paste prompt</button></form>
        : <button type="button" role="menuitem" onClick={() => setWriting(true)}>Write a query…</button>}
      <small className="oq-muted">Pastes a prompt into your agent terminal. Rows are never included.</small>
    </div>}
    {message && <small className="oq-muted" role="status">{message}</small>}
  </span>
}
