import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('oxequery')
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const [writing, setWriting] = useState(false)
  const [request, setRequest] = useState('')
  const [message, setMessage] = useState('')

  const send = async (kind: AskKind): Promise<void> => {
    setMessage('')
    if (!workspaceId) { setMessage(t('ask.noWorkspace')); return }
    const result = await pasteIntoAgentTerminal(workspaceId, buildAgentPrompt(kind, { ...context, ...(kind === 'write' ? { request } : {}) }))
    setMessage(result.ok ? t('ask.pasted') : t('ask.noTerminal'))
    if (result.ok) { setWriting(false); setRequest('') }
  }
  const hasText = Boolean(context.sql?.trim())
  return <span className="oq-ask">
    <Menu label={t('ask.menu')} trigger={<Button size="sm" title={t('ask.title')} icon={<Sparkles size={13} aria-hidden="true" />}>{t('ask.button')}</Button>}
      items={[
        { label: t(context.engine === 'postgres' ? 'ask.explainStatement' : 'ask.explainQuery'), disabled: !hasText, onSelect: () => void send('explain') },
        { label: t('ask.fix'), disabled: !hasError, onSelect: () => void send('fix') },
        ...(hasPlan ? [{ label: t('ask.plan'), onSelect: () => void send('plan') }] : []),
        { type: 'separator' },
        { label: t('ask.write'), onSelect: () => setWriting(true) },
        { type: 'separator' },
        { type: 'label', label: t('ask.noRows') }
      ]} />
    {message && <small className="oq-muted" role="status">{message}</small>}
    {writing && <Dialog title={t('ask.writeTitle')} size="sm" closeLabel={t('common.close')} onClose={() => setWriting(false)}
      description={t('ask.writeDescription')}
      footer={<><Button onClick={() => setWriting(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!request.trim()} onClick={() => void send('write')}>{t('ask.paste')}</Button></>}>
      <form onSubmit={event => { event.preventDefault(); if (request.trim()) void send('write') }}>
        <TextField label={t('ask.request')} autoFocus value={request} onChange={event => setRequest(event.target.value)} placeholder={t('ask.requestPlaceholder')} />
      </form>
    </Dialog>}
  </span>
}
