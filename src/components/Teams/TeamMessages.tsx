import { useCallback, useEffect, useRef, useState } from 'react'
import type { TeamMember, TeamMessage, TeamScope } from '../../../shared/types/team'

export function TeamMessages({ scope, member, members }: { scope: TeamScope; member: TeamMember; members: TeamMember[] }) {
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
  const label = (id: string | null) => id === null ? 'You' : members.find(m => m.id === id)?.name ?? 'Archived member'
  return <section className="team-messages" aria-label={`Messages with ${member.name}`}>
    <h3>Messages · {member.name}</h3>
    <p className="team-note">Messages remain in the inbox until acknowledged. Automatic delivery, when enabled, submits them to the connected Thread after it becomes idle. An uncertain delivery is never automatically repeated.</p>
    {error && <p role="alert">{error}</p>}
    {older && messages.length > 0 && messages.length < 500 && <button type="button" disabled={loadingOlder} onClick={async () => {
      setLoadingOlder(true)
      try {
        const page = await window.oxe.team!.messages(scope, member.id, messages[0].sequence)
        if (live.current) { setMessages(current => [...new Map([...page, ...current].map(m => [m.id, m])).values()].sort((a, b) => a.sequence - b.sequence)); setOlder(page.length === 50) }
      } catch (e) { if (live.current) setError(String(e)) }
      finally { if (live.current) setLoadingOlder(false) }
    }}>Load earlier messages</button>}
    <ol className="team-message-list">{messages.map(message => <li key={message.id}>
      <strong>{label(message.senderId)} → {label(message.recipientId)}</strong>
      <p>{message.body}</p><small>{message.receivedAt ? 'Receipt confirmed by agent' : message.deliveryState === 'submitted' ? 'Submitted to session · receipt not confirmed' : message.deliveryState === 'unknown' ? 'Delivery uncertain · check the session before sending again' : message.deliveryState === 'dispatching' ? 'Submitting to session…' : 'Saved · receipt not confirmed'}</small>
    </li>)}</ol>
    {!messages.length && <p>No messages yet.</p>}
    {messages.length >= 500 && <p className="team-note">Showing up to 500 messages. Older messages remain saved.</p>}
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
    }}><label>Message to {member.name}<textarea value={draft} disabled={sending} maxLength={4000} rows={3} onChange={e => setDraft(e.target.value)} /></label>
      <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Saving…' : 'Send to inbox'}</button>
    </form>
  </section>
}
