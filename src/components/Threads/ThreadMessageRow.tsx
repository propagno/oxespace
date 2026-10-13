import { useState } from 'react'
import { Check, Copy, FileText, Image as ImageIcon, Paperclip, Quote } from 'lucide-react'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { formatNativeUserText } from '../../../shared/native-session-text'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ThreadMarkdown } from './ThreadMarkdown'
import { ThreadDeliveryNote } from './ThreadDeliveryNote'
import { ThreadRewindControl } from './ThreadRewindControl'
import { ThreadHistoricalQuestions } from './ThreadHistoricalQuestions'
import { threadTurnPresentation } from './threadTurnPresentation'

export function authText(text: string): boolean { return /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(text) }

export function ThreadMessageBody({ text, role }: { text: string; role: 'user' | 'assistant' }) {
  const [expanded, setExpanded] = useState(false)
  const longPrompt = role === 'user' && (text.length > 800 || text.split('\n').length > 12)
  if (!longPrompt) return <ThreadMarkdown text={text} />
  return <div className="thread-long-prompt">
    {expanded ? <ThreadMarkdown text={text} /> : <p className="thread-long-prompt-preview">{text.replace(/\s+/g, ' ').slice(0, 240).trimEnd()}…</p>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show full message'}</button>
  </div>
}

/** One user or assistant message of the timeline, with its attachments, delivery state and actions. */
export function ThreadMessageRow({ event, turnEvents, snapshot, running, pending, copied, quickReplies, action, onCopy, onQuickReply, onQuote }: {
  event: Extract<ThreadEvent, { type: 'message' }>
  turnEvents: ThreadEvent[]
  snapshot: ThreadSnapshot | null
  running: boolean
  pending: boolean
  copied: boolean
  /** Suggested replies; only passed for the latest assistant message. */
  quickReplies: { label: string; value: string }[]
  action: (run: () => Promise<unknown>) => Promise<void>
  onCopy: (id: string, text: string) => void
  onQuickReply: (value: string) => void
  /** Adds the text to the composer as a Markdown quote. */
  onQuote: (text: string) => void
}) {
  const api = window.oxe?.thread
  if (event.role === 'assistant' && authText(event.text)) return null
  const displayText = event.role === 'user' && event.id.startsWith('native:') ? formatNativeUserText(event.text) : event.text
  if (!displayText && !event.historicalQuestions?.length) return null
  const copyText = event.historicalQuestions?.length ? [displayText, 'Recovered questions — answer not confirmed', ...event.historicalQuestions.flatMap(question => [question.title, ...(question.options ?? []).map(option => `- ${option}`)])].filter(Boolean).join('\n\n') : displayText
  const final = event.role === 'assistant' && threadTurnPresentation(turnEvents).finalMessageId === event.id
  return <article className={`thread-message thread-message-${event.role}${final ? ' is-final-response' : ''}`}>
    {event.role === 'assistant' && (final || turnEvents.find(value => value.type === 'message' && value.role === 'assistant') === event) && <div className="thread-agent-label"><AgentProviderIcon provider={snapshot?.thread.provider ?? 'claude'} size={16} />{snapshot?.thread.provider === 'claude' ? 'Claude' : 'Codex'}{final && <span className="thread-final-label">Final response</span>}</div>}
    {event.role === 'user' && event.attachments?.length ? <ul className="thread-sent-attachments" aria-label="Message attachments">{event.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={13} aria-hidden="true" /><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small></li>)}</ul> : null}
    <ThreadMessageBody text={displayText} role={event.role} />
    {event.role === 'user' && event.context?.length ? <ul className="thread-sent-context" aria-label="Attached file context">{event.context.map(file => <li key={file.path} title={`${file.bytes} bytes attached${file.truncated ? ' (truncated)' : ''}`}><FileText size={12} aria-hidden="true" /><span>{file.path}</span>{file.truncated && <small>truncated</small>}</li>)}</ul> : null}
    {event.role === 'user' && snapshot?.deliveries?.[event.id] && snapshot.deliveries[event.id].state !== 'delivered' ? <ThreadDeliveryNote delivery={snapshot.deliveries[event.id]} disabled={pending} onResend={() => void action(() => api!.send(snapshot.thread.id, event.text, event.attachments?.map(attachment => attachment.id) ?? []))} /> : null}
    {event.role === 'user' && snapshot && !running && api?.rewind && snapshot.thread.capabilities?.features.rewind?.enabled && (() => {
      const turns = snapshot.turns ?? [], index = turns.findIndex(turn => turn.id === event.id)
      const rewind = (options: { restoreFiles: boolean }, edit: boolean) => action(async () => {
        const result = await api.rewind!(snapshot.thread.id, event.id, options)
        useThreadStore.getState().updateSnapshot(result.snapshot)
        // The removed message returns to the composer; a draft in progress is kept below it.
        if (edit) { const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''; useThreadStore.getState().setDraft(snapshot.thread.id, current.trim() ? `${displayText}\n\n${current}` : displayText) }
        if (result.fileError) throw Error(`Conversation rewound. Files were not fully restored: ${result.fileError}`)
      })
      return index >= 0 && (turns[index].nativeId || snapshot.thread.provider === 'claude' && index > 0) ? <ThreadRewindControl laterTurns={turns.length - index} disabled={pending} onRewind={options => rewind(options, false)} onEdit={options => rewind(options, true)} /> : null
    })()}
    {event.historicalQuestions?.length ? <ThreadHistoricalQuestions questions={event.historicalQuestions} /> : null}
    {event.role === 'assistant' && quickReplies.length > 0 && <div className="thread-quick-replies" aria-label="Suggested replies"><small>Choose a reply to review before sending</small><div>{quickReplies.map(option => <button type="button" key={option.value} onClick={() => onQuickReply(option.value)}>{option.label}</button>)}</div></div>}
    {event.role !== 'user' && event.attachments?.length ? <div className="thread-message-attachments" aria-label="Message attachments">{event.attachments.map(attachment => <span key={attachment.id}><Paperclip size={11} />{attachment.name}<small>{Math.ceil(attachment.bytes / 1024)} KB</small></span>)}</div> : null}
    {event.role === 'assistant' && <div className="thread-message-actions">
      <button type="button" aria-label="Quote in reply" title="Quote in reply" onClick={() => onQuote(copyText)}><Quote size={13} /></button>
      <button type="button" aria-label={copied ? 'Message copied' : final ? 'Copy final response' : 'Copy response'} title={copied ? 'Copied' : final ? 'Copy final response' : 'Copy response'} onClick={() => onCopy(event.id, copyText)}>{copied ? <Check size={13} /> : <Copy size={13} />}{final && <span>{copied ? 'Copied' : 'Copy'}</span>}</button>
    </div>}
  </article>
}
