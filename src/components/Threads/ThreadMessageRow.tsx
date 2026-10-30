import { useState } from 'react'
import { Check, Clock3, Copy, FileText, Image as ImageIcon, Paperclip, Quote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { formatNumber } from '../../utils/formatTime'
import type { ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import { formatNativeUserText, taskNotification } from '../../../shared/native-session-text'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ThreadMarkdown } from './ThreadMarkdown'
import { ThreadDeliveryNote } from './ThreadDeliveryNote'
import { ThreadRewindControl } from './ThreadRewindControl'
import { ThreadHistoricalQuestions } from './ThreadHistoricalQuestions'
import { threadTurnPresentation } from './threadTurnPresentation'
import './ThreadMessagesChrome.css'

export function authText(text: string): boolean { return /^Failed to authenticate:|^OAuth token (?:has expired|revoked)/i.test(text) }

const kilobytes = (bytes: number): string => i18n.t('thread:message.kilobytes', { size: formatNumber(Math.ceil(bytes / 1024)) })

export function ThreadMessageBody({ text, role }: { text: string; role: 'user' | 'assistant' }) {
  const { t } = useTranslation('thread')
  const [expanded, setExpanded] = useState(false)
  const longPrompt = role === 'user' && (text.length > 800 || text.split('\n').length > 12)
  if (!longPrompt) return <ThreadMarkdown text={text} />
  return <div className="thread-long-prompt">
    {expanded ? <ThreadMarkdown text={text} /> : <p className="thread-long-prompt-preview">{text.replace(/\s+/g, ' ').slice(0, 240).trimEnd()}…</p>}
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? t('message.showLess') : t('message.showFull')}</button>
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
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  if (event.role === 'assistant' && authText(event.text)) return null
  const notice = event.role === 'user' ? taskNotification(event.text) : null
  if (notice) return <p className="thread-task-notice" role="note"><Clock3 size={12} aria-hidden="true" />{notice.summary ? t('message.taskNoticeSummary', { status: notice.status, summary: notice.summary }) : t('message.taskNotice', { status: notice.status })}</p>
  const displayText = event.role === 'user' && event.id.startsWith('native:') ? formatNativeUserText(event.text) : event.text
  if (!displayText && !event.historicalQuestions?.length) return null
  const copyText = event.historicalQuestions?.length ? [displayText, t('message.recovered'),...event.historicalQuestions.flatMap(question => [question.title, ...(question.options ?? []).map(option => `- ${option}`)])].filter(Boolean).join('\n\n') : displayText
  const final = event.role === 'assistant' && threadTurnPresentation(turnEvents).finalMessageId === event.id
  return <article className={`thread-message thread-message-${event.role}${final ? ' is-final-response' : ''}`}>
    {event.role === 'assistant' && (final || turnEvents.find(value => value.type === 'message' && value.role === 'assistant') === event) && <div className="thread-agent-label"><span className="thread-agent-name"><AgentProviderIcon provider={snapshot?.thread.provider ?? 'claude'} size={16} />{snapshot?.thread.provider === 'claude' ? 'Claude' : 'Codex'}</span>{final && <span className="thread-final-label">{t('message.final')}</span>}</div>}
    {event.role === 'user' && event.attachments?.length ? <ul className="thread-sent-attachments" aria-label={t('message.attachments')}>{event.attachments.map(attachment => <li key={attachment.id} title={attachment.name}><ImageIcon size={14} aria-hidden="true" /><span>{attachment.name}</span><small>{kilobytes(attachment.bytes)}</small></li>)}</ul> : null}
    <ThreadMessageBody text={displayText} role={event.role} />
    {event.role === 'user' && event.context?.length ? <ul className="thread-sent-context" aria-label={t('message.context')}>{event.context.map(file => <li key={file.path} title={t(file.truncated ? 'message.bytesTruncated' : 'message.bytes', { bytes: formatNumber(file.bytes) })}><FileText size={12} aria-hidden="true" /><span>{file.path}</span>{file.truncated && <small>{t('message.truncated')}</small>}</li>)}</ul> : null}
    {event.role === 'user' && event.brief ? <details className="thread-sent-brief"><summary>{t('message.brief')}</summary><pre>{event.brief}</pre></details> : null}
    {event.role === 'user' && snapshot?.deliveries?.[event.id] && snapshot.deliveries[event.id].state !== 'delivered' ? <ThreadDeliveryNote delivery={snapshot.deliveries[event.id]} disabled={pending} onResend={() => void action(() => api!.send(snapshot.thread.id, event.text, event.attachments?.map(attachment => attachment.id) ?? []))} /> : null}
    {event.role === 'user' && snapshot && !running && !snapshot.thread.rewind && api?.rewind && snapshot.thread.capabilities?.features.rewind?.enabled && (() => {
      const turns = snapshot.turns ?? [], index = turns.findIndex(turn => turn.id === event.id)
      const rewind = (options: { restoreFiles: boolean }, edit: boolean) => action(async () => {
        const result = await api.rewind!(snapshot.thread.id, event.id, options)
        useThreadStore.getState().updateSnapshot(result.snapshot)
        // The removed message returns to the composer; a draft in progress is kept below it.
        if (edit) { const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''; useThreadStore.getState().setDraft(snapshot.thread.id, current.trim() ? `${displayText}\n\n${current}` : displayText) }
        if (result.fileError) throw Error(t('message.rewoundFilesFailed', { error: result.fileError }))
      })
      return index >= 0 && (turns[index].nativeId || snapshot.thread.provider === 'claude' && index > 0) ? <ThreadRewindControl laterTurns={turns.length - index} disabled={pending} onRewind={options => rewind(options, false)} onEdit={options => rewind(options, true)} /> : null
    })()}
    {event.historicalQuestions?.length ? <ThreadHistoricalQuestions questions={event.historicalQuestions} /> : null}
    {event.role === 'assistant' && quickReplies.length > 0 && <div className="thread-quick-replies" aria-label={t('message.suggested')}><small>{t('message.suggestedHint')}</small><div>{quickReplies.map(option => <button type="button" key={option.value} onClick={() => onQuickReply(option.value)}>{option.label}</button>)}</div></div>}
    {event.role !== 'user' && event.attachments?.length ? <div className="thread-message-attachments" aria-label={t('message.attachments')}>{event.attachments.map(attachment => <span key={attachment.id}><Paperclip size={12} />{attachment.name}<small>{kilobytes(attachment.bytes)}</small></span>)}</div> : null}
    {event.role === 'assistant' && <div className="thread-message-actions">
      <button type="button" aria-label={t('message.quote')} title={t('message.quote')} onClick={() => onQuote(copyText)}><Quote size={14} /></button>
      <button type="button" aria-label={copied ? t('message.copiedLabel') : final ? t('message.copyFinal') : t('message.copyResponse')} title={copied ? t('message.copied') : final ? t('message.copyFinal') : t('message.copyResponse')} onClick={() => onCopy(event.id, copyText)}>{copied ? <Check size={14} /> : <Copy size={14} />}{final && <span>{copied ? t('message.copied') : t('message.copy')}</span>}</button>
    </div>}
  </article>
}
