import { useState, type ReactElement } from 'react'
import { Sparkles } from 'lucide-react'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/Field'
import { Dialog, Menu } from '../../ui/Overlay'
import { buildAgentPrompt, type AskContext, type AskKind } from './agent-prompt'

/**
 * Hands a question about the open query to the workspace's agent. The prompt is pasted into the agent
 * terminal for the person to read and send; it holds the statement, the error or plan and table and
 * column names, never rows. What the agent then reads goes through OxeQuery's gateway and its approvals.
 */
export function AskAgent({ context, hasError, hasPlan }: { context: AskContext; hasError: boolean; hasPlan: boolean }): ReactElement {
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const [writing, setWriting] = useState(false)
  const [request, setRequest] = useState('')
  const [message, setMessage] = useState('')

  const send = async (kind: AskKind): Promise<void> => {
    setMessage('')
    if (!workspaceId) { setMessage('Open a workspace with an agent terminal first.'); return }
    const result = await pasteIntoAgentTerminal(workspaceId, buildAgentPrompt(kind, { ...context, ...(kind === 'write' ? { request } : {}) }))
    setMessage(result.message)
    if (result.ok) { setWriting(false); setRequest('') }
  }
  const hasText = Boolean(context.sql?.trim())
  return <span className="oq-ask">
    <Menu label="Ask the agent" trigger={<Button size="sm" title="Pastes a prompt into your agent terminal. Rows are never included." icon={<Sparkles size={13} aria-hidden="true" />}>Ask agent</Button>}
      items={[
        { label: `Explain this ${context.engine === 'postgres' ? 'statement' : 'query'}`, disabled: !hasText, onSelect: () => void send('explain') },
        { label: 'Fix this error', disabled: !hasError, onSelect: () => void send('fix') },
        { label: 'Read this plan', disabled: !hasPlan, onSelect: () => void send('plan') },
        { type: 'separator' },
        { label: 'Write a query…', onSelect: () => setWriting(true) },
        { type: 'separator' },
        { type: 'label', label: 'Rows are never included' }
      ]} />
    {message && <small className="oq-muted" role="status">{message}</small>}
    {writing && <Dialog title="Write a query" size="sm" onClose={() => setWriting(false)}
      description="Describe what it should do. A prompt with the table and column names is pasted into your agent terminal; rows are never included."
      footer={<><Button onClick={() => setWriting(false)}>Cancel</Button>
        <Button variant="primary" disabled={!request.trim()} onClick={() => void send('write')}>Paste prompt</Button></>}>
      <form onSubmit={event => { event.preventDefault(); if (request.trim()) void send('write') }}>
        <TextField label="What should the query do?" autoFocus value={request} onChange={event => setRequest(event.target.value)} placeholder="Orders per customer last month…" />
      </form>
    </Dialog>}
  </span>
}
