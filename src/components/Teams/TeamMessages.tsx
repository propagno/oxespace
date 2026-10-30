import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TeamMember, TeamMessage, TeamScope } from '../../../shared/types/team'
import { Button, TextArea } from '../../ui'

export function TeamMessages({ scope, member, members }: { scope: TeamScope; member: TeamMember; members: TeamMember[] }) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<TeamMessage[]>([]), [draft, setDraft] = useState('')
  const [error, setError] = useState(''), [sending, setSending] = useState(false)
  const [older, setOlder] = useState(false), [loadingOlder, setLoadingOlder] = useState(false)
  const pending = useRef<{ key: string; body: string } | null>(null)
  const live = useRef(true)
  const initialized = useRef(false)
  const refresh = useCallback(async () => {
    try {
      const page = await window.oxe.team!.messages(scope, member.id)
      if (!live.current) return
      setMessages(current => {
        const merged = new Map(current.map(message => [message.id, message]))
        page.forEach(message => merged.set(message.id, message))
        return [...merged.values()].sort((a, b) => a.sequence - b.sequence).slice(-500)
      })
      if (!initialized.current) { setOlder(page.length === 50); initialized.current = true }
    } catch (e) { if (live.current) setError(String(e)) }
  }, [scope, member.id])
  useEffect(() => {
    live.current = true
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 5000)
    return () => { live.current = false; clearInterval(timer) }
  }, [refresh])
  const label = (id: string | null) => id === null ? t('team.you') : members.find(m => m.id === id)?.name ?? t('team.archivedMember')
  return <section className="team-messages" aria-label={t('team.messagesWith', { name: member.name })}>
    <h3>{t('team.messagesTitle', { name: member.name })}</h3>
    <p className="team-note">{t('team.inboxNote')}</p>
    {error && <p role="alert">{error}</p>}
    {older && messages.length > 0 && messages.length < 500 && <button type="button" disabled={loadingOlder} onClick={async () => {
      setLoadingOlder(true)
      try {
        const page = await window.oxe.team!.messages(scope, member.id, messages[0].sequence)
        if (live.current) { setMessages(current => [...new Map([...page, ...current].map(m => [m.id, m])).values()].sort((a, b) => a.sequence - b.sequence)); setOlder(page.length === 50) }
      } catch (e) { if (live.current) setError(String(e)) }
      finally { if (live.current) setLoadingOlder(false) }
    }}>{t('team.loadEarlier')}</button>}
    <ol className="team-message-list">{messages.map(message => <li key={message.id}>
      <strong>{label(message.senderId)} → {label(message.recipientId)}</strong>
      <p>{message.body}</p><small>{message.receivedAt ? t('team.delivery.received') : message.deliveryState === 'submitted' ? t('team.delivery.submitted') : message.deliveryState === 'unknown' ? t('team.delivery.unknown') : message.deliveryState === 'dispatching' ? t('team.delivery.dispatching') : t('team.delivery.saved')}</small>
    </li>)}</ol>
    {!messages.length && <p>{t('team.noMessages')}</p>}
    {messages.length >= 500 && <p className="team-note">{t('team.limit')}</p>}
    <form onSubmit={async event => {
      event.preventDefault()
      if (sending || !draft.trim()) return
      setSending(true); setError('')
      if (!pending.current || pending.current.body !== draft) pending.current = { key: crypto.randomUUID(), body: draft }
      try {
        await window.oxe.team!.send(scope, member.id, pending.current.key, pending.current.body)
        if (live.current) { setDraft(''); pending.current = null; await refresh() }
      } catch (e) { if (live.current) setError(String(e)) }
      finally { if (live.current) setSending(false) }
    }}><label>{t('team.messageTo', { name: member.name })}<TextArea value={draft} disabled={sending} maxLength={4000} rows={3} onChange={e => setDraft(e.target.value)} /></label>
      <Button type="submit" variant="primary" className="team-form-submit" disabled={sending || !draft.trim()}>{sending ? t('team.saving') : t('team.send')}</Button>
    </form>
  </section>
}
